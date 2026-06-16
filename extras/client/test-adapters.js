"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  HermesAdapter,
  OpenClawAdapter,
  OpenCLIAdapter,
  CodexAdapter,
  PiAdapter,
  CustomPythonAdapter,
  adapterFor,
  detectAvailableAdapters,
} = require("./adapters.js");
const { CustomCommandAdapter } = require("./agentRuntime.js");

describe("adapterFor", () => {
  it("returns HermesAdapter for hermes identifier", () => {
    const adapter = adapterFor("hermes");
    assert.ok(adapter instanceof HermesAdapter);
  });

  it("returns OpenClawAdapter for openclaw identifier", () => {
    const adapter = adapterFor("openclaw");
    assert.ok(adapter instanceof OpenClawAdapter);
  });

  it("returns PiAdapter for pi identifier", () => {
    const adapter = adapterFor("pi");
    assert.ok(adapter instanceof PiAdapter);
  });

  it("returns OpenCLIAdapter for opencli identifier", () => {
    const adapter = adapterFor("opencli");
    assert.ok(adapter instanceof OpenCLIAdapter);
  });

  it("returns CodexAdapter for codex identifier", () => {
    const adapter = adapterFor("codex");
    assert.ok(adapter instanceof CodexAdapter);
  });

  it("returns CustomPythonAdapter for custom-python: prefix", () => {
    const adapter = adapterFor("custom-python:./Agent.py");
    assert.ok(adapter instanceof CustomPythonAdapter);
    assert.deepStrictEqual(adapter._commandTemplate, ["python3", "./Agent.py", "{target_url}"]);
  });

  it("falls back to CustomCommandAdapter for unknown identifier", () => {
    const adapter = adapterFor("echo FLAG{MixedCase}");
    assert.ok(adapter instanceof CustomCommandAdapter);
    assert.deepStrictEqual(adapter._commandTemplate, ["echo", "FLAG{MixedCase}"]);
  });
});

describe("HermesAdapter", () => {
  it("sets correct command template", () => {
    const adapter = new HermesAdapter({ hermesBin: "hermes" });
    assert.ok(adapter._commandTemplate.includes("-z"));
    assert.ok(adapter._commandTemplate.includes("--yolo"));
    const templateStr = adapter._commandTemplate.join(" ");
    assert.ok(templateStr.includes("{target_url}"));
  });

  it("adds model flag when specified", () => {
    const adapter = new HermesAdapter({ hermesBin: "hermes", model: "claude-opus-4-8" });
    assert.ok(adapter._commandTemplate.includes("-m"));
    assert.ok(adapter._commandTemplate.includes("claude-opus-4-8"));
  });
});

describe("OpenClawAdapter", () => {
  it("uses infer model run command", () => {
    const adapter = new OpenClawAdapter({ openclawBin: "echo" });
    assert.deepStrictEqual(
      adapter._commandTemplate.slice(0, 4),
      ["echo", "infer", "model", "run"],
    );
    assert.ok(adapter._commandTemplate.includes("--local"));
    assert.ok(adapter._commandTemplate.includes("--json"));
  });

  it("adds model flag when specified", () => {
    const adapter = new OpenClawAdapter({ openclawBin: "echo", model: "claude-sonnet-4-6" });
    assert.ok(adapter._commandTemplate.includes("--model"));
    assert.ok(adapter._commandTemplate.includes("claude-sonnet-4-6"));
  });
});

describe("PiAdapter", () => {
  it("includes print and json mode flags", () => {
    const adapter = new PiAdapter({ piBin: "echo" });
    assert.ok(adapter._commandTemplate.includes("--print"));
    assert.ok(adapter._commandTemplate.includes("--mode"));
    assert.ok(adapter._commandTemplate.includes("json"));
    const templateStr = adapter._commandTemplate.join(" ");
    assert.ok(templateStr.includes("{target_url}"));
  });

  it("adds model flag when specified", () => {
    const adapter = new PiAdapter({ piBin: "echo", model: "claude-sonnet-4-6" });
    assert.ok(adapter._commandTemplate.includes("--model"));
    assert.ok(adapter._commandTemplate.includes("claude-sonnet-4-6"));
  });
});

describe("OpenCLIAdapter", () => {
  it("uses browser extract command", () => {
    const adapter = new OpenCLIAdapter({ opencliBin: "opencli" });
    assert.deepStrictEqual(adapter._commandTemplate, ["opencli", "browser", "extract"]);
  });
});

describe("CodexAdapter", () => {
  it("uses codex exec json command", () => {
    const adapter = new CodexAdapter({ codexBin: "codex" });
    assert.deepStrictEqual(adapter._commandTemplate.slice(0, 3), ["codex", "exec", "--json"]);
    assert.ok(adapter._commandTemplate.join(" ").includes("{target_url}"));
  });
});

describe("detectAvailableAdapters", () => {
  it("returns object with expected keys", () => {
    const available = detectAvailableAdapters();
    assert.ok("hermes" in available);
    assert.ok("openclaw" in available);
    assert.ok("opencli" in available);
    assert.ok("codex" in available);
    assert.ok("pi" in available);
  });

  it("uses argv-based lookup without shell", () => {
    const calls = [];
    const available = detectAvailableAdapters((command, args, options) => {
      calls.push({ command, args, shell: options.shell });
      return { status: args[0] === "python3" ? 0 : 1 };
    });
    assert.deepStrictEqual(available, {
      hermes: false,
      openclaw: false,
      opencli: false,
      codex: false,
      pi: false,
      python3: true,
    });
    assert.ok(calls.every((call) => call.args.length === 1));
    assert.ok(calls.every((call) => call.shell === false));
  });
});
