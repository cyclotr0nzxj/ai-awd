"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CLIENT_DIR = __dirname;

// ---------------------------------------------------------------------------
// Parse helpers — extract method / channel names from source, no hardcoding
// ---------------------------------------------------------------------------

/**
 * Parse preload.js and return every method exposed via
 * `contextBridge.exposeInMainWorld("aiawd", { ... })`.
 * Each entry => { methodName, channel, kind: "invoke" | "on" }.
 */
function parsePreloadMethods() {
  const src = fs.readFileSync(path.join(CLIENT_DIR, "preload.js"), "utf-8");
  const entries = [];

  // Single-line ipcRenderer.invoke methods:
  //   methodName: (params) => ipcRenderer.invoke("aiawd:channel", ...)
  const invokeRe = /(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*"([^"]+)"/g;
  let m;
  while ((m = invokeRe.exec(src)) !== null) {
    entries.push({ methodName: m[1], channel: m[2], kind: "invoke" });
  }

  // Multi-line ipcRenderer.on methods (onMessage, onStatus):
  //   methodName: (callback) => { ... ipcRenderer.on("aiawd:channel", ...) ... }
  const onRe = /(\w+):\s*\(callback\)\s*=>\s*\{[\s\S]*?ipcRenderer\.on\(\s*"([^"]+)"/g;
  while ((m = onRe.exec(src)) !== null) {
    entries.push({ methodName: m[1], channel: m[2], kind: "on" });
  }

  return entries;
}

/**
 * Parse main.js and return every IPC handler channel registered via
 * `ipcMain.handle("aiawd:...", ...)`.
 */
function parseIpcHandlers() {
  const src = fs.readFileSync(path.join(CLIENT_DIR, "main.js"), "utf-8");
  const handlers = [];
  // Match only the channel name — no closing paren required because
  // the handle call has further arguments after the string.
  const re = /ipcMain\.handle\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    handlers.push(m[1]);
  }
  return handlers;
}

// ---------------------------------------------------------------------------
// 1. Module imports — every required module is importable
// ---------------------------------------------------------------------------

describe("module imports", () => {
  it("imports AiawdClient from aiawdProtocol.js", () => {
    const { AiawdClient } = require("./aiawdProtocol.js");
    assert.strictEqual(typeof AiawdClient, "function");
  });

  it("imports runTargetAction from targetLifecycle.js", () => {
    const { runTargetAction } = require("./targetLifecycle.js");
    assert.strictEqual(typeof runTargetAction, "function");
  });

  it("imports CustomCommandAdapter, AgentManager, sanitizeCommand from agentRuntime.js", () => {
    const { CustomCommandAdapter, AgentManager, sanitizeCommand } =
      require("./agentRuntime.js");
    assert.strictEqual(typeof CustomCommandAdapter, "function");
    assert.strictEqual(typeof AgentManager, "function");
    assert.strictEqual(typeof sanitizeCommand, "function");
  });

  it("imports adapterFor, detectAvailableAdapters from adapters.js", () => {
    const { adapterFor, detectAvailableAdapters } = require("./adapters.js");
    assert.strictEqual(typeof adapterFor, "function");
    assert.strictEqual(typeof detectAvailableAdapters, "function");
  });

  it("imports ScopeGuard from scopeguard.js", () => {
    const { ScopeGuard } = require("./scopeguard.js");
    assert.strictEqual(typeof ScopeGuard, "function");
  });
});

