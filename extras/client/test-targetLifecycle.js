const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  TargetLifecycleError,
  runTargetAction,
  validateLocalHealthUrl,
} = require("./targetLifecycle");

function runtimeFixture(overrides = {}) {
  const composeFile = path.resolve(__dirname, "..", "targets", "real_ctf_web_awd_01", "docker-compose.yml");
  const cwd = path.dirname(composeFile);
  return {
    project_name: "aiawd_room_001_team_a",
    health_url: "http://127.0.0.1:18081/health",
    commands: {
      install: commandFixture(cwd, composeFile, [["build"]]),
      start: commandFixture(cwd, composeFile, [["up", "-d"]]),
      stop: commandFixture(cwd, composeFile, [["down"]]),
      reset: commandFixture(cwd, composeFile, [
        ["down", "-v"],
        ["up", "-d"],
      ]),
    },
    ...overrides,
  };
}

function commandFixture(cwd, composeFile, steps) {
  return {
    argv: steps.map((step) => ["docker", "compose", "-p", "aiawd_room_001_team_a", "-f", composeFile, ...step]),
    cwd,
    env: {
      AIAWD_ROOM_ID: "room_001",
      AIAWD_TEAM_ID: "team_a",
      AIAWD_HTTP_PORT: "18081",
      AIAWD_FLAG: "FLAG{已隐藏}",
    },
  };
}

test("runs an allowed docker compose action and injects the private flag locally", async () => {
  const seen = [];
  const result = await runTargetAction(
    {
      action: "start",
      runtime: runtimeFixture(),
      flag: "FLAG{secret}",
    },
    {
      runner: async (argv, options) => {
        seen.push({ argv, cwd: options.cwd, flag: options.env.AIAWD_FLAG, shell: options.shell });
        return { status: 0, stdout: "started", stderr: "" };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.message, "启动完成");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].argv.at(-2), "up");
  assert.equal(seen[0].argv.at(-1), "-d");
  assert.equal(seen[0].flag, "FLAG{secret}");
  assert.doesNotMatch(JSON.stringify(result), /FLAG\{secret\}/);
});

test("accepts relative compose paths from remote server plans", async () => {
  const relativeCompose = path.join("targets", "real_ctf_web_awd_01", "docker-compose.yml");
  const relativeCwd = path.join("targets", "real_ctf_web_awd_01");
  const seen = [];
  const result = await runTargetAction(
    {
      action: "start",
      runtime: runtimeFixture({
        commands: {
          start: commandFixture(relativeCwd, relativeCompose, [["up", "-d"]]),
        },
      }),
      flag: "FLAG{secret}",
    },
    {
      runner: async (argv, options) => {
        seen.push({ argv, cwd: options.cwd });
        return { status: 0, stdout: "started", stderr: "" };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cwd, path.resolve(__dirname, "..", relativeCwd));
  assert.equal(seen[0].argv[5], path.resolve(__dirname, "..", relativeCompose));
});

test("doctor checks Docker readiness without running target commands or leaking flags", async () => {
  const seen = [];
  const result = await runTargetAction(
    {
      action: "doctor",
      runtime: runtimeFixture(),
      flag: "FLAG{secret}",
    },
    {
      runner: async () => {
        throw new Error("target lifecycle command should not run");
      },
      doctorRunner: async (argv) => {
        seen.push(argv);
        if (argv.join(" ") === "docker info") {
          return { status: 1, stdout: "", stderr: "Cannot connect to Docker daemon FLAG{secret}" };
        }
        return { status: 0, stdout: `${argv.join(" ")} ok`, stderr: "" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, "本地靶机诊断发现问题：Docker daemon");
  assert.deepEqual(seen, [
    ["docker", "--version"],
    ["docker", "compose", "version"],
    ["docker", "info"],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /FLAG\{secret\}/);
  assert.match(JSON.stringify(result), /FLAG\{已隐藏\}/);
});

test("rejects out-of-scope health checks", async () => {
  await assert.rejects(
    () =>
      runTargetAction({
        action: "health",
        runtime: runtimeFixture({ health_url: "http://example.com/health" }),
      }),
    (error) => error instanceof TargetLifecycleError && error.code === "OUT_OF_SCOPE_HEALTHCHECK",
  );
});

test("runs localhost health checks through the provided checker", async () => {
  const result = await runTargetAction(
    {
      action: "health",
      runtime: runtimeFixture(),
    },
    {
      healthChecker: async (url) => {
        assert.equal(url, "http://127.0.0.1:18081/health");
        return true;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.message, "本地靶机健康检查通过");
  assert.equal(validateLocalHealthUrl("http://localhost:18081/health"), "http://localhost:18081/health");
});

test("rejects shell-style or non-allowlisted commands", async () => {
  const runtime = runtimeFixture();
  runtime.commands.start.argv = [["docker", "compose", "-p", "aiawd_room_001_team_a", "-f", runtime.commands.start.argv[0][5], "up", "-d", "&&"]];

  await assert.rejects(
    () => runTargetAction({ action: "start", runtime }),
    (error) => error instanceof TargetLifecycleError && error.code === "UNSAFE_COMMAND",
  );
});

test("rejects compose paths outside the project", async () => {
  const runtime = runtimeFixture();
  runtime.commands.start.cwd = "/tmp";
  runtime.commands.start.argv[0][5] = "/tmp/docker-compose.yml";

  await assert.rejects(
    () => runTargetAction({ action: "start", runtime }),
    (error) => error instanceof TargetLifecycleError && error.code === "OUT_OF_SCOPE_PATH",
  );
});

test("rejects remote absolute compose paths", async () => {
  const runtime = runtimeFixture();
  runtime.commands.start.cwd = "/Users/server/ai-awd/targets/real_ctf_web_awd_01";
  runtime.commands.start.argv[0][5] = "/Users/server/ai-awd/targets/real_ctf_web_awd_01/docker-compose.yml";

  await assert.rejects(
    () => runTargetAction({ action: "start", runtime }),
    (error) => error instanceof TargetLifecycleError && error.code === "OUT_OF_SCOPE_PATH",
  );
});
