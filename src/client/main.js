const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { AiawdClient } = require("./aiawdProtocol");
const { runTargetAction } = require("./targetLifecycle");
const { CustomCommandAdapter, AgentManager, sanitizeCommand, parseActivitySteps, commandNeedsShell } = require("./agentRuntime");
const { openclawPath } = require("./adapters");
const { detectProvider, providerProfile } = require("./providerDetect");

let mainWindow = null;
const client = new AiawdClient();
/** @type {AgentManager|null} */
let agentManager = null;
let openclawProviderConfigFingerprint = "";
const DEFAULT_MODEL_DISPLAY_NAME = "deepseek-chat";
const DEFAULT_API_BASE_URL = "https://api.deepseek.com";

function normalizeModelDisplayName(modelName) {
  return (modelName || "").trim() || DEFAULT_MODEL_DISPLAY_NAME;
}

function normalizeApiBaseUrl(baseUrl, modelName, apiKey = "") {
  const explicit = (baseUrl || "").trim();
  if (explicit) return explicit;
  const provider = detectProvider(apiKey, normalizeModelDisplayName(modelName));
  const profile = providerProfile(provider);
  return profile?.apiBaseUrl || (provider === "DeepSeek" ? DEFAULT_API_BASE_URL : "");
}

function resolveAgentCommand(command) {
  const argv = Array.isArray(command) ? [...command] : [];
  const executable = path.basename(String(argv[0] || "")).toLowerCase();
  if (executable === "openclaw" || executable === "openclaw.exe" || executable === "openclaw.cmd") {
    argv[0] = openclawPath();
  }
  return argv;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    title: "AI-AWD Arena 控制台",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.loadFile(path.join(__dirname, "index.html"));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

client.on("message", (message) => sendToRenderer("aiawd:message", message));
client.on("disconnect", () => sendToRenderer("aiawd:status", client.snapshot()));
client.on("error", (error) => sendToRenderer("aiawd:status", { ...client.snapshot(), error: error.message }));

ipcMain.handle("aiawd:connect", (_event, config) => client.connect(config));
ipcMain.handle("aiawd:disconnect", () => {
  client.disconnect();
  return client.snapshot();
});
ipcMain.handle("aiawd:snapshot", () => client.snapshot());
ipcMain.handle("aiawd:listTargets", () => client.send("LIST_TARGETS_REQ"));
ipcMain.handle("aiawd:listRooms", () => client.send("LIST_ROOMS_REQ"));
ipcMain.handle("aiawd:createRoom", (_event, room) => {
  const apiKey = (room.apiKey || "").trim();
  const modelName = normalizeModelDisplayName(room.modelDisplayName);
  const provider = detectProvider(apiKey, modelName);
  return client.send("CREATE_ROOM_REQ", {
    room_name: room.roomName,
    max_players: room.maxPlayers,
    target_template_id: room.targetTemplateId,
    display_name: room.displayName,
    agent_runtime: room.agentRuntime || "mock-agent",
    model_display_name: modelName || "mock-model",
    api_provider: provider,
    api_base_url: normalizeApiBaseUrl(room.apiBaseUrl, modelName, apiKey),
    allow_spectators: room.allowSpectators,
    phase_seconds: room.phaseSeconds,
  });
});
ipcMain.handle("aiawd:joinRoom", (_event, request) => {
  const apiKey = (request.apiKey || "").trim();
  const modelName = normalizeModelDisplayName(request.modelDisplayName);
  const provider = detectProvider(apiKey, modelName);
  return client.send(
    "JOIN_ROOM_REQ",
    {
      display_name: request.displayName,
      role: request.role,
      agent_runtime: request.agentRuntime || "mock-agent",
      model_display_name: modelName || "mock-model",
      api_provider: provider,
      api_base_url: normalizeApiBaseUrl(request.apiBaseUrl, modelName, apiKey),
    },
    { roomId: request.roomId, role: request.role },
  );
});
ipcMain.handle("aiawd:startMatch", (_event, request) =>
  client.send("START_MATCH_REQ", {}, { roomId: request.roomId, role: "player" }),
);
ipcMain.handle("aiawd:markTargetReady", (_event, request) =>
  client.send("TARGET_READY", {}, { roomId: request.roomId, role: "player" }),
);
ipcMain.handle("aiawd:markAgentReady", (_event, request) =>
  client.send("AGENT_READY", {}, { roomId: request.roomId, role: "player" }),
);
ipcMain.handle("aiawd:submitFlag", (_event, request) =>
  client.send(
    "SUBMIT_FLAG_REQ",
    {
      match_id: request.matchId,
      claimed_target_team_id: request.claimedTargetTeamId,
      flag: request.flag,
      source: "electron-ui",
    },
    { roomId: request.roomId, role: "player" },
  ),
);
ipcMain.handle("aiawd:targetAction", async (_event, request) => {
  // Auto-detect and start Docker daemon if needed.
  // Use spawnSync with explicit docker path — no shell — to avoid
  // shell rc file stalls that cause ETIMEDOUT on macOS.
  const { spawnSync } = require("child_process"); // eslint-disable-line

  function dockerPath() {
    const candidates = [
      "/usr/local/bin/docker",
      "/opt/homebrew/bin/docker",
      "/opt/local/bin/docker",
      "/Applications/Docker.app/Contents/Resources/bin/docker",
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      "C:\\Program Files\\Docker\\Docker\\resources\\docker.exe",
    ];
    const fs = require("fs");
    for (const p of candidates) { if (fs.existsSync(p)) return p; }
    return process.platform === "win32" ? "docker.exe" : "docker"; // fallback to PATH
  }

  function dockerAvailable() {
    const bin = dockerPath();
    try {
      // Ensure Docker bin dir is in PATH — Electron from Finder/Start Menu may
      // inherit a minimal PATH that doesn't include Docker's location.
      const dockerEnv = { ...process.env };
      const dockerDir = path.dirname(bin);
      const sep = process.platform === "win32" ? ";" : ":";
      dockerEnv.PATH = dockerDir + sep + (process.env.PATH || "");
      const result = spawnSync(bin, ["info"], {
        stdio: "pipe", timeout: 12000, shell: false, env: dockerEnv,
      });
      return result.status === 0;
    } catch (_) { return false; }
  }

  if (!dockerAvailable()) {
    console.error("Docker check failed — daemon may not be running");
    sendToRenderer("aiawd:message", { type: "EVENT", payload: { event_type: "DOCKER_STARTING", event: { message: "Docker 未运行，正在自动启动..." } } });

    if (process.platform === "darwin") {
      try { spawnSync("open", ["-a", "Docker"], { stdio: "pipe", timeout: 10000, shell: false }); } catch (_) {}
      for (let i = 0; i < 30; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1000));
        if (dockerAvailable()) break;
      }
    } else if (process.platform === "win32") {
      try { spawnSync("cmd", ["/c", "start", "", "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"], { stdio: "pipe", timeout: 10000, shell: false }); } catch (_) {}
      for (let i = 0; i < 30; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1000));
        if (dockerAvailable()) break;
      }
    }

    if (!dockerAvailable()) {
      console.error("Docker daemon still not available after auto-start attempt");
      sendToRenderer("aiawd:message", { type: "EVENT", payload: { event_type: "DOCKER_FAILED", event: { message: "Docker 启动失败 — 请确认 Docker Desktop 已运行并登录" } } });
      return { ok: false, message: "Docker 未运行 — 请确认 Docker Desktop 已启动并登录" };
    }
    sendToRenderer("aiawd:message", { type: "EVENT", payload: { event_type: "DOCKER_READY", event: { message: "Docker 已就绪" } } });
  }
  return runTargetAction(request);
});

