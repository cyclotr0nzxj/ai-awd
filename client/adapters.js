"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const {
  CustomCommandAdapter,
  contextEnv,
  extractFlags,
  expandTemplate,
  sanitizeCommand,
} = require("./agentRuntime.js");

// Resolve the best available openclaw binary
function openclawPath() {
  // 1. Check for locally installed openclaw (user's PATH)
  const which = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(which, ["openclaw"], { stdio: "pipe", timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const localPath = result.stdout.toString().trim().split("\n")[0].trim();
      if (localPath && fs.existsSync(localPath)) {
        return localPath;
      }
    }
  } catch (_) { /* fall through */ }

  // 2. Check bundled binary (in app resources or dev mode)
  const bundledPaths = [];
  if (process.resourcesPath) {
    bundledPaths.push(path.join(process.resourcesPath, "bin", process.platform === "win32" ? "openclaw.exe" : "openclaw"));
  }
  bundledPaths.push(path.join(__dirname, "bin", process.platform === "win32" ? "openclaw.exe" : "openclaw"));
  for (const p of bundledPaths) {
    if (fs.existsSync(p)) return p;
  }

  // 3. Fallback: hope openclaw is in PATH
  return "openclaw";
}

/**
 * Base class for named CLI adapters.
 * Each subclass defines a commandTemplate getter and an adapterName.
 */
class BaseCLIAdapter extends CustomCommandAdapter {
  /** @param {Object} options */
  constructor(command, options = {}) {
    super(command, options);
  }

  /** @returns {string} */
  get adapterName() {
    return "base";
  }
}

class HermesAdapter extends BaseCLIAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.hermesBin]
   * @param {string} [options.model]
   */
  constructor(options = {}) {
    const bin = options.hermesBin || "hermes";
    const model = options.model || "";
    const prompt = `You are an AWD CTF security agent. Target: {target_url}. Find and report any FLAG{...} you discover. Use web tools to probe the target for vulnerabilities.`;
    const cmd = [bin, "-z", prompt, "--yolo"];
    if (model) { cmd.push("-m", model); }
    super(cmd, {
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec || 600,
    });
  }

  get adapterName() { return "Hermes"; }
}

class OpenClawAdapter extends BaseCLIAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.openclawBin]
   * @param {string} [options.model]
   * @param {string} [options.promptTemplate]
   */
  constructor(options = {}) {
    const bin = options.openclawBin || openclawPath();
    const model = options.model || "";
    const prompt = options.promptTemplate || (
      "You are an AWD (Attack-Defense) CTF agent. " +
      "Find the FLAG at target {target_url}. " +
      "Analyze the target, identify vulnerabilities, and output any FLAG{...} you find."
    );
    const cmd = [bin, "infer", "model", "run", "--local", "--json", "--prompt", prompt];
    if (model) cmd.push("--model", model);
    super(cmd, {
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec || 600,
    });
  }

  get adapterName() { return "OpenClaw"; }
}

class PiAdapter extends BaseCLIAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.piBin]
   * @param {string} [options.model]
   */
  constructor(options = {}) {
    const bin = options.piBin || "pi";
    const model = options.model || "";
    const systemPrompt = "You are an AWD CTF security agent. Use your read and bash tools to probe the target for vulnerabilities. Report any FLAG{...} you discover.";
    const userPrompt = "Find vulnerabilities at {target_url} and report any FLAG{...} patterns you find.";
    const cmd = [bin, "--print", "--mode", "json", "--system-prompt", systemPrompt, userPrompt];
    if (model) { cmd.splice(1, 0, "--model", model); }
    super(cmd, {
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec || 600,
    });
  }

  get adapterName() { return "Pi"; }
}

class OpenCLIAdapter extends BaseCLIAdapter {
  /** @param {Object} [options] @param {string} [options.opencliBin] */
  constructor(options = {}) {
    const bin = options.opencliBin || "opencli";
    super([bin, "browser", "extract"], {
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec || 600,
    });
    this._opencliBin = bin;
  }

  get adapterName() { return "OpenCLI"; }

