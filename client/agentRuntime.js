"use strict";

const { spawn, spawnSync } = require("child_process");
const path = require("path");

const FLAG_PATTERN = /FLAG\{[A-Za-z0-9_/-]+\}/gi;
const SHELL_CONTROL = new Set([";", "&", "&&", "||", "|"]);
const SHELL_EXPANSION = ["$(", "${", "`"];
const SHELL_DANGEROUS = new Set([";", "\n", "\r", "\t", "#", "~"]);

/**
 * @typedef {Object} AgentContext
 * @property {string} matchId
 * @property {string} roomId
 * @property {string} teamId
 * @property {string} phase
 * @property {Array<{teamId: string, baseUrl: string}>} targets
 * @property {{host: string, port: number, baseUrl: string}} localTarget
 * @property {string[]} allowedTargets
 * @property {string} targetTemplateId
 * @property {number} timeoutSec
 */

/**
 * @typedef {Object} AgentAction
 * @property {number} timestamp
 * @property {string} action
 * @property {string|null} targetUrl
 * @property {string|null} flag
 * @property {string} output
 * @property {boolean} ok
 */

/**
 * @typedef {Object} AgentResult
 * @property {boolean} ok
 * @property {AgentAction[]} actions
 * @property {string[]} flagsCaptured
 * @property {string|null} error
 * @property {number} elapsedMs
 */

/**
 * @callback FlagSubmitter
 * @param {string} flag
 * @param {string} targetUrl
 * @returns {{ok: boolean, code?: string}}
 */

function makeContext(matchConfig, roomStatus) {
  const opponents = matchConfig.opponents || [];
  const localTarget = matchConfig.local_target || {};
  const allowedTargets = matchConfig.allowed_targets || [];
  return {
    matchId: matchConfig.match_id || "",
    roomId: matchConfig.room_id || "",
    teamId: matchConfig.team_id || "",
    phase: roomStatus || matchConfig.phase || "",
    targets: opponents.map((o) => ({ teamId: o.team_id, baseUrl: o.base_url })),
    localTarget: {
      host: localTarget.host || "127.0.0.1",
      port: localTarget.port || 0,
      baseUrl: localTarget.base_url || "",
    },
    allowedTargets,
    targetTemplateId: matchConfig.target_template_id || "",
    timeoutSec: 300,
  };
}

function contextEnv(ctx) {
  return {
    AIAWD_MATCH_ID: ctx.matchId,
    AIAWD_ROOM_ID: ctx.roomId,
    AIAWD_TEAM_ID: ctx.teamId,
    AIAWD_PHASE: ctx.phase,
    AIAWD_TARGETS: JSON.stringify(ctx.targets.map((t) => t.baseUrl)),
    AIAWD_LOCAL_TARGET: ctx.localTarget.baseUrl,
    AIAWD_ALLOWED_TARGETS: JSON.stringify(ctx.allowedTargets),
    AIAWD_TARGET_TEMPLATE: ctx.targetTemplateId,
  };
}

function extractFlags(text) {
  const matches = text.match(FLAG_PATTERN);
  return matches || [];
}

function expandTemplate(template, targetUrl, ctx) {
  const replacements = {
    "{target_url}": targetUrl,
    "{local_target}": ctx ? ctx.localTarget.baseUrl : "",
    "{match_id}": ctx ? ctx.matchId : "",
    "{room_id}": ctx ? ctx.roomId : "",
    "{team_id}": ctx ? ctx.teamId : "",
  };
  return template.map((token) => {
    let result = token;
    for (const [placeholder, value] of Object.entries(replacements)) {
      result = result.replaceAll(placeholder, value);
    }
    return result;
  });
}

function sanitizeCommand(command) {
  for (const token of command) {
    if (SHELL_CONTROL.has(token)) return false;
    for (const expansion of SHELL_EXPANSION) {
      if (token.includes(expansion)) return false;
    }
    for (const char of token) {
      if (SHELL_DANGEROUS.has(char)) return false;
    }
  }
  return true;
}

function commandNeedsShell(command, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
}

