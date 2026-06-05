"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { app, BrowserWindow, ipcMain } = require("electron");
const { AiawdClient } = require("./aiawdProtocol");
const { sanitizeCommand, CustomCommandAdapter, AgentManager } = require("./agentRuntime");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server");
const OUTPUT_DIR = path.join(ROOT, "logs", "electron", "browserwindow");
const OUTPUT = path.join(ROOT, "logs", "electron", "e2e_browserwindow_evidence.json");

const records = new Map();

class WindowRecord {
  constructor(name, role) {
    this.name = name;
    this.role = role;
    this.client = new AiawdClient();
    this.agentManager = null;
    this.inbox = [];
    this.transcript = [];
    this.errors = [];
    this.win = null;
  }

  attachWindow(win) {
    this.win = win;
    records.set(win.webContents.id, this);
    this.client.on("message", (message) => {
      this.inbox.push(message);
      this.transcript.push({ direction: "in", name: this.name, message });
      if (!win.isDestroyed()) {
        win.webContents.send("aiawd:message", message);
      }
    });
    this.client.on("disconnect", () => {
      if (!win.isDestroyed()) {
        win.webContents.send("aiawd:status", this.client.snapshot());
      }
    });
    this.client.on("error", (error) => {
      this.errors.push(error.message);
      if (!win.isDestroyed()) {
        win.webContents.send("aiawd:status", { ...this.client.snapshot(), error: error.message });
      }
    });
  }

  async send(type, payload = {}, options = {}) {
    const message = await this.client.send(type, payload, options);
    this.transcript.push({ direction: "out", name: this.name, message });
    return message;
  }

