const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { AiawdClient } = require("./aiawdProtocol");
const { runTargetAction } = require("./targetLifecycle");
const { CustomCommandAdapter, AgentManager, sanitizeCommand } = require("./agentRuntime");

let mainWindow = null;
const client = new AiawdClient();
/** @type {AgentManager|null} */
let agentManager = null;

// ====== Provider Detection (mirrored from renderer.js) ======
function detectProvider(apiKey, modelDisplayName) {
  if (!apiKey || !apiKey.trim()) {
    if (modelDisplayName) {
      const m = modelDisplayName.toLowerCase();
      if (m.includes("deepseek")) return "DeepSeek";
      if (m.includes("claude") || m.includes("anthropic")) return "Anthropic";
      if (m.includes("gpt") || m.includes("openai")) return "OpenAI";
      if (m.includes("gemini")) return "Google";
      if (m.includes("qwen") || m.includes("tongyi")) return "Alibaba";
      if (m.includes("hunyuan")) return "Tencent";
      if (m.includes("glm") || m.includes("chatglm") || m.includes("zhipu")) return "Zhipu";
      if (m.includes("kimi") || m.includes("moonshot")) return "Moonshot";
      if (m.includes("doubao")) return "ByteDance";
      if (m.includes("ernie") || m.includes("wenxin")) return "Baidu";
      if (m.includes("spark")) return "iFlytek";
      if (m.includes("minimax")) return "MiniMax";
      if (m.includes("stepfun") || m.includes("step-")) return "StepFun";
      if (m.includes("skywork")) return "Skywork";
      if (m.includes("baichuan")) return "Baichuan";
      if (m.includes("grok")) return "xAI";
      if (m.includes("mistral")) return "Mistral";
      if (m.includes("llama")) return "Meta";
      if (m.includes("cohere")) return "Cohere";
    }
    return "Custom";
  }
  const k = apiKey.trim();
  if (k.startsWith("sk-ant")) return "Anthropic";
  if (k.startsWith("sk-or-")) return "OpenRouter";
  if (k.startsWith("sk-")) {
    if (modelDisplayName) {
      const m = modelDisplayName.toLowerCase();
      if (m.includes("deepseek")) return "DeepSeek";
      if (m.includes("qwen") || m.includes("tongyi")) return "Alibaba";
      if (m.includes("hunyuan")) return "Tencent";
      if (m.includes("glm") || m.includes("zhipu")) return "Zhipu";
      if (m.includes("kimi") || m.includes("moonshot")) return "Moonshot";
      if (m.includes("doubao")) return "ByteDance";
      if (m.includes("ernie") || m.includes("wenxin")) return "Baidu";
      if (m.includes("minimax")) return "MiniMax";
      if (m.includes("yi-")) return "Yi";
      if (m.includes("grok")) return "xAI";
      if (m.includes("mistral")) return "Mistral";
      if (m.includes("cohere")) return "Cohere";
    }
    return "OpenAI";
  }
  if (k.startsWith("anthropic-")) return "Anthropic";
  if (k.startsWith("openai-")) return "OpenAI";
  if (k.startsWith("deepseek-")) return "DeepSeek";
  return "Custom";
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
  const modelName = (room.modelDisplayName || "").trim();
  const provider = detectProvider(apiKey, modelName);
  return client.send("CREATE_ROOM_REQ", {
    room_name: room.roomName,
    max_players: room.maxPlayers,
    target_template_id: room.targetTemplateId,
    display_name: room.displayName,
    agent_runtime: room.agentRuntime || "mock-agent",
    model_display_name: modelName || "mock-model",
    api_provider: provider,
    api_base_url: room.apiBaseUrl || "",
    allow_spectators: room.allowSpectators,
    phase_seconds: room.phaseSeconds,
  });
});
ipcMain.handle("aiawd:joinRoom", (_event, request) => {
  const apiKey = (request.apiKey || "").trim();
  const modelName = (request.modelDisplayName || "").trim();
  const provider = detectProvider(apiKey, modelName);
  return client.send(
    "JOIN_ROOM_REQ",
    {
      display_name: request.displayName,
      role: request.role,
      agent_runtime: request.agentRuntime || "mock-agent",
      model_display_name: modelName || "mock-model",
      api_provider: provider,
      api_base_url: request.apiBaseUrl || "",
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
  const { execSync } = require("child_process");
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
  } catch (_) {
    if (process.platform === "darwin") {
      try { execSync("open -a Docker", { stdio: "pipe", timeout: 10000 }); } catch (_) {}
      // Wait up to 30s for Docker to start
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
  }
  return runTargetAction(request);
});

ipcMain.handle("aiawd:agentStart", async (_event, request) => {
  if (!sanitizeCommand(request.command)) {
    return { ok: false, error: "Agent 命令包含不安全的 shell 控制符", flagsCaptured: [], actions: [], elapsedMs: 0 };
  }
  const apiKey = request.apiKey || "";
  const modelName = (request.modelDisplayName || "").trim();
  const userBaseUrl = request.apiBaseUrl || "";
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
  // Ensure OpenClaw has a provider configured for the user's API
  if (apiKey) {
    try {
      const fs = require("fs");
      const os = require("os");
      const ocConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
      let ocConfig = {};
      if (fs.existsSync(ocConfigPath)) {
        ocConfig = JSON.parse(fs.readFileSync(ocConfigPath, "utf-8"));
      }
      const models = ocConfig.models || (ocConfig.models = {});
      const providers = models.providers || (models.providers = {});
      const baseUrl = userBaseUrl || "https://api.deepseek.com";
      const providerKey = baseUrl.includes("deepseek") ? "deepseek" : "openai";
      if (!providers[providerKey]) {
        providers[providerKey] = {
          baseUrl: baseUrl,
          api: "openai-completions",
          apiKey: apiKey,
          models: [{ id: modelName || "deepseek-chat", name: modelName || "DeepSeek Chat", input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
        };
        models.mode = models.mode || "merge";
        fs.writeFileSync(ocConfigPath, JSON.stringify(ocConfig, null, 2));
      }
    } catch (_) { /* best-effort provider config */ }
  }

  const adapter = new CustomCommandAdapter(request.command, { env });

  // Manual attack loop with per-action activity reporting
  const { makeContext } = require("./agentRuntime");
  const ctx = makeContext(request.matchConfig || {}, request.roomStatus || "LOBBY");
  adapter.configure(ctx);
  agentManager = new AgentManager(adapter);
  const started = Date.now();
  const actions = [];
  const captured = [];
  // During DEFENSE, scan own target; during ATTACK, scan opponents
  const isDefense = (request.roomStatus || "") === "DEFENSE";
  const targets = isDefense
    ? [{ teamId: ctx.teamId, baseUrl: ctx.localTarget.baseUrl }]
    : ctx.targets;

  // Split agent output into natural-language steps — use agent's own words only
  function parseActivitySteps(output, targetUrl, ok, flag) {
    if (!output) return [];
    const steps = [];

    // Split into meaningful chunks
    const chunks = output
      .split(/\n\n+/)
      .flatMap(para => {
        const trimmed = para.trim();
        if (!trimmed) return [];
        if (trimmed.length > 200) {
          return trimmed.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
        }
        return [trimmed];
      })
      .map(s => s.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/\s+/g, " "))
      .filter(s => s.length > 15)
      .slice(0, 25);

    for (const chunk of chunks) {
      const isError = /error|fail|refused|denied|timeout/i.test(chunk);
      steps.push({ desc: chunk.slice(0, 200), ok: !isError });
    }

    if (flag) {
      steps.push({ desc: `Flag captured: ${flag}`, ok: true });
    }

    return steps;
  }

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
          action: isDefense ? "defense" : "attack",
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