function quoteShellArg(arg) {
  const text = String(arg);
  if (!/[ \t"]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function prepareSpawnArgv(argv, platform = process.platform) {
  if (!commandNeedsShell(argv[0], platform)) return argv;
  return argv.map(quoteShellArg);
}

class CustomCommandAdapter {
  /**
   * @param {string[]} command
   * @param {Object} [options]
   * @param {string} [options.cwd]
   * @param {Object<string,string>} [options.env]
   * @param {number} [options.timeoutSec]
   * @param {(text: string) => string[]} [options.extractFlagsFn]
   */
  constructor(command, options = {}) {
    this._commandTemplate = command;
    this._cwd = options.cwd || process.cwd();
    this._extraEnv = options.env || {};
    this._timeout = options.timeoutSec || 300;
    this._extractFlagsFn = options.extractFlagsFn || extractFlags;
    /** @type {AgentContext|null} */
    this._ctx = null;
    /** @type {ChildProcess|null} */
    this._process = null;
  }

  configure(ctx) {
    this._ctx = ctx;
    this._timeout = ctx.timeoutSec || 300;
  }

  /**
   * @param {FlagSubmitter} [submit]
   * @returns {AgentResult}
   */
  run(submit) {
    if (!this._ctx) {
      return { ok: false, actions: [], flagsCaptured: [], error: "Agent 未配置比赛上下文", elapsedMs: 0 };
    }
    const started = Date.now();
    /** @type {AgentAction[]} */
    const actions = [];
    /** @type {string[]} */
    const captured = [];
    const targets = this._ctx.targets;
    for (const target of targets) {
      if (!target || !target.baseUrl) continue;
      const action = this._runAgainst(target.baseUrl, submit);
      actions.push(action);
      if (action.flag) captured.push(action.flag);
      if (!action.ok) break;
    }
    return {
      ok: actions.every((a) => a.ok),
      actions,
      flagsCaptured: captured,
      elapsedMs: Date.now() - started,
      error: null,
    };
  }

  _runAgainst(targetUrl, submit) {
    const argv = expandTemplate(this._commandTemplate, targetUrl, this._ctx);
    const needsShell = commandNeedsShell(argv[0]);
    const shellArgv = prepareSpawnArgv(argv);
    const env = { ...process.env, ...contextEnv(this._ctx), ...this._extraEnv };
    const started = Date.now();
    try {
      const proc = spawnSync(shellArgv[0], shellArgv.slice(1), {
        cwd: this._cwd,
        env,
        timeout: this._timeout * 1000,
        encoding: "utf-8",
        stdio: "pipe",
        shell: needsShell,
      });
      if (proc.error) {
        return {
          timestamp: started, action: "attack", targetUrl,
          flag: null, output: proc.error.message || "", ok: false,
        };
      }
      const flags = this._extractFlagsFn(proc.stdout || "");
      if (submit) {
        for (const flag of flags) submit(flag, targetUrl);
      }
      return {
        timestamp: started, action: "attack", targetUrl,
        flag: flags[0] || null, output: proc.stdout || "", ok: true,
      };
    } catch (err) {
      return {
        timestamp: started, action: "attack", targetUrl,
        flag: null, output: err.message || "", ok: false,
      };
    }
  }

  _runAgainstAsync(targetUrl, submit) {
    const argv = expandTemplate(this._commandTemplate, targetUrl, this._ctx);
    const needsShell = commandNeedsShell(argv[0]);
    const shellArgv = prepareSpawnArgv(argv);
    const env = { ...process.env, ...contextEnv(this._ctx), ...this._extraEnv };
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(shellArgv[0], shellArgv.slice(1), {
        cwd: this._cwd,
        env,
        timeout: this._timeout * 1000,
        stdio: "pipe",
        shell: needsShell,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (err) => {
        resolve({
          timestamp: started, action: "attack", targetUrl,
          flag: null, output: err.message, ok: false,
        });
      });
      child.on("close", (code) => {
        const output = stdout + stderr;
        if (code !== 0) {
          resolve({
            timestamp: started, action: "attack", targetUrl,
            flag: null, output, ok: false,
          });
          return;
        }
        const flags = this._extractFlagsFn(output);
        if (submit) {
          for (const flag of flags) submit(flag, targetUrl);
        }
        resolve({
          timestamp: started, action: "attack", targetUrl,
          flag: flags[0] || null, output, ok: true,
        });
      });
    });
  }

  /**
   * Async version of run() — does NOT block the event loop.
   * Use this from Electron main process or any UI thread.
   * @param {FlagSubmitter} [submit]
   * @returns {Promise<AgentResult>}
   */
  async runAsync(submit) {
    if (!this._ctx) {
      return { ok: false, actions: [], flagsCaptured: [], error: "Agent 未配置比赛上下文", elapsedMs: 0 };
    }
    const started = Date.now();
    const actions = [];
    const captured = [];
    const targets = this._ctx.targets;
    for (const target of targets) {
      if (!target || !target.baseUrl) continue;
      const action = await this._runAgainstAsync(target.baseUrl, submit);
      actions.push(action);
      if (action.flag) captured.push(action.flag);
      if (!action.ok) break;
    }
    return {
      ok: actions.every((a) => a.ok),
      actions,
      flagsCaptured: captured,
      elapsedMs: Date.now() - started,
      error: null,
    };
  }

  stop() {
    if (this._process && !this._process.killed) {
      this._process.kill("SIGTERM");
      setTimeout(() => {
        if (this._process && !this._process.killed) {
          this._process.kill("SIGKILL");
        }
      }, 5000);
    }
  }
}

class AgentManager {
  /**
   * @param {CustomCommandAdapter} adapter
   */
  constructor(adapter) {
    this.adapter = adapter;
    /** @type {AgentResult[]} */
    this._results = [];
    this._running = false;
  }

  configure(matchConfig, roomStatus) {
    const ctx = makeContext(matchConfig, roomStatus);
    this.adapter.configure(ctx);
  }

  /**
   * @param {FlagSubmitter} [submit]
   * @returns {AgentResult}
   */
  runAttack(submit) {
    this._running = true;
    const result = this.adapter.run(submit);
    this._results.push(result);
    this._running = false;
    return result;
  }

  /**
   * Async version — does NOT block the event loop.
   * @param {FlagSubmitter} [submit]
   * @returns {Promise<AgentResult>}
   */
  async runAttackAsync(submit) {
    this._running = true;
    const result = await this.adapter.runAsync(submit);
    this._results.push(result);
    this._running = false;
    return result;
  }

  stop() {
    this.adapter.stop();
    this._running = false;
  }

  get running() {
    return this._running;
  }

  get lastResult() {
    return this._results.length > 0 ? this._results[this._results.length - 1] : null;
  }
}

/**
 * Split agent output into natural-language activity steps.
 * Used by the Electron main process to report per-step AGENT_ACTIVITY events.
 */
function parseActivitySteps(output, targetUrl, ok, flag) {
  if (!output) return [];
  const steps = [];

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

module.exports = {
  makeContext,
  contextEnv,
  extractFlags,
  expandTemplate,
  sanitizeCommand,
  commandNeedsShell,
  quoteShellArg,
  prepareSpawnArgv,
  parseActivitySteps,
  CustomCommandAdapter,
  AgentManager,
  FLAG_PATTERN,
};
