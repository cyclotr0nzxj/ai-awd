const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const ACTIONS = new Set(["install", "start", "stop", "reset", "health"]);
const ACTION_LABELS = {
  install: "安装",
  start: "启动",
  stop: "停止",
  reset: "重置",
  health: "巡检",
};
const EXPECTED_STEPS = {
  install: [["build"]],
  start: [["up", "-d"]],
  stop: [["down"]],
  reset: [
    ["down", "-v"],
    ["up", "-d"],
  ],
};
const ALLOWED_ENV = new Set(["AIAWD_ROOM_ID", "AIAWD_TEAM_ID", "AIAWD_HTTP_PORT", "AIAWD_FLAG"]);
const SAFE_PROJECT = /^[A-Za-z0-9_-]+$/;
const SHELL_TOKENS = new Set([";", "&&", "||", "|", ">", "<", "`"]);
const MAX_OUTPUT = 2000;

class TargetLifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TargetLifecycleError";
    this.code = code;
  }
}

async function runTargetAction(request, options = {}) {
  const action = validateAction(request?.action);
  const runtime = validateRuntime(request?.runtime);
  if (action === "health") {
    const ok = await checkTargetHealth(runtime, options);
    return {
      ok,
      action,
      label: ACTION_LABELS[action],
      healthUrl: runtime.health_url,
      message: ok ? "本地靶机健康检查通过" : "本地靶机健康检查未通过",
    };
  }

  const command = validateCommand(runtime, action);
  const env = commandEnv(command.env, request?.flag);
  const steps = [];
  for (const argv of command.argv) {
    const result = await (options.runner || spawnStep)(argv, { cwd: command.cwd, env });
    const exitCode = Number(result.status ?? result.exitCode ?? result.code ?? 0);
    steps.push({
      command: argv.join(" "),
      exitCode,
      stdout: outputTail(result.stdout),
      stderr: outputTail(result.stderr),
    });
    if (exitCode !== 0) {
      throw new TargetLifecycleError("COMMAND_FAILED", `${ACTION_LABELS[action]}失败：${argv.join(" ")}`);
    }
  }
  return {
    ok: true,
    action,
    label: ACTION_LABELS[action],
    projectName: runtime.project_name,
    steps,
    message: `${ACTION_LABELS[action]}完成`,
  };
}

function validateAction(action) {
  if (!ACTIONS.has(action)) {
    throw new TargetLifecycleError("BAD_ACTION", "未知本地靶机动作");
  }
  return action;
}

function validateRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new TargetLifecycleError("BAD_RUNTIME", "缺少本地靶机运行计划");
  }
  const projectName = stringField(runtime, "project_name");
  if (!SAFE_PROJECT.test(projectName)) {
    throw new TargetLifecycleError("BAD_PROJECT", "本地靶机项目名不合法");
  }
  validateLocalHealthUrl(stringField(runtime, "health_url"));
  if (!runtime.commands || typeof runtime.commands !== "object") {
    throw new TargetLifecycleError("BAD_RUNTIME", "运行计划缺少命令列表");
  }
  return runtime;
}

function validateCommand(runtime, action) {
  const command = runtime.commands[action];
  if (!command || typeof command !== "object") {
    throw new TargetLifecycleError("MISSING_COMMAND", `运行计划缺少 ${ACTION_LABELS[action]} 命令`);
  }
  const argvList = Array.isArray(command.argv) ? command.argv : [];
  if (!argvList.length) {
    throw new TargetLifecycleError("BAD_COMMAND", "命令必须是非空 argv 列表");
  }
  const cwd = validatePathInsideRepo(stringField(command, "cwd"), "cwd");
  const expectedSteps = EXPECTED_STEPS[action] || [];
  if (argvList.length !== expectedSteps.length) {
    throw new TargetLifecycleError("BAD_COMMAND", `${ACTION_LABELS[action]}命令步骤数量不匹配`);
  }
  const normalizedArgv = argvList.map((argv, index) =>
    validateComposeArgv(argv, runtime.project_name, cwd, expectedSteps[index]),
  );
  return {
    argv: normalizedArgv,
    cwd,
    env: validateEnv(command.env || {}),
  };
}

