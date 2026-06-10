const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { AiawdClient } = require("./aiawdProtocol");
const { runTargetAction } = require("./targetLifecycle");
const { CustomCommandAdapter, AgentManager, sanitizeCommand, parseActivitySteps } = require("./agentRuntime");
const { openclawPath } = require("./adapters");
const { detectProvider } = require("./providerDetect");

let mainWindow = null;
const client = new AiawdClient();
/** @type {AgentManager|null} */
let agentManager = null;
let openclawProviderConfigured = false;
const DEFAULT_MODEL_DISPLAY_NAME = "deepseek-chat";
const DEFAULT_API_BASE_URL = "https://api.deepseek.com";

function normalizeModelDisplayName(modelName) {
  return (modelName || "").trim() || DEFAULT_MODEL_DISPLAY_NAME;
}

function normalizeApiBaseUrl(baseUrl, modelName) {
  const explicit = (baseUrl || "").trim();
  if (explicit) return explicit;
  return normalizeModelDisplayName(modelName).toLowerCase().includes("deepseek") ? DEFAULT_API_BASE_URL : "";
}

function resolveAgentCommand(command) {
  const argv = Array.isArray(command) ? [...command] : [];
  const executable = path.basename(String(argv[0] || "")).toLowerCase();
  if (executable === "openclaw" || executable === "openclaw.exe") {
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
    api_base_url: normalizeApiBaseUrl(room.apiBaseUrl, modelName),
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
      api_base_url: normalizeApiBaseUrl(request.apiBaseUrl, modelName),
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
  // Auto-start Docker Desktop if daemon isn't running
  const { execSync } = require("child_process"); // eslint-disable-line
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
  } catch (dockerCheckErr) {
    console.error("Docker check failed:", dockerCheckErr.message);
    sendToRenderer("aiawd:message", { type: "EVENT", payload: { event_type: "DOCKER_STARTING", event: { message: "Docker 未运行，正在自动启动..." } } });
    if (process.platform === "darwin") {
      try { execSync("open -a Docker", { stdio: "pipe", timeout: 10000 }); } catch (_) {}
      for (let i = 0; i < 30; i++) {
        try { execSync("docker info", { stdio: "pipe", timeout: 3000 }); break; }
        catch (_) { await new Promise(r => setTimeout(r, 1000)); }
      }
    } else if (process.platform === "win32") {
      try { execSync('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"', { stdio: "pipe", timeout: 10000, shell: true }); } catch (_) {}
      for (let i = 0; i < 30; i++) {
        try { execSync("docker info", { stdio: "pipe", timeout: 3000 }); break; }
        catch (_) { await new Promise(r => setTimeout(r, 1000)); }
      }
    }
    // Check if Docker came up
    try { execSync("docker info", { stdio: "pipe", timeout: 5000 }); }
    catch (dockerStartErr) {
      console.error("Docker daemon still not available:", dockerStartErr.message);
      sendToRenderer("aiawd:message", { type: "EVENT", payload: { event_type: "DOCKER_FAILED", event: { message: `Docker 启动失败: ${dockerStartErr.message}` } } });
      return { ok: false, message: `Docker 未运行: ${dockerStartErr.message}` };
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
  const userBaseUrl = normalizeApiBaseUrl(request.apiBaseUrl, modelName);
  const env = { ...process.env };
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
    // Auto-detect provider for env var hints
    const provider = detectProvider(apiKey, modelName);
    if (provider === "DeepSeek" && !userBaseUrl) {
      env.OPENAI_BASE_URL = env.OPENAI_BASE_URL || "https://api.deepseek.com";
    }
  }
  // Ensure OpenClaw has a provider configured (once per session)
  if (apiKey && !openclawProviderConfigured) {
    try {
      const { execFileSync } = require("child_process");
      const baseUrl = userBaseUrl || "https://api.deepseek.com";
      const providerKey = baseUrl.includes("deepseek") ? "deepseek" : "openai";
      const patch = {
        models: {
          mode: "merge",
          providers: {
            [providerKey]: {
              baseUrl: baseUrl,
              api: "openai-completions",
              apiKey: apiKey,
              models: [{ id: modelName || "deepseek-chat", name: modelName || "DeepSeek Chat", input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
            }
          }
        }
      };
      execFileSync(openclawPath(), ["config", "patch", "--stdin"], {
        input: JSON.stringify(patch),
        timeout: 10000,
        stdio: "pipe",
      });
      openclawProviderConfigured = true;
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
    const action = await adapter._runAgainstAsync(target.baseUrl, (flag, targetUrl) => {
      client.send(
        "SUBMIT_FLAG_REQ",
        { match_id: request.matchId, flag, source: "electron-agent", claimed_target_team_id: targetUrl },
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
