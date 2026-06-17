"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const {
  makeContext,
  contextEnv,
  extractFlags,
  expandTemplate,
  sanitizeCommand,
  commandNeedsShell,
  prepareSpawnArgv,
  CustomCommandAdapter,
  AgentManager,
} = require("./agentRuntime.js");

describe("makeContext", () => {
  it("builds context from match config and room status", () => {
    const config = {
      match_id: "match_001",
      room_id: "room_x",
      team_id: "team_a",
      phase: "ATTACK",
      opponents: [{ team_id: "team_b", base_url: "http://127.0.0.1:18082" }],
      local_target: { host: "127.0.0.1", port: 18081, base_url: "http://127.0.0.1:18081" },
      allowed_targets: ["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
      target_template_id: "real_ctf_web_awd_01",
    };
    const ctx = makeContext(config, "ATTACK");
    assert.strictEqual(ctx.matchId, "match_001");
    assert.strictEqual(ctx.roomId, "room_x");
    assert.strictEqual(ctx.teamId, "team_a");
    assert.strictEqual(ctx.phase, "ATTACK");
    assert.strictEqual(ctx.targets.length, 1);
  });
});

describe("contextEnv", () => {
  it("exports all fields as env vars", () => {
    const ctx = makeContext(
      {
        match_id: "m1",
        room_id: "r1",
        team_id: "t1",
        opponents: [{ team_id: "t2", base_url: "http://127.0.0.1:18082" }],
        local_target: { base_url: "http://127.0.0.1:18081" },
        allowed_targets: ["http://127.0.0.1:18081"],
        target_template_id: "tpl",
      },
      "ATTACK"
    );
    const env = contextEnv(ctx);
    assert.strictEqual(env.AIAWD_MATCH_ID, "m1");
    assert.strictEqual(env.AIAWD_PHASE, "ATTACK");
    assert.strictEqual(env.AIAWD_LOCAL_TARGET, "http://127.0.0.1:18081");
  });
});

describe("extractFlags", () => {
  it("finds braced flags in output", () => {
    const flags = extractFlags("Found FLAG{abc_123} and FLAG{xyz-789}");
    assert.deepStrictEqual(flags, ["FLAG{abc_123}", "FLAG{xyz-789}"]);
  });

  it("returns empty array for non-flag text", () => {
    assert.deepStrictEqual(extractFlags("no flags here"), []);
  });
});

describe("expandTemplate", () => {
  it("replaces target_url placeholder", () => {
    const ctx = makeContext({
      match_id: "m1", room_id: "r1", team_id: "t1",
      opponents: [], local_target: { base_url: "http://127.0.0.1:18081" },
      allowed_targets: [], target_template_id: "",
    }, "ATTACK");
    const result = expandTemplate(["curl", "{target_url}/health"], "http://127.0.0.1:18082", ctx);
    assert.deepStrictEqual(result, ["curl", "http://127.0.0.1:18082/health"]);
  });
});

describe("sanitizeCommand", () => {
  it("rejects semicolon tokens", () => {
    assert.strictEqual(sanitizeCommand(["ls;", "rm"]), false);
  });

  it("rejects pipe control token", () => {
    assert.strictEqual(sanitizeCommand(["echo", "|", "grep"]), false);
  });

  it("accepts safe argv", () => {
    assert.strictEqual(sanitizeCommand(["curl", "http://127.0.0.1:18081"]), true);
    assert.strictEqual(sanitizeCommand(["docker", "compose", "up", "-d"]), true);
  });

  it("rejects ampersand background operator", () => {
    assert.strictEqual(sanitizeCommand(["sleep", "10", "&"]), false);
    assert.strictEqual(sanitizeCommand(["sleep", "10", "&", "ls"]), false);
    assert.strictEqual(sanitizeCommand(["cmd", "&"]), false);
  });

  it("rejects ampersand as standalone token", () => {
    assert.strictEqual(sanitizeCommand(["cmd1", "&", "cmd2"]), false);
  });
});

describe("Windows command spawning", () => {
  it("uses shell for cmd and bat entrypoints only on Windows", () => {
    assert.strictEqual(commandNeedsShell("openclaw.cmd", "win32"), true);
    assert.strictEqual(commandNeedsShell("openclaw.bat", "win32"), true);
    assert.strictEqual(commandNeedsShell("openclaw.exe", "win32"), false);
    assert.strictEqual(commandNeedsShell("openclaw.cmd", "darwin"), false);
  });

  it("quotes arguments with spaces before shell spawning", () => {
    const argv = prepareSpawnArgv(
      ["C:\\Users\\mac\\AppData\\Roaming\\npm\\openclaw.cmd", "infer", "--prompt", "You are an AWD agent"],
      "win32",
    );

    assert.deepStrictEqual(argv, [
      "C:\\Users\\mac\\AppData\\Roaming\\npm\\openclaw.cmd",
      "infer",
      "--prompt",
      "\"You are an AWD agent\"",
    ]);
  });
});

describe("CustomCommandAdapter", () => {
  it("requires configure before running", () => {
    const adapter = new CustomCommandAdapter(["echo", "hello"]);
    const result = adapter.run();
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes("未配置"));
  });

  it("runs command and extracts flags", () => {
    const ctx = makeContext({
      match_id: "m1", room_id: "r1", team_id: "t1",
      opponents: [{ team_id: "t2", base_url: "http://127.0.0.1:18082" }],
      local_target: { base_url: "http://127.0.0.1:18081" },
      allowed_targets: ["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
      target_template_id: "tpl",
    }, "ATTACK");
    const adapter = new CustomCommandAdapter(["echo", "FLAG{test_node}"]);
    adapter.configure(ctx);
    const result = adapter.run();
    assert.strictEqual(result.ok, true);
    assert.ok(result.flagsCaptured.includes("FLAG{test_node}"));
  });

  it("submits flags through callback", () => {
    const ctx = makeContext({
      match_id: "m1", room_id: "r1", team_id: "t1",
      opponents: [{ team_id: "t2", base_url: "http://127.0.0.1:18082" }],
      local_target: { base_url: "http://127.0.0.1:18081" },
      allowed_targets: ["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
      target_template_id: "tpl",
    }, "ATTACK");
    const submitted = [];
    const submit = (flag, targetUrl) => submitted.push({ flag, targetUrl });
    const adapter = new CustomCommandAdapter(["echo", "FLAG{submit_node}"]);
    adapter.configure(ctx);
    adapter.run(submit);
    assert.strictEqual(submitted.length, 1);
    assert.strictEqual(submitted[0].flag, "FLAG{submit_node}");
  });
});

describe("AgentManager", () => {
  it("configures adapter and tracks running state", () => {
    const adapter = new CustomCommandAdapter(["echo", "FLAG{mgr_test}"]);
    const manager = new AgentManager(adapter);
    assert.strictEqual(manager.running, false);
    manager.configure({
      match_id: "m1", room_id: "r1", team_id: "t1",
      opponents: [{ team_id: "t2", base_url: "http://127.0.0.1:18082" }],
      local_target: { base_url: "http://127.0.0.1:18081" },
      allowed_targets: ["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
      target_template_id: "tpl",
    }, "ATTACK");
    const result = manager.runAttack();
    assert.strictEqual(manager.running, false);
    assert.ok(result.ok);
    assert.ok(result.flagsCaptured.includes("FLAG{mgr_test}"));
    assert.ok(manager.lastResult !== null);
  });
});