describe("electron-builder package files", () => {
  it("includes every renderer-side runtime script used by index.html", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, "package.json"), "utf-8"));
    const files = new Set(packageJson.build.files);
    for (const requiredFile of [
      "renderer.js",
      "onboarding.js",
      "aiawdProtocol.js",
      "agentRuntime.js",
      "adapters.js",
      "scopeguard.js",
      "targetLifecycle.js",
      "index.html",
      "styles.css",
    ]) {
      assert.ok(files.has(requiredFile), `${requiredFile} must be packaged`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. sanitizeCommand — dangerous input is rejected
// ---------------------------------------------------------------------------

describe("sanitizeCommand blocks dangerous shell input", () => {
  const { sanitizeCommand } = require("./agentRuntime.js");

  it("rejects semicolon token", () => {
    assert.strictEqual(sanitizeCommand(["ls;", "rm"]), false);
  });

  it("rejects pipe token", () => {
    assert.strictEqual(sanitizeCommand(["echo", "|", "grep"]), false);
  });

  it("rejects single ampersand", () => {
    assert.strictEqual(sanitizeCommand(["sleep", "10", "&"]), false);
  });

  it("rejects double ampersand", () => {
    assert.strictEqual(sanitizeCommand(["make", "&&", "make", "install"]), false);
  });

  it("rejects double pipe", () => {
    assert.strictEqual(sanitizeCommand(["cmd1", "||", "cmd2"]), false);
  });

  it("rejects $(...) subshell expansion", () => {
    assert.strictEqual(sanitizeCommand(["echo", "$(whoami)"]), false);
  });

  it("rejects ${...} brace expansion", () => {
    assert.strictEqual(sanitizeCommand(["echo", "${HOME}"]), false);
  });

  it("rejects backtick expansion", () => {
    assert.strictEqual(sanitizeCommand(["echo", "`whoami`"]), false);
  });

  it("rejects newline in token", () => {
    assert.strictEqual(sanitizeCommand(["echo", "hello\nrm"]), false);
  });

  it("rejects hash character in token", () => {
    assert.strictEqual(sanitizeCommand(["ls", "#comment"]), false);
  });

  it("accepts safe argv", () => {
    assert.strictEqual(sanitizeCommand(["curl", "http://127.0.0.1:18081"]), true);
    assert.strictEqual(sanitizeCommand(["docker", "compose", "up", "-d"]), true);
    assert.strictEqual(sanitizeCommand(["python3", "script.py"]), true);
    assert.strictEqual(sanitizeCommand(["echo", "FLAG{test_flag}"]), true);
  });
});

// ---------------------------------------------------------------------------
// 3. detectAvailableAdapters — returns expected keys
// ---------------------------------------------------------------------------

describe("detectAvailableAdapters keys", () => {
  const { detectAvailableAdapters } = require("./adapters.js");

  it("returns object with expected keys (hermes, openclaw, opencli, codex, pi, python3)", () => {
    const available = detectAvailableAdapters();
    assert.ok("hermes" in available);
    assert.ok("openclaw" in available);
    assert.ok("opencli" in available);
    assert.ok("codex" in available);
    assert.ok("pi" in available);
    assert.ok("python3" in available);
  });

  it("returns exactly six keys with boolean values", () => {
    const available = detectAvailableAdapters();
    const keys = Object.keys(available);
    assert.strictEqual(keys.length, 6);
    for (const key of keys) {
      assert.strictEqual(typeof available[key], "boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// 4-6. IPC bridge wiring — preload <-> main bidirectional completeness
// ---------------------------------------------------------------------------

describe("IPC bridge wiring (parsed from source)", () => {
  const preloadMethods = parsePreloadMethods();
  const ipcHandlers = parseIpcHandlers();
  const ipcHandlerSet = new Set(ipcHandlers);
  const invokeMethods = preloadMethods.filter((e) => e.kind === "invoke");
  const pushMethods = preloadMethods.filter((e) => e.kind === "on");
  const invokeChannelSet = new Set(invokeMethods.map((e) => e.channel));

  it("preload exposes at least the expected number of invoke methods", () => {
    assert.ok(
      invokeMethods.length >= 15,
      `expected >= 15 invoke methods, got ${invokeMethods.length}`,
    );
  });

  it("preload exposes push-event listeners (onMessage, onStatus)", () => {
    assert.ok(
      pushMethods.length >= 2,
      `expected >= 2 on-event listeners, got ${pushMethods.length}`,
    );
    const names = pushMethods.map((e) => e.methodName);
    assert.ok(names.includes("onMessage"), "missing onMessage");
    assert.ok(names.includes("onStatus"), "missing onStatus");
  });

  it("every preload invoke method has a matching IPC handler in main.js", () => {
    const missing = [];
    for (const { methodName, channel } of invokeMethods) {
      if (!ipcHandlerSet.has(channel)) {
        missing.push(`${methodName} -> ${channel}`);
      }
    }
    assert.deepEqual(missing, [], `handlers missing for: ${missing.join(", ")}`);
  });

  it("every IPC handler in main.js is reachable from the preload bridge", () => {
    const unreachable = [];
    for (const ch of ipcHandlers) {
      if (!invokeChannelSet.has(ch)) {
        unreachable.push(ch);
      }
    }
    assert.deepEqual(
      unreachable,
      [],
      `unreachable handlers: ${unreachable.join(", ")}`,
    );
  });
});
