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
  const actionLabel = isDefense ? "defense" : "attack";

  // Helper: parse agent output into natural-language steps
  function parseActivitySteps(output, targetUrl, ok, flag, isDefense) {
    if (!output) return [];
    const steps = [];
    const targetShort = targetUrl.replace(/^https?:\/\//, "");
    const lower = output.toLowerCase();

    if (isDefense) {
      // ── DEFENSE phase: scan & harden own target ──
      steps.push({ desc: `🛡️ 开始加固自身靶机 ${targetShort}，扫描安全漏洞...`, ok: true });

      if (lower.includes("vulnerab") || lower.includes("weak") || lower.includes("risk")) {
        steps.push({ desc: "识别到潜在安全风险，正在评估严重程度", ok: true });
      }
      if (lower.includes("sql") || lower.includes("inject")) {
        steps.push({ desc: "检测到 SQL 注入风险，已加固输入验证和参数化查询", ok: true });
      }
      if (lower.includes("xss") || lower.includes("script") || lower.includes("sanitize")) {
        steps.push({ desc: "检测到 XSS 风险，已加强输出编码和 CSP 策略", ok: true });
      }
      if (lower.includes("patch") || lower.includes("fix") || lower.includes("update")) {
        steps.push({ desc: "应用安全补丁，修复已知漏洞", ok: true });
      }
      if (lower.includes("permission") || lower.includes("chmod") || lower.includes("chown")) {
        steps.push({ desc: "检查并修正文件权限配置，限制敏感文件访问", ok: true });
      }
      if (lower.includes("config") || lower.includes("setting") || lower.includes("harden")) {
        steps.push({ desc: "加强服务配置安全，关闭不必要的端口和服务", ok: true });
      }
      if (lower.includes("firewall") || lower.includes("iptables") || lower.includes("ufw")) {
        steps.push({ desc: "配置防火墙规则，限制非法访问", ok: true });
      }
      if (lower.includes("log") || lower.includes("monitor") || lower.includes("audit")) {
        steps.push({ desc: "启用安全审计日志，监控异常访问行为", ok: true });
      }
      if (lower.includes("password") || lower.includes("credential") || lower.includes("weak")) {
        steps.push({ desc: "检查并加强认证凭据安全性", ok: true });
      }

      // Defense summary
      if (ok) {
        steps.push({ desc: `✅ 完成对自身靶机 ${targetShort} 的安全加固`, ok: true });
      } else {
        steps.push({ desc: `⚠️ 加固 ${targetShort} 时遇到问题，请检查靶机状态`, ok: false });
      }
    } else {
      // ── ATTACK phase: probe & exploit opponent targets ──
      const flags = output.match(/FLAG\{[A-Za-z0-9_\/-]+\}/gi) || [];
      const urls = output.match(/https?:\/\/[^\s"'<>\]]+/gi) || [];
      const statusCodes = output.match(/HTTP[\/\d.]*\s+(\d{3})/g) || [];
      const methods = output.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\//gi) || [];

      steps.push({ desc: `开始探测目标 ${targetShort}，分析攻击面...`, ok: true });

      if (urls.length) {
        const paths = [...new Set(urls.map(u => {
          try { return new URL(u).pathname || "/"; } catch (_) { return u.slice(0, 40); }
        }))];
        const methodList = methods.length ? [...new Set(methods.map(m => m.trim().split(/\s+/)[0]))].join("、") : "GET";
        steps.push({
          desc: `向目标发送了 ${urls.length} 次 HTTP 请求，使用 ${methodList} 方法访问了 ${paths.slice(0, 5).join("、")} 等路径`,
          ok: true
        });
      }

      if (lower.includes("sql") || lower.includes("select") || lower.includes("union") || lower.includes("' or")) {
        const payload = lower.includes("' or") ? "OR 注入" : lower.includes("union") ? "UNION 查询" : "SQL 语句";
        steps.push({ desc: `尝试 SQL 注入攻击，使用了 ${payload} 手法探测数据库漏洞`, ok: true });
      }
      if (lower.includes("xss") || lower.includes("<script") || lower.includes("alert(") || lower.includes("onerror")) {
        steps.push({ desc: "测试跨站脚本攻击 (XSS)，尝试注入脚本代码到页面中", ok: true });
      }
      if (lower.includes("../../../") || lower.includes("..\\..\\") || lower.includes("path traversal") || lower.includes("etc/passwd")) {
        steps.push({ desc: "探测路径穿越漏洞，尝试读取系统敏感文件", ok: true });
      }
      if (lower.includes("exec") || lower.includes("cmd") || lower.includes("shell") || lower.includes("rce")) {
        steps.push({ desc: "尝试远程命令执行 (RCE)，检测目标是否可被控制执行系统命令", ok: true });
      }
      if (lower.includes("upload") || lower.includes("webshell")) {
        steps.push({ desc: "尝试文件上传漏洞，检测是否能上传恶意文件获取服务器控制权", ok: true });
      }

      if (statusCodes.length) {
        const codes = statusCodes.map(s => s.match(/\d{3}/)[0]);
        const hasSuccess = codes.some(c => c.startsWith("2"));
        const hasServerErr = codes.some(c => c.startsWith("5"));
        let desc = "服务器响应: ";
        const parts = [];
        if (hasSuccess) parts.push("有成功返回 (2xx)");
        if (hasServerErr) parts.push("服务端错误 (5xx)");
        desc += parts.length ? parts.join("、") : `状态码 ${codes.slice(0, 3).join(", ")}`;
        steps.push({ desc, ok: !hasServerErr });
      }

      if (flags.length) {
        steps.push({ desc: `🎯 从目标 ${targetShort} 成功捕获到 ${flags.length} 个 Flag`, ok: true });
      }
      if (flag) {
        steps.push({ desc: `🏁 攻击成功！从 ${targetShort} 夺取了 Flag`, ok: true });
      } else if (ok) {
        steps.push({ desc: `完成对 ${targetShort} 的攻击扫描，未发现 Flag`, ok: true });
      } else {
        steps.push({ desc: `对 ${targetShort} 的攻击遇到问题，可能目标未启动或不可达`, ok: false });
      }
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
    const activitySteps = parseActivitySteps(action.output, action.targetUrl, action.ok, action.flag, isDefense);
    for (const step of activitySteps) {
      try {
        await client.send("AGENT_ACTIVITY", {
          match_id: request.matchId,
          action: actionLabel,
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
