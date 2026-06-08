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
  const targets = ctx.targets;

  // Helper: parse agent output into natural-language steps
  function parseActivitySteps(output, targetUrl, ok, flag) {
    if (!output) return [];
    const steps = [];
    const targetShort = targetUrl.replace(/^https?:\/\//, "");

    // Extract meaningful actions from the output
    const flags = output.match(/FLAG\{[A-Za-z0-9_\/-]+\}/gi) || [];
    const urls = output.match(/https?:\/\/[^\s"'<>\]]+/gi) || [];
    const statusCodes = output.match(/HTTP[\/\d.]*\s+(\d{3})/g) || [];
    const methods = output.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\//gi) || [];

    // Step 1: Initial approach
    steps.push({ desc: `开始探测目标 ${targetShort}，分析攻击面...`, ok: true });

    // Step 2: Detect HTTP requests
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

    // Step 3: Detect vulnerability probes
    const lower = output.toLowerCase();
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
    if (lower.includes("upload") || lower.includes("webshell") || lower.includes(".php") || lower.includes("file_put_contents")) {
      steps.push({ desc: "尝试文件上传漏洞，检测是否能上传恶意文件获取服务器控制权", ok: true });
    }
    if (lower.includes("ssrf") || lower.includes("gopher") || lower.includes("dict://")) {
      steps.push({ desc: "探测服务端请求伪造 (SSRF)，尝试让目标服务器访问内部资源", ok: true });
    }
    if (lower.includes("jwt") || lower.includes("token") || lower.includes("session")) {
      steps.push({ desc: "分析目标认证机制，检测 JWT/Token/Session 是否存在弱点", ok: true });
    }

    // Step 4: Server responses
    if (statusCodes.length) {
      const codes = statusCodes.map(s => s.match(/\d{3}/)[0]);
      const hasSuccess = codes.some(c => c.startsWith("2"));
      const hasRedirect = codes.some(c => c.startsWith("3"));
      const hasClientErr = codes.some(c => c.startsWith("4"));
      const hasServerErr = codes.some(c => c.startsWith("5"));

      let responseDesc = "服务器响应: ";
      const parts = [];
      if (hasSuccess) parts.push("有成功返回 (2xx)");
      if (hasRedirect) parts.push("检测到重定向 (3xx)");
      if (hasClientErr) parts.push("客户端错误 (4xx)");
      if (hasServerErr) parts.push("服务端错误 (5xx)");
      responseDesc += parts.join("、");
      if (!parts.length) responseDesc += `状态码 ${codes.slice(0, 3).join(", ")}`;
      steps.push({ desc: responseDesc, ok: !hasServerErr });
    }

    // Step 5: Flag discovery
    if (flags.length) {
      steps.push({ desc: `🎯 从目标 ${targetShort} 成功捕获到 ${flags.length} 个 Flag`, ok: true });
    }

    // Step 6: Scan summary
    const scanTypes = [];
    if (lower.includes("nmap") || lower.includes("port")) scanTypes.push("端口扫描");
    if (lower.includes("dirb") || lower.includes("gobuster") || lower.includes("directory")) scanTypes.push("目录枚举");
    if (lower.includes("nikto") || lower.includes("vulnerability")) scanTypes.push("漏洞扫描");
    if (lower.includes("whois") || lower.includes("dns")) scanTypes.push("域名信息收集");
    if (scanTypes.length) {
      steps.push({ desc: `进行了信息收集: ${scanTypes.join("、")}`, ok: true });
    }

    // Step 7: Token usage (for Direct API)
    const tokenMatch = output.match(/\[prompt:(\d+)\s+completion:(\d+)\s+total:(\d+)\]/);
    if (tokenMatch) {
      steps.push({
        desc: `📊 本次调用消耗 Token: 输入 ${tokenMatch[1]} + 输出 ${tokenMatch[2]} = 总计 ${tokenMatch[3]}`,
        ok: true
      });
    }

    // Step 8: Final outcome
    if (flag) {
      steps.push({ desc: `🏁 攻击成功！从 ${targetShort} 夺取了 Flag: ${flag.slice(0, 50)}${flag.length > 50 ? "..." : ""}`, ok: true });
    } else if (ok) {
      const foundCount = flags.length;
      steps.push({
        desc: foundCount ? `完成对 ${targetShort} 的攻击，共发现 ${foundCount} 个 Flag` : `完成对 ${targetShort} 的攻击扫描，未发现 Flag`,
        ok: true
      });
    } else {
      steps.push({ desc: `对 ${targetShort} 的攻击遇到问题，可能目标未启动或不可达`, ok: false });
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
          action: action.action,
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
