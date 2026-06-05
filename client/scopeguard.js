"use strict";

/** ScopeGuard — client-side safety boundary for AI-AWD agent operations. */

const { URL } = require("url");
const path = require("path");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SHELL_DANGEROUS = new Set([";", "&&", "||", "|", "`", "\n", "\r", ">", "<", "&"]);
const ALLOWED_ENV_KEYS = new Set([
  "AIAWD_MATCH_ID", "AIAWD_ROOM_ID", "AIAWD_TEAM_ID", "AIAWD_PHASE",
  "AIAWD_TARGETS", "AIAWD_LOCAL_TARGET", "AIAWD_ALLOWED_TARGETS",
  "AIAWD_TARGET_TEMPLATE", "AIAWD_FLAG", "AIAWD_HTTP_PORT",
  "PATH", "HOME", "USER", "TMPDIR", "TEMP", "LANG", "LC_ALL",
  "PYTHONPATH", "PYTHONUNBUFFERED",
]);

class GuardViolation {
  /** @param {string} rule @param {string} message @param {string} [detail] */
  constructor(rule, message, detail = "") {
    this.rule = rule;
    this.message = message;
    this.detail = detail;
  }
}

class GuardResult {
  constructor() {
    /** @type {boolean} */
    this.allowed = true;
    /** @type {GuardViolation[]} */
    this.violations = [];
  }

  reject(rule, message, detail = "") {
    this.allowed = false;
    this.violations.push(new GuardViolation(rule, message, detail));
    return this;
  }
}

class ScopeGuard {
  /** @param {Object} [options] @param {string} [options.root] */
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    /** @type {GuardResult[]} */
    this._audit = [];
  }

  get auditLog() {
    return [...this._audit];
  }

  /** @param {string} url @param {string[]} [allowedTargets] @returns {GuardResult} */
  validateTargetUrl(url, allowedTargets) {
    const result = new GuardResult();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return result.reject("NETWORK_SCOPE", "无效的 URL", url);
    }
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
      result.reject("NETWORK_SCOPE", "靶机只能位于本机地址", url);
    }
    if (allowedTargets && !allowedTargets.includes(url)) {
      result.reject("NETWORK_SCOPE", "目标不在允许列表内", url);
    }
    this._audit.push(result);
    return result;
  }

  /** @param {string[]} urls @param {string[]} allowedTargets @returns {GuardResult} */
  validateAllTargets(urls, allowedTargets) {
    const result = new GuardResult();
    for (const url of urls) {
      const urlResult = this.validateTargetUrl(url, allowedTargets);
      if (!urlResult.allowed) {
        result.allowed = false;
        result.violations.push(...urlResult.violations);
      }
    }
    return result;
  }

  /** @param {string} filePath @param {boolean} [mustExist] @returns {GuardResult} */
  validatePath(filePath, mustExist = false) {
    const result = new GuardResult();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      result.reject("FILE_SCOPE", "文件路径必须位于项目目录内", filePath);
    }
    if (mustExist) {
      try {
        require("fs").accessSync(resolved);
      } catch {
        result.reject("FILE_SCOPE", "文件不存在", filePath);
      }
    }
    this._audit.push(result);
    return result;
  }

  /** @param {string[]} argv @returns {GuardResult} */
  validateCommand(argv) {
    const result = new GuardResult();
    for (const token of argv) {
      if (SHELL_DANGEROUS.has(token)) {
        result.reject("PROCESS_SAFE", "命令不能包含 shell 控制符", token);
      }
      for (const char of token) {
        if (char === "`" || char === "$" || char === "\n" || char === "\r") {
          result.reject("PROCESS_SAFE", "命令包含危险字符", token);
          break;
        }
      }
      if (token.includes("$(") || token.includes("${")) {
        result.reject("PROCESS_SAFE", "命令包含变量展开", token);
      }
    }
    this._audit.push(result);
    return result;
  }

  /** @param {Object<string,string>} env @returns {GuardResult} */
  validateEnv(env) {
    const result = new GuardResult();
    for (const key of Object.keys(env)) {
      if (!ALLOWED_ENV_KEYS.has(key) && !key.startsWith("AIAWD_")) {
        result.reject("ENV_SCOPE", "环境变量不在允许列表内", key);
      }
    }
    this._audit.push(result);
    return result;
  }

  /** @param {number} timeoutSec @param {number} [maxSec] @returns {GuardResult} */
  validateTimeout(timeoutSec, maxSec = 600) {
    const result = new GuardResult();
    if (timeoutSec <= 0 || timeoutSec > maxSec) {
      result.reject("TIMEOUT_SCOPE", `超时必须在 1-${maxSec} 秒之间`, String(timeoutSec));
    }
    this._audit.push(result);
    return result;
  }

  /** @param {Object} opts @returns {GuardResult} */
  guardAgentRun(opts) {
    const { command, targets, allowedTargets, cwd, env, timeoutSec } = opts;
    const results = [
      this.validateCommand(command),
      this.validateAllTargets(targets, allowedTargets),
      this.validatePath(cwd, true),
      this.validateEnv(env),
      this.validateTimeout(timeoutSec),
    ];
    const violations = [];
    let allowed = true;
    for (const r of results) {
      if (!r.allowed) allowed = false;
      violations.push(...r.violations);
    }
    return { allowed, violations };
  }

  /** @returns {{totalChecks: number, blocked: number, allowed: number, violationsByRule: Object<string,number>}} */
  securitySummary() {
    const total = this._audit.length;
    let blocked = 0;
    const byRule = {};
    for (const r of this._audit) {
      if (!r.allowed) {
        blocked++;
        for (const v of r.violations) {
          byRule[v.rule] = (byRule[v.rule] || 0) + 1;
        }
      }
    }
    return {
      totalChecks: total,
      blocked,
      allowed: total - blocked,
      violationsByRule: byRule,
    };
  }
}

module.exports = { ScopeGuard, GuardResult, GuardViolation, LOCAL_HOSTS };