ipcMain.handle("aiawd:agentStart", async (_event, request) => {
  const requestedCommand = Array.isArray(request.command) ? request.command : [];
  if (!sanitizeCommand(requestedCommand)) {
    return { ok: false, error: "Agent 命令包含不安全的 shell 控制符", flagsCaptured: [], actions: [], elapsedMs: 0 };
  }
  const command = resolveAgentCommand(requestedCommand);
  if (!command.length) {
    return { ok: false, error: "Agent 命令为空", flagsCaptured: [], actions: [], elapsedMs: 0 };
  }
  if (!sanitizeCommand(command)) {
    return { ok: false, error: "Agent 命令解析后包含不安全字符", flagsCaptured: [], actions: [], elapsedMs: 0 };
  }
  const apiKey = request.apiKey || "";
  const modelName = normalizeModelDisplayName(request.modelDisplayName);
  const provider = detectProvider(apiKey, modelName);
  const profile = providerProfile(provider);
  const userBaseUrl = normalizeApiBaseUrl(request.apiBaseUrl, modelName, apiKey);
  const env = { ...process.env };
  // Point OpenClaw state to a sandbox-writable directory
  // (default ~/.openclaw may be read-only in Electron sandbox on Windows)
  env.OPENCLAW_HOME = path.join(__dirname, "..", ".openclaw");
  try { require("fs").mkdirSync(env.OPENCLAW_HOME, { recursive: true }); } catch (_) {}
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
    env.OPENAI_API_KEY = apiKey;
    env.DEEPSEEK_API_KEY = apiKey;
    env.LLM_API_KEY = apiKey;
    // Use user-specified base URL, or auto-detect
    if (userBaseUrl) {
      env.OPENAI_BASE_URL = userBaseUrl;
      env.DEEPSEEK_BASE_URL = userBaseUrl;
    } else if (!process.env.DEEPSEEK_BASE_URL) {
      env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    }
    if (provider === "DeepSeek" && !userBaseUrl) {
      env.OPENAI_BASE_URL = env.OPENAI_BASE_URL || "https://api.deepseek.com";
    }
  }
  // Ensure OpenClaw has a provider configured for the current API/model tuple.
  if (apiKey) {
    try {
      const { execFileSync } = require("child_process");
      const baseUrl = userBaseUrl || profile?.apiBaseUrl || DEFAULT_API_BASE_URL;
      const providerKey = profile?.openclawProvider || (baseUrl.includes("deepseek") ? "deepseek" : "openai");
      const apiAdapter = profile?.openclawApi || "openai-completions";
      const configuredModel = modelName || profile?.models?.[0] || DEFAULT_MODEL_DISPLAY_NAME;
      const configFingerprint = JSON.stringify({ providerKey, baseUrl, configuredModel, apiKey });
      if (openclawProviderConfigFingerprint !== configFingerprint) {
        const patch = {
          models: {
            mode: "merge",
            providers: {
              [providerKey]: {
                baseUrl: baseUrl,
                api: apiAdapter,
                apiKey: apiKey,
                models: [{ id: configuredModel, name: configuredModel, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
              }
            }
          }
        };
        const openclawBin = openclawPath();
        execFileSync(openclawBin, ["config", "patch", "--stdin"], {
          input: JSON.stringify(patch),
          timeout: 10000,
          stdio: "pipe",
          shell: commandNeedsShell(openclawBin),
        });
        openclawProviderConfigFingerprint = configFingerprint;
      }
    } catch (_) { /* best-effort provider config */ }
  }

  const adapter = new CustomCommandAdapter(command, { env });

  // Manual attack loop with per-action activity reporting
  const { makeContext } = require("./agentRuntime");
  const ctx = makeContext(request.matchConfig || {}, request.roomStatus || "LOBBY");
  adapter.configure(ctx);
  agentManager = new AgentManager(adapter);
  const started = Date.now();
  const actions = [];
  const captured = [];
  // During PREPARE/DEFENSE, scan own target; during ATTACK, scan opponents
  const isSelfTarget = (request.roomStatus || "") !== "ATTACK";
  const targets = isSelfTarget
    ? [{ teamId: ctx.teamId, baseUrl: ctx.localTarget.baseUrl }]
    : ctx.targets;

  for (const target of targets) {
    if (!target || !target.baseUrl) continue;
    const oppTeam = target.teamId || "";  // team_b, team_c, etc.
    const isAttack = (request.roomStatus || "") === "ATTACK";
    const action = await adapter._runAgainstAsync(target.baseUrl, (flag, _targetUrl) => {
      // Only submit flags during ATTACK phase
      if (!isAttack || !oppTeam) return { ok: false };
      client.send(
        "SUBMIT_FLAG_REQ",
        { match_id: request.matchId, flag, source: "electron-agent", claimed_target_team_id: oppTeam },
        { roomId: request.roomId, role: "player" },
      );
      return { ok: true };
    });
    actions.push(action);

    // Report detailed agent activity steps
    const activitySteps = parseActivitySteps(action.output, action.targetUrl, action.ok, action.flag);
    for (const step of activitySteps) {
      try {
        await client.send("AGENT_ACTIVITY", {
          match_id: request.matchId,
          action: (request.roomStatus || "ATTACK").toLowerCase(),
          target_url: action.targetUrl,
          flag: action.flag,
          ok: step.ok,
          output_snippet: step.desc,
          elapsed_ms: Date.now() - started,
        }, { roomId: request.roomId, role: "player" });
      } catch (_) { /* activity reporting is best-effort */ }
    }

    if (action.flag) captured.push(action.flag);
    if (!action.ok) break;
  }

  const result = {
    ok: actions.every((a) => a.ok),
    actions,
    flagsCaptured: captured,
    elapsedMs: Date.now() - started,
    error: null,
  };
  sendToRenderer("aiawd:agentResult", result);
  return result;
});

ipcMain.handle("aiawd:agentStop", () => {
  if (agentManager) {
    agentManager.stop();
    agentManager = null;
    return { ok: true, message: "Agent 已停止" };
  }
  return { ok: true, message: "Agent 未在运行" };
});

ipcMain.handle("aiawd:agentStatus", () => {
  if (!agentManager) return { running: false, lastResult: null };
  return { running: agentManager.running, lastResult: agentManager.lastResult };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