function validateComposeArgv(argv, projectName, cwd, expectedStep) {
  if (!Array.isArray(argv) || argv.some((token) => typeof token !== "string" || !token)) {
    throw new TargetLifecycleError("BAD_COMMAND", "Docker 命令必须使用字符串 argv");
  }
  for (const token of argv) {
    if (SHELL_TOKENS.has(token) || /[\n\r]/.test(token)) {
      throw new TargetLifecycleError("UNSAFE_COMMAND", "Docker 命令不能包含 shell 控制符");
    }
  }
  if (argv.length < 7 || argv[0] !== "docker" || argv[1] !== "compose" || argv[2] !== "-p" || argv[4] !== "-f") {
    throw new TargetLifecycleError("BAD_COMMAND", "仅允许 docker compose argv 命令");
  }
  if (argv[3] !== projectName) {
    throw new TargetLifecycleError("BAD_PROJECT", "Docker compose 项目名与运行计划不一致");
  }
  const composeFile = validatePathInsideRepo(argv[5], "compose_file");
  if (path.dirname(composeFile) !== cwd) {
    throw new TargetLifecycleError("BAD_COMMAND", "compose 文件目录必须等于命令 cwd");
  }
  const actualStep = argv.slice(6);
  if (JSON.stringify(actualStep) !== JSON.stringify(expectedStep)) {
    throw new TargetLifecycleError("UNSAFE_COMMAND", "Docker compose 子命令不在允许列表内");
  }
  return [...argv.slice(0, 5), composeFile, ...actualStep];
}

function validateEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new TargetLifecycleError("BAD_ENV", "命令环境变量必须是对象");
  }
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ALLOWED_ENV.has(key)) {
      throw new TargetLifecycleError("BAD_ENV", "命令环境变量包含未授权键");
    }
    result[key] = String(value);
  }
  return result;
}

function commandEnv(env, flag) {
  const merged = { ...process.env, ...env };
  if (typeof flag === "string" && flag.trim()) {
    merged.AIAWD_FLAG = flag;
  }
  return merged;
}

async function checkTargetHealth(runtime, options = {}) {
  const url = validateLocalHealthUrl(stringField(runtime, "health_url"));
  if (options.healthChecker) {
    return Boolean(await options.healthChecker(url));
  }
  return defaultHealthCheck(url);
}

function validateLocalHealthUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TargetLifecycleError("BAD_HEALTH_URL", "健康检查 URL 不合法");
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new TargetLifecycleError("OUT_OF_SCOPE_HEALTHCHECK", "健康检查只能访问本机 HTTP 靶机");
  }
  return parsed.toString();
}

function defaultHealthCheck(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 5000 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on("timeout", () => {
      request.destroy(new TargetLifecycleError("HEALTH_TIMEOUT", "本地靶机健康检查超时"));
    });
    request.on("error", reject);
  });
}

function spawnStep(argv, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout = outputTail(stdout + chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      stderr = outputTail(stderr + chunk.toString());
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

function outputTail(value) {
  const text = String(value || "");
  return text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text;
}

function validatePathInsideRepo(value, label) {
  const resolved = path.resolve(value);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TargetLifecycleError("OUT_OF_SCOPE_PATH", `${label} 必须位于项目目录内`);
  }
  return resolved;
}

function stringField(object, key) {
  const value = object?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TargetLifecycleError("BAD_RUNTIME", `运行计划缺少 ${key}`);
  }
  return value;
}

module.exports = {
  ACTION_LABELS,
  TargetLifecycleError,
  runTargetAction,
  validateCommand,
  validateRuntime,
  validateLocalHealthUrl,
};