  async readUntil(predicate, label, timeoutMs = 7000) {
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

  readType(type, timeoutMs) {
    return this.readUntil((message) => message.type === type, type, timeoutMs);
  }

  disconnect() {
    this.client.disconnect();
  }
}

function registerIpcHandlers() {
  ipcMain.handle("aiawd:connect", (event, config) => recordFor(event).client.connect(config));
  ipcMain.handle("aiawd:disconnect", (event) => {
    const record = recordFor(event);
    record.client.disconnect();
    return record.client.snapshot();
  });
  ipcMain.handle("aiawd:snapshot", (event) => recordFor(event).client.snapshot());
  ipcMain.handle("aiawd:listTargets", (event) => recordFor(event).send("LIST_TARGETS_REQ"));
  ipcMain.handle("aiawd:listRooms", (event) => recordFor(event).send("LIST_ROOMS_REQ"));
  ipcMain.handle("aiawd:createRoom", (event, room) =>
    recordFor(event).send("CREATE_ROOM_REQ", {
      room_name: room.roomName,
      max_players: room.maxPlayers,
      target_template_id: room.targetTemplateId,
      display_name: room.displayName,
      agent_runtime: room.agentRuntime || "mock-agent",
      model_display_name: room.modelDisplayName || "mock-model",
      allow_spectators: room.allowSpectators,
      phase_seconds: room.phaseSeconds,
    }),
  );
  ipcMain.handle("aiawd:joinRoom", (event, request) =>
    recordFor(event).send(
      "JOIN_ROOM_REQ",
      {
        display_name: request.displayName,
        role: request.role,
        agent_runtime: request.agentRuntime || "mock-agent",
        model_display_name: request.modelDisplayName || "mock-model",
      },
      { roomId: request.roomId, role: request.role },
    ),
  );
  ipcMain.handle("aiawd:startMatch", (event, request) =>
    recordFor(event).send("START_MATCH_REQ", {}, { roomId: request.roomId, role: "player" }),
  );
  ipcMain.handle("aiawd:markTargetReady", (event, request) =>
    recordFor(event).send("TARGET_READY", {}, { roomId: request.roomId, role: "player" }),
  );
  ipcMain.handle("aiawd:markAgentReady", (event, request) =>
    recordFor(event).send("AGENT_READY", {}, { roomId: request.roomId, role: "player" }),
  );
  ipcMain.handle("aiawd:submitFlag", (event, request) =>
    recordFor(event).send(
      "SUBMIT_FLAG_REQ",
      {
        match_id: request.matchId,
        claimed_target_team_id: request.claimedTargetTeamId,
        flag: request.flag,
        source: "electron-window-ui",
      },
      { roomId: request.roomId, role: "player" },
    ),
  );
  ipcMain.handle("aiawd:targetAction", () => ({
    ok: false,
    action: "doctor",
    message: "BrowserWindow 证据脚本不执行本地靶机动作",
  }));
  ipcMain.handle("aiawd:agentStart", async (event, request) => {
    const record = recordFor(event);
    if (!sanitizeCommand(request.command)) {
      return { ok: false, error: "Agent 命令包含不安全的 shell 控制符", flagsCaptured: [], actions: [], elapsedMs: 0 };
    }
    record.agentManager = new AgentManager(new CustomCommandAdapter(request.command));
    record.agentManager.configure(request.matchConfig || {}, request.roomStatus || "LOBBY");
    const result = await record.agentManager.runAttackAsync((flag, targetUrl) => {
      record.client.send(
        "SUBMIT_FLAG_REQ",
        { match_id: request.matchId, flag, source: "electron-window-agent", claimed_target_team_id: targetUrl },
        { roomId: request.roomId, role: "player" },
      );
      return { ok: true };
    });
    event.sender.send("aiawd:agentResult", result);
    return result;
  });
  ipcMain.handle("aiawd:agentStop", (event) => {
    const record = recordFor(event);
    if (record.agentManager) {
      record.agentManager.stop();
      record.agentManager = null;
      return { ok: true, message: "Agent 已停止" };
    }
    return { ok: true, message: "Agent 未在运行" };
  });
  ipcMain.handle("aiawd:agentStatus", (event) => {
    const manager = recordFor(event).agentManager;
    return manager ? { running: manager.running, lastResult: manager.lastResult } : { running: false, lastResult: null };
  });
}

function recordFor(event) {
  const record = records.get(event.sender.id);
  if (!record) {
    throw new Error(`No Electron evidence client registered for webContents ${event.sender.id}`);
  }
  return record;
}

async function main() {
  app.commandLine.appendSwitch("disable-gpu");
  await app.whenReady();
  registerIpcHandlers();

  const port = await findFreePort();
  const server = startServer(port);
  const clients = [
    new WindowRecord("Alice", "player"),
    new WindowRecord("Bob", "player"),
    new WindowRecord("Carol", "spectator"),
  ];
  const screenshots = [];

  try {
    await waitForPort(port, server);
    for (const record of clients) {
      await createEvidenceWindow(record);
    }

    const alice = clients[0];

    // —— Onboarding evidence ——
    // Reset localStorage so the tutorial always starts fresh (Electron persists it across runs)
    await alice.win.webContents.executeJavaScript("localStorage.removeItem('aiawd_onboarding_v1')");
    await sleep(200);
    // Explicitly start the onboarding engine (bypasses autoStart checks)
    await alice.win.webContents.executeJavaScript("OnboardingEngine.start()");
    await sleep(600);

    let onboardingWelcome = false;
    let onboardingStepBadge = false;
    let onboardingDismissed = false;
    let onboardingRelaunched = false;
    let onboardingStep2 = false;
    try {
      await waitForText(alice, "onboardingTooltip", "欢迎来到", 5000);
      onboardingWelcome = await textIncludes(alice, "onboardingTooltip", "欢迎来到 AI-AWD Arena");
      onboardingStepBadge = await htmlIncludes(alice, "onboardingTooltip", "onboarding-step-badge");
      // Dismiss the tutorial so we can interact with the UI
      await dismissOnboarding(alice);
      await sleep(300);
      onboardingDismissed = !(await isOverlayVisible(alice));
      // Re-launch from the topbar button
      await click(alice, "startOnboarding");
      await sleep(500);
      await waitForText(alice, "onboardingTooltip", "欢迎来到", 5000);
      onboardingRelaunched = await textIncludes(alice, "onboardingTooltip", "欢迎来到 AI-AWD Arena");
      // Navigate to step 2 (connect) to verify spotlight
      await clickOnboardingAction(alice, "next");
      await sleep(300);
      onboardingStep2 = await textIncludes(alice, "onboardingTooltip", "连接裁判服务器");
      // Dismiss again before connecting
      await dismissOnboarding(alice);
      await sleep(300);
    } catch (err) {
      // Onboarding check failed — log but don't block the rest of evidence
      console.error(`Onboarding evidence warning: ${err.message}`);
    }

    for (const record of clients) {
      await driveConnect(record, port);
    }

    const bob = clients[1];
    const carol = clients[2];

    await driveCreateRoom(alice);
    const createRes = await alice.readType("CREATE_ROOM_RES");
    const roomId = createRes.payload.room.room_id;
    await waitForText(alice, "roomSummary", "AI攻防");
    screenshots.push(await capture(alice, "01-alice-created-room.png"));

    await driveJoinPlayer(bob, roomId);
    await bob.readType("JOIN_ROOM_RES");
    await waitForText(bob, "myRole", "参赛玩家");
    screenshots.push(await capture(bob, "02-bob-joined-player.png"));

    await driveJoinSpectator(carol, roomId);
    await carol.readType("JOIN_ROOM_RES");
    await waitForText(carol, "myRole", "观战席");
    screenshots.push(await capture(carol, "03-carol-spectator.png"));

    await click(alice, "startMatch");
    const startRes = await alice.readType("START_MATCH_RES");
    const aliceConfig = await alice.readType("MATCH_CONFIG");
    const bobConfig = await bob.readType("MATCH_CONFIG");
    const attackPhase = await alice.readUntil(
      (message) => message.type === "PHASE_SYNC" && message.payload.match.phase === "ATTACK",
      "ATTACK phase",
    );
    await waitForText(alice, "phase", "攻防");

    await alice.send(
      "SUBMIT_FLAG_REQ",
      {
        match_id: startRes.payload.match.match_id,
        claimed_target_team_id: bobConfig.payload.team_id,
        flag: bobConfig.payload.flag,
        source: "electron-window-evidence",
      },
      { roomId, role: "player" },
    );
    const submitRes = await alice.readType("SUBMIT_FLAG_RES");
    const aliceRankingUpdate = await alice.readUntil(
      (message) => (
        message.type === "RANKING_UPDATE"
        && message.payload.rankings?.[0]?.team_id === "team_a"
        && message.payload.rankings?.[0]?.score === 100
      ),
      "Alice post-submit ranking",
    );
    const rankingUpdate = await carol.readUntil(
      (message) => (
        message.type === "RANKING_UPDATE"
        && message.payload.rankings?.[0]?.team_id === "team_a"
        && message.payload.rankings?.[0]?.score === 100
      ),
      "post-submit ranking",
    );
    await waitForText(alice, "scoreSummary", "100 分");
    await waitForText(alice, "phase", "攻防");
    await waitForText(alice, "attackHeat", "team_a→team_b");
    await waitForText(alice, "arenaMap", "AI攻防大乱斗");
    await waitForText(alice, "arenaMap", "team_a → team_b");
    await waitForText(alice, "arenaMap", "战场焦点");
    await waitForText(alice, "arenaMap", "team_a · Alice");
    await waitForText(alice, "arenaMap", "最近攻陷 team_b");
    await waitForText(alice, "arenaMap", "战斗回放");
    await waitForText(alice, "arenaMap", "team_a 攻陷 team_b");
    await waitForText(alice, "arenaMap", "第 1/1 次攻陷");
    await waitForText(alice, "resultSummary", "当前防线完整王");
    const aliceScoreVisible = await textIncludes(alice, "scoreSummary", "100 分");
    const aliceAttackPhaseVisible = await textIncludes(alice, "phase", "攻防");
    const aliceAttackHeatVisible = await textIncludes(alice, "attackHeat", "team_a→team_b");
    const attackerFocusVisible = await textIncludes(alice, "arenaMap", "team_a · Alice");
    const attackerNoteVisible = await textIncludes(alice, "arenaMap", "最近攻陷 team_b");
    const replayVisible = await textIncludes(alice, "arenaMap", "战斗回放");
    const replayLatestVisible = await textIncludes(alice, "arenaMap", "team_a 攻陷 team_b");
    const replayAttackerClassVisible = await htmlIncludes(alice, "arenaMap", "is-attacker");
    const replayTargetClassVisible = await htmlIncludes(alice, "arenaMap", "is-target");
    const replayThreatClassVisible = await htmlIncludes(alice, "arenaMap", "is-replay");
    screenshots.push(await capture(alice, "04-alice-attack-arena.png", "arenaMap"));
    await clickArenaTeam(alice, "team_b");
    await waitForText(alice, "arenaMap", "team_b · Bob");
    await waitForText(alice, "arenaMap", "最近对 team_a 失守");
    const clickedFocusVisible = await textIncludes(alice, "arenaMap", "team_b · Bob");
    const clickedFocusNoteVisible = await textIncludes(alice, "arenaMap", "最近对 team_a 失守");
    screenshots.push(await capture(alice, "05-alice-focus-bob.png", "arenaMap"));

    await bob.send(
      "SUBMIT_FLAG_REQ",
      {
        match_id: startRes.payload.match.match_id,
        claimed_target_team_id: aliceConfig.payload.team_id,
        flag: aliceConfig.payload.flag,
        source: "electron-window-evidence",
      },
      { roomId, role: "player" },
    );
    const bobSubmitRes = await bob.readType("SUBMIT_FLAG_RES");
    await alice.readUntil(
      (message) => (
        message.type === "RANKING_UPDATE"
        && message.payload.rankings?.some((row) => row.team_id === "team_b" && row.score === 50)
      ),
      "Bob post-submit ranking",
    );
    await waitForText(alice, "arenaMap", "team_b 攻陷 team_a");
    await waitForText(alice, "arenaMap", "第 1/2 次攻陷");
    const replayPrevEnabled = await replayActionEnabled(alice, "prev");
    await clickReplayAction(alice, "prev");
    await waitForText(alice, "arenaMap", "team_a 攻陷 team_b");
    await waitForText(alice, "arenaMap", "第 2/2 次攻陷");
    await waitForText(alice, "arenaMap", "team_a · Alice");
    const replayPrevChangesSelection = await textIncludes(alice, "arenaMap", "第 2/2 次攻陷");
    screenshots.push(await capture(alice, "06-alice-replay-older-capture.png", "arenaMap"));
    await clickReplayAction(alice, "latest");
    await waitForText(alice, "arenaMap", "team_b 攻陷 team_a");
    await waitForText(alice, "arenaMap", "第 1/2 次攻陷");
    const replayLatestRestoresSelection = await textIncludes(alice, "arenaMap", "team_b 攻陷 team_a");
    screenshots.push(await capture(alice, "07-alice-attack-ranking.png", "resultSummary"));

    const visibleText = Object.fromEntries(
      await Promise.all(clients.map(async (record) => [record.name, await getVisibleText(record)])),
    );
    const privateFlags = [aliceConfig.payload.flag, bobConfig.payload.flag].filter(Boolean);
    const assertions = {
      alice_created_room: Boolean(roomId),
      bob_joined_player: await textIncludes(bob, "myRole", "参赛玩家"),
      carol_joined_spectator: await textIncludes(carol, "myRole", "观战席"),
      attack_phase_seen: attackPhase.payload.match.phase === "ATTACK",
      submit_ok: submitRes.payload.ok === true,
      leading_team: aliceRankingUpdate.payload.rankings[0].team_id,
      leading_score: aliceRankingUpdate.payload.rankings[0].score,
      spectator_leading_team: rankingUpdate.payload.rankings[0].team_id,
      spectator_leading_score: rankingUpdate.payload.rankings[0].score,
      alice_score_visible: aliceScoreVisible,
      alice_attack_phase_visible: aliceAttackPhaseVisible,
      alice_attack_heat_visible: aliceAttackHeatVisible,
      alice_arena_model_visible: await textIncludes(alice, "arenaMap", "AI攻防大乱斗"),
      alice_threat_lane_visible: await textIncludes(alice, "arenaMap", "team_a → team_b"),
      alice_attacker_focus_visible: attackerFocusVisible,
      alice_attacker_note_visible: attackerNoteVisible,
      alice_clicked_focus_visible: clickedFocusVisible,
      alice_clicked_focus_note_visible: clickedFocusNoteVisible,
      replay_visible: replayVisible,
      replay_latest_visible: replayLatestVisible,
      replay_attacker_class_visible: replayAttackerClassVisible,
      replay_target_class_visible: replayTargetClassVisible,
      replay_threat_class_visible: replayThreatClassVisible,
      replay_prev_enabled: replayPrevEnabled,
      replay_prev_changes_selection: replayPrevChangesSelection,
      replay_latest_restores_selection: replayLatestRestoresSelection,
      bob_submit_ok: bobSubmitRes.payload.ok === true,
      alice_result_visible: await textIncludes(alice, "resultSummary", "当前防线完整王"),
      screenshots_nonblank: screenshots.every((shot) => shot.nonblank),
      private_flag_not_visible: Object.values(visibleText).every((text) => privateFlags.every((flag) => !text.includes(flag))),
      onboarding_welcome_visible: onboardingWelcome,
      onboarding_step_badge_visible: onboardingStepBadge,
      onboarding_dismissed: onboardingDismissed,
      onboarding_relaunched: onboardingRelaunched,
      onboarding_step2_connect: onboardingStep2,
    };
    const evidence = {
      ok: Object.values(assertions).every(Boolean),
      generated_at: new Date().toISOString(),
      scope: "Electron BrowserWindow visual evidence with three local clients",
      server: { host: "127.0.0.1", port },
      room_id: roomId,
      match_id: startRes.payload.match.match_id,
      screenshots,
      assertions,
      transcript: clients.flatMap((client) => client.transcript).map(redact),
      errors: clients.flatMap((client) => client.errors),
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${OUTPUT}`);
    if (!evidence.ok) {
      throw new Error(`BrowserWindow evidence assertions failed: ${JSON.stringify(assertions)}`);
    }
  } finally {
    for (const client of clients) {
      client.disconnect();
      if (client.win && !client.win.isDestroyed()) {
        client.win.destroy();
      }
    }
    await stopServer(server);
    app.quit();
  }
}

async function createEvidenceWindow(record) {
  const win = new BrowserWindow({
    width: 1280,
    height: 1500,
    show: false,
    title: `AI-AWD Arena Evidence - ${record.name}`,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  record.attachWindow(win);
  await win.loadFile(path.join(__dirname, "index.html"));
  await waitForDom(record);
}

async function driveConnect(record, port) {
  await setValue(record, "host", "127.0.0.1");
  await setValue(record, "port", String(port));
  await setValue(record, "displayName", record.name);
  await click(record, "connect");
  await waitForText(record, "connectionState", "已连接");
}

async function driveCreateRoom(record) {
  await setValue(record, "roomName", "Electron AI攻防大乱斗截图证据房");
  await setValue(record, "maxPlayers", "2");
  await setValue(record, "targetTemplateId", "real_ctf_web_awd_01");
  await setValue(record, "prepareSeconds", "1");
  await setValue(record, "defenseSeconds", "1");
  await setValue(record, "attackSeconds", "90");
  await setValue(record, "agentRuntime", "electron-agent");
  await setValue(record, "modelDisplayName", "model-alpha");
  await click(record, "createRoom");
}

async function driveJoinPlayer(record, roomId) {
  await setValue(record, "roomId", roomId);
  await setValue(record, "agentRuntime", "electron-agent");
  await setValue(record, "modelDisplayName", "model-beta");
  await click(record, "joinPlayer");
}

async function driveJoinSpectator(record, roomId) {
  await setValue(record, "roomId", roomId);
  await click(record, "joinSpectator");
}

async function setValue(record, id, value) {
  await record.win.webContents.executeJavaScript(`
    {
      const el = document.getElementById(${JSON.stringify(id)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  `);
}

async function click(record, id) {
  await record.win.webContents.executeJavaScript(`
    document.getElementById(${JSON.stringify(id)}).click();
  `);
}

async function clickArenaTeam(record, teamId) {
  await record.win.webContents.executeJavaScript(`
    {
      const wanted = ${JSON.stringify(teamId)};
      const button = [...document.querySelectorAll("[data-team-id]")].find((node) => node.dataset.teamId === wanted);
      if (!button) throw new Error("arena team not found: " + wanted);
      button.click();
    }
  `);
}

async function clickReplayAction(record, action) {
  await record.win.webContents.executeJavaScript(`
    {
      const wanted = ${JSON.stringify(action)};
      const button = [...document.querySelectorAll("[data-replay-action]")].find((node) => node.dataset.replayAction === wanted);
      if (!button) throw new Error("replay action not found: " + wanted);
      if (button.disabled) throw new Error("replay action disabled: " + wanted);
      button.click();
    }
  `);
}

async function waitForDom(record) {
  await waitFor(record, () => document.readyState === "complete", "DOM ready");
}

async function waitForText(record, id, expected, timeoutMs = 7000) {
  await waitFor(
    record,
    (elementId, text) => document.getElementById(elementId)?.textContent.includes(text),
    `${id} contains ${expected}`,
    [id, expected],
    timeoutMs,
  );
}

async function textIncludes(record, id, expected) {
  return record.win.webContents.executeJavaScript(`
    document.getElementById(${JSON.stringify(id)})?.textContent.includes(${JSON.stringify(expected)}) || false;
  `);
}

async function htmlIncludes(record, id, expected) {
  return record.win.webContents.executeJavaScript(`
    document.getElementById(${JSON.stringify(id)})?.innerHTML.includes(${JSON.stringify(expected)}) || false;
  `);
}

async function replayActionEnabled(record, action) {
  return record.win.webContents.executeJavaScript(`
    {
      const wanted = ${JSON.stringify(action)};
      const button = [...document.querySelectorAll("[data-replay-action]")].find((node) => node.dataset.replayAction === wanted);
      Boolean(button && !button.disabled);
    }
  `);
}

async function waitFor(record, predicate, label, args = [], timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await record.win.webContents.executeJavaScript(
      `(${predicate.toString()})(...${JSON.stringify(args)})`,
    );
    if (ok) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`${record.name} timed out waiting for ${label}`);
}

async function getVisibleText(record) {
  return record.win.webContents.executeJavaScript("document.body.textContent || ''");
}

async function capture(record, filename, scrollId = null) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  record.win.show();
  record.win.focus();
  record.win.webContents.setZoomFactor(scrollId ? 0.72 : 1);
  if (scrollId) {
    await record.win.webContents.executeJavaScript(`
      {
        const id = ${JSON.stringify(scrollId)};
        const node = document.getElementById(id);
        node?.scrollIntoView({ block: id === "arenaMap" ? "start" : "center" });
        if (id === "arenaMap") window.scrollBy(0, -120);
      }
    `);
  } else {
    await record.win.webContents.executeJavaScript("window.scrollTo(0, 0)");
  }
  await forceRepaint(record);
  await flushPaint(record);
  const image = await record.win.webContents.capturePage();
  const png = image.toPNG();
  const file = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(file, png);
  const size = image.getSize();
  return {
    name: record.name,
    role: record.role,
    file,
    width: size.width,
    height: size.height,
    bytes: png.length,
    nonblank: png.length > 20_000 && bitmapHasVariation(image.toBitmap()),
  };
}

async function forceRepaint(record) {
  await record.win.webContents.executeJavaScript(`
    {
      document.body.style.setProperty("--evidence-capture-tick", String(Date.now()));
      document.body.style.outline = "1px solid transparent";
      document.body.style.transform = "translateZ(0)";
      void document.body.offsetHeight;
    }
  `);
  await sleep(500);
}

async function flushPaint(record) {
  await record.win.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  `);
  await sleep(250);
}

function bitmapHasVariation(bitmap) {
  if (!bitmap.length) {
    return false;
  }
  const seen = new Set();
  const stride = Math.max(4, Math.floor(bitmap.length / 4096));
  for (let index = 0; index < bitmap.length; index += stride) {
    seen.add(bitmap[index]);
    if (seen.size >= 8) {
      return true;
    }
  }
  return false;
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
      shell: false,
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
  if (!server || server.exitCode !== null) {
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

async function isOverlayVisible(record) {
  return record.win.webContents.executeJavaScript(`
    document.getElementById("onboardingOverlay")?.style.display === "block";
  `);
}

async function dismissOnboarding(record) {
  await record.win.webContents.executeJavaScript(`
    {
      const dismissBtn = [...document.querySelectorAll("[data-onboarding-action]")].find(
        (node) => node.dataset.onboardingAction === "dismiss"
      );
      if (dismissBtn) dismissBtn.click();
    }
  `);
}

async function clickOnboardingAction(record, action) {
  await record.win.webContents.executeJavaScript(`
    {
      const btn = [...document.querySelectorAll("[data-onboarding-action]")].find(
        (node) => node.dataset.onboardingAction === ${JSON.stringify(action)}
      );
      if (btn && !btn.disabled) btn.click();
    }
  `);
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
  app.quit();
  process.exitCode = 1;
});