  _runAgainst(targetUrl, submit) {
    const { spawnSync } = require("child_process");
    const argv = expandTemplate(this._commandTemplate, targetUrl, this._ctx);
    const env = { ...process.env, ...contextEnv(this._ctx), ...this._extraEnv };
    const started = Date.now();
    try {
      spawnSync(this._opencliBin, ["browser", "open", targetUrl], {
        cwd: this._cwd, env, timeout: 30_000, stdio: "pipe", shell: false,
      });
      const proc = spawnSync(argv[0], argv.slice(1), {
        cwd: this._cwd, env, timeout: this._timeout * 1000, encoding: "utf-8", stdio: "pipe", shell: false,
      });
      if (proc.error) {
        return { timestamp: started, action: "attack", targetUrl, flag: null, output: proc.error.message, ok: false };
      }
      const output = (proc.stdout || "") + (proc.stderr || "");
      const flags = this._extractFlagsFn(output);
      if (submit) { for (const flag of flags) submit(flag, targetUrl); }
      return { timestamp: started, action: "attack", targetUrl, flag: flags[0] || null, output, ok: true };
    } catch (err) {
      return { timestamp: started, action: "attack", targetUrl, flag: null, output: err.message || "", ok: false };
    }
  }
}

class CodexAdapter extends BaseCLIAdapter {
  /** @param {Object} [options] @param {string} [options.codexBin] @param {string} [options.promptTemplate] */
  constructor(options = {}) {
    const bin = options.codexBin || "codex";
    const prompt = options.promptTemplate || (
      "You are an AWD CTF agent. Target: {target_url}. " +
      "Find vulnerabilities in the web application. " +
      "Report any FLAG{...} you find exactly."
    );
    super([bin, "exec", "--json", prompt], {
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec || 600,
    });
  }

  get adapterName() { return "Codex"; }
}

class CustomPythonAdapter extends BaseCLIAdapter {
  /**
   * @param {string} scriptPath
   * @param {Object} [options]
   */
  constructor(scriptPath, options = {}) {
    super(["python3", scriptPath, "{target_url}"], {
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec || 600,
    });
  }

  get adapterName() { return "CustomPython"; }
}

/**
 * Create an adapter for the given runtime identifier.
 * @param {string} identifier
 * @param {Object} [options]
 * @returns {CustomCommandAdapter}
 */
function adapterFor(identifier, options = {}) {
  const raw = identifier.trim();
  const key = raw.toLowerCase();

  if (key === "hermes" || key === "hermes-local") {
    return new HermesAdapter(options);
  }
  if (key === "openclaw" || key === "openclaw-local") {
    return new OpenClawAdapter(options);
  }
  if (key === "opencli" || key === "browser") {
    return new OpenCLIAdapter(options);
  }
  if (key === "codex" || key === "codex-local") {
    return new CodexAdapter(options);
  }
  if (key === "pi" || key === "pi-local") {
    return new PiAdapter(options);
  }
  if (key.startsWith("custom-python:") || key.startsWith("script:")) {
    const scriptPath = raw.split(":")[1];
    return new CustomPythonAdapter(scriptPath, options);
  }

  // Fallback: treat as custom CLI command
  const command = raw.split(/\s+/).filter(Boolean);
  if (!command.length) {
    command.push("echo", "No agent command configured");
  }
  return new CustomCommandAdapter(command, {
    cwd: options.cwd,
    env: options.env,
    timeoutSec: options.timeoutSec || 300,
  });
}

/**
 * Check which agent runtimes are available on PATH.
 * @returns {Object<string, boolean>}
 */
function detectAvailableAdapters(runner = spawnSync) {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const which = (cmd) => {
    const result = runner(lookupCommand, [cmd], { stdio: "pipe", shell: false });
    return !result.error && Number(result.status ?? 0) === 0;
  };
  return {
    hermes: which("hermes"),
    openclaw: which("openclaw"),
    opencli: which("opencli"),
    codex: which("codex"),
    pi: which("pi"),
    python3: which("python3"),
  };
}

module.exports = {
  BaseCLIAdapter,
  HermesAdapter,
  OpenClawAdapter,
  OpenCLIAdapter,
  CodexAdapter,
  PiAdapter,
  CustomPythonAdapter,
  adapterFor,
  detectAvailableAdapters,
  openclawPath,
};
