"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { AiawdClient } = require("./aiawdProtocol");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server");
const OUTPUT = path.join(ROOT, "logs", "electron", "e2e_protocol_evidence.json");

class EvidenceClient {
  constructor(name) {
    this.name = name;
    this.client = new AiawdClient();
    this.inbox = [];
    this.transcript = [];
    this.errors = [];
    this.client.on("message", (message) => {
      this.inbox.push(message);
      this.transcript.push({ direction: "in", name: this.name, message });
    });
    this.client.on("error", (error) => {
      this.errors.push(error.message);
    });
  }

  async connect(port, displayName) {
    const snapshot = await this.client.connect({ host: "127.0.0.1", port, displayName });
    this.transcript.push({ direction: "status", name: this.name, snapshot });
    return snapshot;
  }

  async send(type, payload = {}, options = {}) {
    const message = await this.client.send(type, payload, options);
    this.transcript.push({ direction: "out", name: this.name, message });
    return message;
  }

  async readUntil(predicate, label, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const index = this.inbox.findIndex(predicate);
      if (index >= 0) {
        const [message] = this.inbox.splice(index, 1);
        return message;
      }
      await sleep(25);
    }
    throw new Error(`${this.name} timed out waiting for ${label}`);
  }

  async readType(type, timeoutMs) {
    return this.readUntil((message) => message.type === type, type, timeoutMs);
  }

  disconnect() {
    this.client.disconnect();
  }
}

async function main() {
  const port = await findFreePort();
  const server = startServer(port);
  const clients = [
    new EvidenceClient("Alice"),
    new EvidenceClient("Bob"),
    new EvidenceClient("Carol"),
  ];

  try {
    await waitForPort(port, server);
    await clients[0].connect(port, "Alice");
    await clients[1].connect(port, "Bob");
    await clients[2].connect(port, "Carol");

    await clients[0].send("LIST_TARGETS_REQ");
    await clients[0].readType("LIST_TARGETS_RES");

    await clients[0].send("CREATE_ROOM_REQ", {
      room_name: "Electron Evidence Room",
      max_players: 2,
      target_template_id: "real_ctf_web_awd_01",
      display_name: "Alice",
      agent_runtime: "electron-agent",
      model_display_name: "model-alpha",
      allow_spectators: true,
      phase_seconds: { prepare: 1, defense: 1, attack: 5 },
    });
    const createRes = await clients[0].readType("CREATE_ROOM_RES");
    const roomId = createRes.payload.room.room_id;

    await clients[1].send(
      "JOIN_ROOM_REQ",
      { display_name: "Bob", role: "player", agent_runtime: "electron-agent", model_display_name: "model-beta" },
      { roomId, role: "player" },
    );
    await clients[1].readType("JOIN_ROOM_RES");

    await clients[2].send(
      "JOIN_ROOM_REQ",
      { display_name: "Carol", role: "spectator" },
      { roomId, role: "spectator" },
    );
    await clients[2].readType("JOIN_ROOM_RES");

    await clients[0].send("START_MATCH_REQ", {}, { roomId, role: "player" });
    const startRes = await clients[0].readType("START_MATCH_RES");
    const bobConfig = await clients[1].readType("MATCH_CONFIG");
    await clients[0].readUntil(
      (message) => message.type === "PHASE_SYNC" && message.payload.match.phase === "ATTACK",
      "ATTACK phase",
      5000,
    );

    await clients[0].send(
      "SUBMIT_FLAG_REQ",
      {
        match_id: startRes.payload.match.match_id,
        claimed_target_team_id: "team_b",
        flag: bobConfig.payload.flag,
        source: "electron-e2e",
      },
      { roomId, role: "player" },
    );
    const submitRes = await clients[0].readType("SUBMIT_FLAG_RES");
    const rankingUpdate = await clients[2].readUntil(
      (message) => (
        message.type === "RANKING_UPDATE"
        && message.payload.rankings?.[0]?.team_id === "team_a"
        && message.payload.rankings?.[0]?.score === 100
      ),
      "post-submit ranking",
      5000,
    );

    const evidence = {
      ok: true,
      generated_at: new Date().toISOString(),
      scope: "Electron main-process protocol bridge smoke evidence",
      server: { host: "127.0.0.1", port },
      room_id: roomId,
      match_id: startRes.payload.match.match_id,
      assertions: {
        alice_created_room: Boolean(roomId),
        bob_joined_player: true,
        carol_joined_spectator: true,
        attack_phase_seen: true,
        submit_ok: submitRes.payload.ok === true,
        leading_team: rankingUpdate.payload.rankings[0].team_id,
        leading_score: rankingUpdate.payload.rankings[0].score,
      },
      transcript: clients.flatMap((client) => client.transcript).map(redact),
      errors: clients.flatMap((client) => client.errors),
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${OUTPUT}`);
  } finally {
    for (const client of clients) {
      client.disconnect();
    }
    await stopServer(server);
  }
}

function startServer(port) {
  const env = { ...process.env, PYTHONPATH: SERVER, PYTHONUNBUFFERED: "1" };
  const python = findPython();
  const server = spawn(
    python,
    ["-m", "aiawd_server.main", "--host", "127.0.0.1", "--port", String(port), "--http-port", "0"],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdoutText = "";
  server.stderrText = "";
  server.stdout.on("data", (chunk) => {
    server.stdoutText += chunk.toString("utf8");
  });
  server.stderr.on("data", (chunk) => {
    server.stderrText += chunk.toString("utf8");
  });
  return server;
}

function findPython() {
  const candidates = [
    process.env.PYTHON,
    "/usr/local/Caskroom/miniforge/base/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "python3.12",
    "python3.11",
    "python3",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.status !== 0) {
      continue;
    }
    const [major, minor] = result.stdout.trim().split(".").map((part) => Number(part));
    if (major > 3 || (major === 3 && minor >= 11)) {
      return candidate;
    }
  }
  throw new Error("Python 3.11+ is required; set PYTHON=/path/to/python3 before running this script");
}

async function stopServer(server) {
  if (server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.kill("SIGKILL");
      resolve();
    }, 2000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, server, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early with code ${server.exitCode}\nstdout:\n${server.stdoutText}\nstderr:\n${server.stderrText}`);
    }
    if (await canConnect(port)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`server did not open 127.0.0.1:${port}\nstdout:\n${server.stdoutText}\nstderr:\n${server.stderrText}`);
}

async function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key.toLowerCase().includes("flag") ? "[REDACTED]" : redact(entry),
      ]),
    );
  }
  if (typeof value === "string") {
    return value.replace(/FLAG\{[^}]+\}/g, "FLAG{REDACTED}");
  }
  return value;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
