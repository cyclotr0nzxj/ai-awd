const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ELEMENT_IDS = [
  "host", "port", "displayName", "connect", "disconnect",
  "connectionState", "clientId",
  "roomName", "maxPlayers", "targetTemplateId",
  "prepareSeconds", "defenseSeconds", "attackSeconds",
  "createRoom", "refreshRooms",
  "roomId", "agentRuntime", "modelDisplayName", "apiKey",
  "joinPlayer", "joinSpectator",
  "markTargetReady", "markAgentReady", "startMatch",
  "flagInput", "submitFlag",
  "roomList", "targetList", "players", "spectators",
  "selectedRoom", "myRole", "phase", "phaseTimer",
  "scoreSummary", "attackHeat",
  "nextStepBody",
  "roomSummary", "matchSummary", "attackKit",
  "targetLifecycleStatus",
  "targetDoctor", "targetInstall", "targetStart", "targetHealth", "targetStop", "targetReset",
  "arenaMap", "defenseBoard",
  "resultSummary", "podiumList", "captureRecap",
  "generateReport", "copyReport", "downloadReport", "reportPreview",
  "rankings", "events", "messages", "matchConfig",
  "agentCommand", "agentStart", "agentStop", "agentStatus",
  "startOnboarding",
  "onboardingOverlay", "onboardingSpotlight", "onboardingTooltip", "onboardingProgress",
];

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this._innerHTML = "";
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.listeners = {};
    this._classList = new Set();
    this._style = {};
  }

  get classList() {
    return {
      add: (name) => this._classList.add(name),
      remove: (name) => this._classList.delete(name),
      contains: (name) => this._classList.has(name),
      toggle: (name) => {
        if (this._classList.has(name)) {
          this._classList.delete(name);
          return false;
        }
        this._classList.add(name);
        return true;
      },
      get length() { return this._classList.size; },
      toString() { return [...this._classList].join(" "); },
    };
  }

  get className() {
    return [...this._classList].join(" ");
  }

  set className(value) {
    this._classList = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get style() {
    return this._style;
  }

  set style(value) {
    if (typeof value === "object") {
      Object.assign(this._style, value);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [
      ...this._innerHTML.matchAll(/data-(room|team)-id="([^"]+)"/g),
      ...this._innerHTML.matchAll(/data-replay-action="([^"]+)"/g),
      ...this._innerHTML.matchAll(/data-onboarding-action="([^"]+)"/g),
      ...this._innerHTML.matchAll(/data-onboarding-go-to="([^"]+)"/g),
    ].map((match) => {
      const attr = match[0];
      if (attr.startsWith("data-onboarding-action")) {
        const child = new FakeElement(`onboarding-action-${match[1]}`);
        child.dataset.onboardingAction = match[1];
        child.disabled = new RegExp(`data-onboarding-action="${match[1]}"[^>]* disabled`).test(this._innerHTML);
        return child;
      }
      if (attr.startsWith("data-onboarding-go-to")) {
        const child = new FakeElement(`onboarding-go-to-${match[1]}`);
        child.dataset.onboardingGoTo = match[1];
        return child;
      }
      const isReplayAction = attr.startsWith("data-replay-action");
      const kind = isReplayAction ? "replay" : match[1];
      const val = isReplayAction ? match[1] : match[2];
      const child = new FakeElement(`${kind}-${val}`);
      child.disabled = new RegExp(`data-${kind === "replay" ? "replay-action" : `${kind}-id`}="${val}"[^>]* disabled`).test(this._innerHTML);
      if (kind === "room") {
        child.dataset.roomId = val;
      }
      if (kind === "team") {
        child.dataset.teamId = val;
      }
      if (kind === "replay") {
        child.dataset.replayAction = val;
      }
      return child;
    });
  }

  addEventListener(type, callback) {
    this.listeners[type] = (event) => callback(event || { currentTarget: this });
  }

  click() {
    this.clicked = true;
    if (this.listeners.click) {
      return this.listeners.click({ currentTarget: this });
    }
    return undefined;
  }

  querySelectorAll(selector) {
    if (selector === "[data-room-id]") {
      return this.children.filter((child) => child.dataset.roomId);
    }
    if (selector === "[data-team-id]") {
      return this.children.filter((child) => child.dataset.teamId);
    }
    if (selector === "[data-replay-action]") {
      return this.children.filter((child) => child.dataset.replayAction);
    }
    if (selector === "[data-onboarding-action]") {
      return this.children.filter((child) => child.dataset.onboardingAction);
    }
    if (selector === "[data-onboarding-go-to]") {
      return this.children.filter((child) => child.dataset.onboardingGoTo !== undefined);
    }
    return [];
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }

  getBoundingClientRect() {
    return { top: 100, left: 100, width: 200, height: 40, bottom: 140, right: 300 };
  }

  scrollIntoView() {
    this._scrolledIntoView = true;
  }
}

function loadRenderer() {
  const elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new FakeElement(id)]));
  const windowListeners = {};
  const protocolHandlers = {};
  const calls = [];
  const intervals = [];
  const createdElements = [];
  const localStorageStore = {};
  const bridge = {
    connect: async () => ({ connected: true, clientId: "client_001" }),
    disconnect: async () => ({ connected: false }),
    listTargets: async () => {},
    listRooms: async () => {},
    createRoom: async (request) => calls.push(["createRoom", request]),
    joinRoom: async (request) => calls.push(["joinRoom", request]),
    startMatch: async () => {},
    markTargetReady: async (request) => calls.push(["markTargetReady", request]),
    markAgentReady: async (request) => calls.push(["markAgentReady", request]),
    submitFlag: async () => {},
    runTargetAction: async (request) => {
      calls.push(["runTargetAction", request]);
      if (request.action === "doctor") {
        return {
          ok: false,
          action: "doctor",
          checks: [
            { name: "docker_cli", label: "Docker CLI", ok: true },
            { name: "docker_daemon", label: "Docker daemon", ok: false },
          ],
          message: "本地靶机诊断发现问题：Docker daemon",
        };
      }
      return { ok: true, action: request.action, message: `${request.action} done` };
    },
    snapshot: async () => ({ connected: false }),
    onMessage: (callback) => {
      protocolHandlers.message = callback;
      return () => {};
    },
    onStatus: (callback) => {
      protocolHandlers.status = callback;
      return () => {};
    },
  };
  const context = {
    console,
    setTimeout: (callback, delay) => {
      // fire immediately in tests
      callback();
      return 1;
    },
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    setInterval: (callback, delay) => {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    document: {
      getElementById: (id) => elements[id],
      createElement: (tag) => {
        const element = new FakeElement(tag);
        createdElements.push(element);
        return element;
      },
      addEventListener: (type, callback) => {
        // captured for tests that need to simulate keyboard events
      },
      querySelector: (selector) => elements[selector.replace("#", "")] || null,
      querySelectorAll: (selector) => {
        if (selector === ".tab-btn") return [];
        if (selector === ".tab-panel") return [];
        if (selector === "[data-phase-preset]") return [];
        if (selector === "[data-onboarding-action]") return [];
        return [];
      },
    },
    window: {
      aiawd: bridge,
      navigator: {
        clipboard: {
          writeText: async (text) => calls.push(["clipboard", text]),
        },
      },
      addEventListener: (type, callback) => {
        windowListeners[type] = callback;
      },
      innerHeight: 800,
      OnboardingEngine: undefined, // placeholder — populated after loading onboarding.js
    },
    localStorage: {
      getItem: (key) => localStorageStore[key] || null,
      setItem: (key, value) => { localStorageStore[key] = String(value); },
      removeItem: (key) => { delete localStorageStore[key]; },
    },
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL: (blob) => {
        calls.push(["createObjectURL", blob.parts.join("")]);
        return "blob:report";
      },
      revokeObjectURL: (url) => calls.push(["revokeObjectURL", url]),
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  // Load onboarding.js first so OnboardingEngine is available to renderer.js
  const onboardingPath = path.join(__dirname, "onboarding.js");
  vm.runInContext(fs.readFileSync(onboardingPath, "utf8"), context, { filename: onboardingPath });
  // Expose to renderer's typeof check
  context.OnboardingEngine = context.window.OnboardingEngine;
  const rendererPath = path.join(__dirname, "renderer.js");
  vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: rendererPath });
  windowListeners.DOMContentLoaded();
  return { elements, protocolHandlers, calls, intervals, createdElements, context, localStorageStore };
}

test("renderer initializes offline Chinese dashboard state", () => {
  const { elements, intervals } = loadRenderer();

  assert.equal(elements.connectionState.textContent, "未连接");
  assert.equal(elements.connectionState.dataset.state, "offline");
  assert.equal(elements.phase.textContent, "大厅");
  assert.equal(elements.phaseTimer.textContent, "等待同步");
  assert.equal(elements.selectedRoom.textContent, "未选择");
  assert.equal(elements.myRole.textContent, "未加入");
  assert.equal(elements.scoreSummary.textContent, "暂无分数");
  assert.equal(elements.attackHeat.textContent, "暂无交火");
  assert.match(elements.nextStepBody.textContent, /连接|大厅/);
  assert.equal(elements.roomSummary.textContent, "还没有进入AI攻防乱斗房间");
  assert.equal(elements.matchSummary.textContent, "等待比赛配置");
  assert.equal(elements.attackKit.textContent, "等待私人战斗包");
  assert.equal(elements.targetLifecycleStatus.textContent, "等待本地靶机计划");
  assert.equal(elements.targetLifecycleStatus.dataset.state, "idle");
  assert.match(elements.arenaMap.innerHTML, /等待玩家入场/);
  assert.match(elements.defenseBoard.innerHTML, /等待玩家入场/);
  assert.equal(elements.resultSummary.textContent, "等待比赛结果");
  assert.match(elements.podiumList.innerHTML, /排行榜同步后生成结算/);
  assert.equal(elements.captureRecap.textContent, "暂无攻陷记录");
  assert.equal(elements.copyReport.disabled, true);
  assert.equal(elements.downloadReport.disabled, true);
  assert.match(elements.reportPreview.textContent, /私有 Flag 会保持隐藏/);
  assert.match(elements.players.innerHTML, /暂无参赛玩家/);
  assert.match(elements.spectators.innerHTML, /暂无观战方/);
  assert.match(elements.rankings.innerHTML, /暂无分数/);
  assert.match(elements.events.innerHTML, /ONBOARDING_STARTED|暂无事件/);
  assert.match(elements.messages.innerHTML, /暂无消息/);
  assert.match(elements.targetList.innerHTML, /尚未加载靶机/);
  assert.equal(elements.connect.disabled, false);
  assert.equal(elements.createRoom.disabled, true);
  assert.equal(elements.markTargetReady.disabled, true);
  assert.equal(elements.markAgentReady.disabled, true);
  assert.equal(elements.targetDoctor.disabled, true);
  assert.equal(elements.targetStart.disabled, true);
  assert.equal(elements.targetHealth.disabled, true);
  assert.equal(intervals[0].delay, 1000);
});

test("index.html keeps Chinese shell text and defaults", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /AI攻防大乱斗<\/title>/);
  assert.match(html, /id="displayName" value="玩家"/);
  assert.match(html, /mock-agent/);
  assert.match(html, /id="modelDisplayName"/);
  assert.match(html, /id="roomName" value="AI攻防大乱斗"/);
  assert.match(html, /id="maxPlayers" type="number"/);
  assert.match(html, /id="attackHeat"/);
  assert.match(html, /data-state="offline"/);
  assert.match(html, /AI攻防大乱斗/);
  assert.match(html, /Agent/);
  assert.match(html, /参赛|加入/);
  assert.match(html, /id="agentStatus"/);
  assert.match(html, /防线/);
  assert.match(html, /生成战报/);
  assert.match(html, /targetLifecycleStatus/);
  assert.match(html, /诊断/);
  assert.match(html, /安装/);
  assert.match(html, /启动/);
  assert.match(html, /巡检/);
  assert.match(html, /reportPreview/);
  assert.match(html, /攻防/);
  assert.match(html, /debug-data/);
});

test("renderer sends Agent runtime and model metadata when joining", async () => {
  const { elements, calls } = loadRenderer();

  await elements.connect.listeners.click();
  elements.roomId.value = "room_001";
  elements.displayName.value = "Alice";
  elements.agentRuntime.value = "hermes-local";
  elements.modelDisplayName.value = "model-alpha";

  await elements.joinPlayer.listeners.click();

  assert.equal(JSON.stringify(calls), JSON.stringify([
    [
      "joinRoom",
      {
        displayName: "Alice",
        agentRuntime: "hermes-local",
        modelDisplayName: "model-alpha",
        apiKey: "",
        roomId: "room_001",
        role: "player",
      },
    ],
  ]));
});

test("renderer sends Agent runtime and model metadata when creating a room", async () => {
  const { elements, calls } = loadRenderer();

  await elements.connect.listeners.click();
  elements.roomName.value = "模型AI攻防大乱斗";
  elements.maxPlayers.value = "3";
  elements.targetTemplateId.value = "real_ctf_web_awd_01";
  elements.prepareSeconds.value = "1";
  elements.defenseSeconds.value = "2";
  elements.attackSeconds.value = "3";
  elements.displayName.value = "Alice";
  elements.agentRuntime.value = "hermes-local";
  elements.modelDisplayName.value = "model-alpha";

  await elements.createRoom.listeners.click();

  assert.equal(JSON.stringify(calls), JSON.stringify([
    [
      "createRoom",
      {
        roomName: "模型AI攻防大乱斗",
        maxPlayers: 3,
        targetTemplateId: "real_ctf_web_awd_01",
        displayName: "Alice",
        agentRuntime: "hermes-local",
        modelDisplayName: "model-alpha",
        apiKey: "",
        allowSpectators: true,
        phaseSeconds: {
          prepare: 1,
          defense: 2,
          attack: 3,
        },
      },
    ],
  ]));
});

test("renderer displays protocol updates in Chinese and redacts private flags", async () => {
  const { elements, protocolHandlers, calls, intervals } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "JOIN_ROOM_RES",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 4,
        status: "LOBBY",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", model_display_name: "model-alpha", target_ready: true, agent_ready: false },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", model_display_name: "model-beta", target_ready: true, agent_ready: true },
        ],
        spectators: [{ team_id: null, display_name: "观察员" }],
      },
    },
  });
  protocolHandlers.message({
    type: "PHASE_SYNC",
    payload: { match: { match_id: "match_001", phase: "ATTACK", phase_ends_at: Date.now() / 1000 + 75 } },
  });
  protocolHandlers.message({
    type: "MATCH_CONFIG",
    payload: {
      match_id: "match_001",
      team_id: "team_a",
      flag: "FLAG{secret}",
      target_template_id: "real_ctf_web_awd_01",
      opponents: [{ team_id: "team_b", base_url: "http://127.0.0.1:18082" }],
      allowed_targets: ["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
      target_manifest: {
        name: "Web攻防演示靶机",
        difficulty: "professional",
        runtime: "docker-compose",
        healthcheck: { path: "/health" },
      },
      target_runtime: {
        project_name: "aiawd_room_001_team_a",
        health_url: "http://127.0.0.1:18081/health",
        commands: {
          install: {},
          start: {},
          stop: {},
          reset: {},
        },
      },
    },
  });
  protocolHandlers.message({
    type: "RANKING_UPDATE",
    payload: {
      rankings: [
        { team_id: "team_a", display_name: "Alice", score: 100 },
        { team_id: "team_b", display_name: "Bob", score: -50 },
      ],
    },
  });
  protocolHandlers.message({
    type: "LIST_TARGETS_RES",
    payload: {
      targets: [
        {
          template_id: "real_ctf_web_awd_01",
          name: "Web攻防演示靶机",
          difficulty: "professional",
          runtime: "docker-compose",
        },
      ],
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_a",
        target_team_id: "team_b",
        score_delta: 100,
        code: "OK",
      },
    },
  });

  assert.equal(elements.roomId.value, "room_001");
  assert.equal(elements.connectionState.textContent, "已连接");
  assert.equal(elements.connectionState.dataset.state, "connected");
  assert.equal(elements.clientId.textContent, "client_001");
  assert.equal(elements.phase.textContent, "攻防");
  assert.match(elements.phaseTimer.textContent, /后切换/);
  intervals[0].callback();
  assert.match(elements.phaseTimer.textContent, /后切换/);
  assert.equal(elements.selectedRoom.textContent, "room_001");
  assert.equal(elements.myRole.textContent, "参赛玩家");
  assert.equal(elements.scoreSummary.textContent, "100 分");
  assert.equal(elements.attackHeat.textContent, "1 次攻陷 · team_a→team_b");
  assert.match(elements.nextStepBody.textContent, /allowed_targets|攻防|攻击|ATTACK/);
  assert.match(elements.roomSummary.textContent, /room_001/);
  assert.match(elements.roomSummary.textContent, /AI攻防大乱斗/);
  assert.match(elements.matchSummary.textContent, /match_001/);
  assert.match(elements.attackKit.textContent, /私人战斗包/);
  assert.match(elements.attackKit.textContent, /玩家 team_a/);
  assert.match(elements.attackKit.textContent, /team_a/);
  assert.match(elements.attackKit.textContent, /Web攻防演示靶机/);
  assert.match(elements.attackKit.textContent, /进阶/);
  assert.match(elements.attackKit.textContent, /本地 Docker Compose/);
  assert.match(elements.attackKit.textContent, /健康 \/health/);
  assert.match(elements.attackKit.textContent, /计划 aiawd_room_001_team_a/);
  assert.match(elements.attackKit.textContent, /命令 install\/start\/stop\/reset/);
  assert.match(elements.attackKit.textContent, /巡检 http:\/\/127\.0\.0\.1:18081\/health/);
  assert.match(elements.attackKit.textContent, /对手 1 个/);
  assert.match(elements.attackKit.textContent, /允许目标 2 个/);
  assert.doesNotMatch(elements.attackKit.textContent, /FLAG\{secret\}/);
  assert.match(elements.targetLifecycleStatus.textContent, /计划 aiawd_room_001_team_a/);
  assert.equal(elements.targetLifecycleStatus.dataset.state, "idle");
  assert.equal(elements.targetStart.disabled, false);
  assert.equal(elements.targetHealth.disabled, false);
  assert.match(elements.arenaMap.innerHTML, /AI攻防大乱斗/);
  assert.match(elements.arenaMap.innerHTML, /我方领先|我方防线完整/);
  assert.match(elements.arenaMap.innerHTML, /Agent/);
  assert.match(elements.arenaMap.innerHTML, /combatant-avatar/);
  assert.match(elements.arenaMap.innerHTML, /readiness-track/);
  assert.match(elements.arenaMap.innerHTML, /1\/2 防线完整 · 1 次攻陷/);
  assert.match(elements.arenaMap.innerHTML, /is-leader/);
  assert.match(elements.arenaMap.innerHTML, /team_a/);
  assert.match(elements.arenaMap.innerHTML, /模型 model-alpha/);
  assert.match(elements.arenaMap.innerHTML, /100 分/);
  assert.match(elements.arenaMap.innerHTML, /1 攻陷 · 0 失守/);
  assert.match(elements.arenaMap.innerHTML, /防线完整 · 攻陷 1/);
  assert.match(elements.arenaMap.innerHTML, /team_b/);
  assert.match(elements.arenaMap.innerHTML, /-50 分/);
  assert.match(elements.arenaMap.innerHTML, /攻陷.*失守/);
  assert.match(elements.arenaMap.innerHTML, /失守 1 次 · 攻陷 0/);
  assert.match(elements.arenaMap.innerHTML, /is-breached/);
  assert.match(elements.arenaMap.innerHTML, /is-attacker/);
  assert.match(elements.arenaMap.innerHTML, /is-target/);
  assert.match(elements.arenaMap.innerHTML, /threat-lane/);
  assert.match(elements.arenaMap.innerHTML, /最新攻陷/);
  assert.match(elements.arenaMap.innerHTML, /team_a → team_b/);
  assert.match(elements.arenaMap.innerHTML, /is-replay/);
  assert.match(elements.arenaMap.innerHTML, /战场焦点/);
  assert.match(elements.arenaMap.innerHTML, /data-focus-team="team_a"/);
  assert.match(elements.arenaMap.innerHTML, /team_a · Alice/);
  assert.match(elements.arenaMap.innerHTML, /最近攻陷 team_b/);
  assert.match(elements.arenaMap.innerHTML, /战斗回放/);
  assert.match(elements.arenaMap.innerHTML, /攻陷/);
  assert.match(elements.arenaMap.innerHTML, /team_a 攻陷 team_b/);
  assert.match(elements.arenaMap.innerHTML, /\+100 分 · 第 1\/1 次攻陷/);
  assert.doesNotMatch(elements.arenaMap.innerHTML, /FLAG\{secret\}/);
  assert.match(elements.defenseBoard.innerHTML, /防线完整/);
  assert.match(elements.defenseBoard.innerHTML, /1\/2/);
  assert.match(elements.defenseBoard.innerHTML, /攻陷领先/);
  assert.match(elements.defenseBoard.innerHTML, /team_a/);
  assert.match(elements.defenseBoard.innerHTML, /失守最多/);
  assert.match(elements.defenseBoard.innerHTML, /team_b/);
  assert.match(elements.defenseBoard.innerHTML, /失守 1 次/);
  assert.match(elements.defenseBoard.innerHTML, /连续攻陷/);
  assert.match(elements.defenseBoard.innerHTML, /team_a x1/);
  assert.doesNotMatch(elements.defenseBoard.innerHTML, /FLAG\{secret\}/);
  assert.match(elements.resultSummary.textContent, /当前防线完整王 team_a/);
  assert.match(elements.resultSummary.textContent, /攻陷 1/);
  assert.match(elements.resultSummary.textContent, /防线完整/);
  assert.match(elements.podiumList.innerHTML, /冠军/);
  assert.match(elements.podiumList.innerHTML, /team_a/);
  assert.match(elements.captureRecap.textContent, /最近攻陷：team_a 攻陷 team_b \+100 分/);
  assert.match(elements.players.innerHTML, /Alice/);
  assert.match(elements.players.innerHTML, /靶机已好/);
  assert.match(elements.players.innerHTML, /Agent.*待确认/);
  assert.equal(elements.markTargetReady.disabled, false);
  assert.equal(elements.markAgentReady.disabled, false);
  assert.match(elements.spectators.innerHTML, /观察员/);
  assert.match(elements.rankings.innerHTML, /team_a/);
  assert.match(elements.rankings.innerHTML, /100 分/);
  assert.match(elements.rankings.innerHTML, /Alice · 我方 · 领先/);
  assert.match(elements.rankings.innerHTML, /Bob · 落后 150 分/);
  assert.match(elements.targetList.innerHTML, /进阶/);
  assert.match(elements.targetList.innerHTML, /本地 Docker Compose/);
  assert.match(elements.events.innerHTML, /攻陷得分/);
  assert.match(elements.events.innerHTML, /data-tone="good"/);
  assert.match(elements.events.innerHTML, /team_a 攻陷 team_b \+100 分/);
  assert.match(elements.messages.innerHTML, /PHASE_SYNC/);
  assert.match(elements.matchConfig.textContent, /FLAG\{已隐藏\}/);
  assert.doesNotMatch(elements.matchConfig.textContent, /FLAG\{secret\}/);

  const bobButton = elements.arenaMap.querySelectorAll("[data-team-id]").find((button) => button.dataset.teamId === "team_b");
  await bobButton.listeners.click();
  assert.match(elements.arenaMap.innerHTML, /data-focus-team="team_b"/);
  assert.match(elements.arenaMap.innerHTML, /team_b · Bob/);
  assert.match(elements.arenaMap.innerHTML, /最近对 team_a 失守/);

  await elements.markTargetReady.listeners.click();
  await elements.markAgentReady.listeners.click();
  assert.equal(JSON.stringify(calls), JSON.stringify([
    ["markTargetReady", { roomId: "room_001" }],
    ["markAgentReady", { roomId: "room_001" }],
  ]));
});

test("renderer runs local target lifecycle action through the preload bridge", async () => {
  const { elements, protocolHandlers, calls } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "JOIN_ROOM_RES",
    role: "player",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 2,
        status: "LOBBY",
        players: [{ client_id: "client_001", team_id: "team_a", display_name: "Alice" }],
        spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "MATCH_CONFIG",
    payload: {
      match_id: "match_001",
      team_id: "team_a",
      flag: "FLAG{secret}",
      target_runtime: {
        project_name: "aiawd_room_001_team_a",
        health_url: "http://127.0.0.1:18081/health",
        commands: {
          install: {},
          start: {},
          stop: {},
          reset: {},
        },
      },
    },
  });

  await elements.targetStart.listeners.click();

  assert.equal(JSON.stringify(calls), JSON.stringify([
    [
      "runTargetAction",
      {
        action: "start",
        runtime: {
          project_name: "aiawd_room_001_team_a",
          health_url: "http://127.0.0.1:18081/health",
          commands: {
            install: {},
            start: {},
            stop: {},
            reset: {},
          },
        },
        flag: "FLAG{secret}",
      },
    ],
  ]));
  assert.equal(elements.targetLifecycleStatus.textContent, "start done");
  assert.equal(elements.targetLifecycleStatus.dataset.state, "ok");
  assert.match(elements.events.innerHTML, /本地靶机/);
  assert.doesNotMatch(elements.events.innerHTML, /FLAG\{secret\}/);
  assert.doesNotMatch(elements.targetLifecycleStatus.textContent, /FLAG\{secret\}/);
});

test("renderer runs local target diagnostics through the preload bridge", async () => {
  const { elements, protocolHandlers, calls } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "JOIN_ROOM_RES",
    role: "player",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 2,
        status: "LOBBY",
        players: [{ client_id: "client_001", team_id: "team_a", display_name: "Alice" }],
        spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "MATCH_CONFIG",
    payload: {
      match_id: "match_001",
      team_id: "team_a",
      flag: "FLAG{secret}",
      target_runtime: {
        project_name: "aiawd_room_001_team_a",
        health_url: "http://127.0.0.1:18081/health",
        commands: {
          install: {},
          start: {},
          stop: {},
          reset: {},
        },
      },
    },
  });

  await elements.targetDoctor.listeners.click();

  assert.equal(calls.at(-1)[0], "runTargetAction");
  assert.equal(calls.at(-1)[1].action, "doctor");
  assert.match(elements.targetLifecycleStatus.textContent, /Docker daemon/);
  assert.equal(elements.targetLifecycleStatus.dataset.state, "warn");
  assert.doesNotMatch(elements.targetLifecycleStatus.textContent, /FLAG\{secret\}/);
});

test("renderer shows AI attack-defense final results after finished phase", () => {
  const { elements, protocolHandlers } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "ROOM_UPDATE",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 4,
        status: "FINISHED",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", target_ready: true, agent_ready: true },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", target_ready: true, agent_ready: true },
          { client_id: "client_003", team_id: "team_c", display_name: "Charlie", target_ready: true, agent_ready: true },
        ],
        spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "RANKING_UPDATE",
    payload: {
      rankings: [
        { team_id: "team_b", display_name: "Bob", score: 150 },
        { team_id: "team_a", display_name: "Alice", score: 100 },
        { team_id: "team_c", display_name: "Charlie", score: -50 },
      ],
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_b",
        target_team_id: "team_c",
        score_delta: 100,
        code: "OK",
      },
    },
  });
  protocolHandlers.message({
    type: "PHASE_SYNC",
    payload: { match: { match_id: "match_001", phase: "FINISHED", status: "FINISHED" } },
  });

  assert.equal(elements.phase.textContent, "结束");
  assert.match(elements.nextStepBody.textContent, /比赛已结束|结算|完成|FINISHED|冠军|复盘/);
  assert.equal(elements.submitFlag.disabled, true);
  assert.match(elements.resultSummary.textContent, /冠军 team_b · Bob · 150 分 · 攻陷 1 · 防线完整/);
  assert.match(elements.podiumList.innerHTML, /team_b/);
  assert.match(elements.podiumList.innerHTML, /team_a/);
  assert.match(elements.podiumList.innerHTML, /team_c/);
  assert.match(elements.captureRecap.textContent, /最近攻陷：team_b 攻陷 team_c \+100 分/);
  assert.match(elements.arenaMap.innerHTML, /领先/);
  assert.match(elements.arenaMap.innerHTML, /AI攻防大乱斗/);
  assert.match(elements.arenaMap.innerHTML, /team_b → team_c/);
  assert.match(elements.arenaMap.innerHTML, /data-focus-team="team_b"/);
});

test("renderer replays multiple captures and syncs arena focus", async () => {
  const { elements, protocolHandlers } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "ROOM_UPDATE",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 3,
        status: "ATTACK",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", model_display_name: "model-alpha", target_ready: true, agent_ready: true },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", model_display_name: "model-beta", target_ready: true, agent_ready: true },
          { client_id: "client_003", team_id: "team_c", display_name: "Charlie", model_display_name: "model-gamma", target_ready: true, agent_ready: true },
        ],
        spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "RANKING_UPDATE",
    payload: {
      rankings: [
        { team_id: "team_b", display_name: "Bob", score: 100 },
        { team_id: "team_a", display_name: "Alice", score: 50 },
        { team_id: "team_c", display_name: "Charlie", score: -50 },
      ],
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_a",
        target_team_id: "team_c",
        score_delta: 100,
        code: "OK",
      },
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_b",
        target_team_id: "team_a",
        score_delta: 100,
        code: "OK",
      },
    },
  });

  assert.match(elements.arenaMap.innerHTML, /攻陷/);
  assert.match(elements.arenaMap.innerHTML, /team_b 攻陷 team_a/);
  assert.match(elements.arenaMap.innerHTML, /\+100 分 · 第 1\/2 次攻陷/);
  assert.match(elements.arenaMap.innerHTML, /data-focus-team="team_b"/);
  assert.match(elements.arenaMap.innerHTML, /team_b · Bob/);

  const prevButton = elements.arenaMap.querySelectorAll("[data-replay-action]").find((button) => button.dataset.replayAction === "prev");
  assert.equal(prevButton.disabled, false);
  await prevButton.listeners.click();

  assert.match(elements.arenaMap.innerHTML, /data-replay-action/);
  assert.match(elements.arenaMap.innerHTML, /team_a 攻陷 team_c/);
  assert.match(elements.arenaMap.innerHTML, /\+100 分 · 第 2\/2 次攻陷/);
  assert.match(elements.arenaMap.innerHTML, /data-focus-team="team_a"/);
  assert.match(elements.arenaMap.innerHTML, /team_a · Alice/);

  const nextButton = elements.arenaMap.querySelectorAll("[data-replay-action]").find((button) => button.dataset.replayAction === "next");
  assert.equal(nextButton.disabled, false);
  await nextButton.listeners.click();

  assert.match(elements.arenaMap.innerHTML, /攻陷/);
  assert.match(elements.arenaMap.innerHTML, /team_b 攻陷 team_a/);

  const latestButton = elements.arenaMap.querySelectorAll("[data-replay-action]").find((button) => button.dataset.replayAction === "latest");
  assert.equal(latestButton.disabled, true);
  assert.doesNotMatch(elements.arenaMap.innerHTML, /FLAG\{secret\}/);
});

test("renderer arena auto-play button appears with captures", async () => {
  const { elements, protocolHandlers } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME", client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "ROOM_UPDATE", payload: {
      room: { room_id: "room_001", max_players: 4, status: "ATTACK",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", model_display_name: "hermes", target_ready: true, agent_ready: true },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", model_display_name: "codex", target_ready: true, agent_ready: true },
        ], spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "EVENT", payload: {
      event_type: "FLAG_CAPTURED",
      event: { submitter_team_id: "team_a", target_team_id: "team_b", score_delta: 100, code: "OK" },
    },
  });
  protocolHandlers.message({
    type: "EVENT", payload: {
      event_type: "FLAG_CAPTURED",
      event: { submitter_team_id: "team_b", target_team_id: "team_a", score_delta: 100, code: "OK" },
    },
  });

  assert.match(elements.arenaMap.innerHTML, /data-replay-action="autoplay"/);
  assert.match(elements.arenaMap.innerHTML, /▶ 播放/);

  const autoPlayButton = elements.arenaMap.querySelectorAll("[data-replay-action]").find((b) => b.dataset.replayAction === "autoplay");
  assert.ok(autoPlayButton);
  assert.equal(autoPlayButton.disabled, false);
  assert.match(elements.arenaMap.innerHTML, /timeline-dot/);
  assert.match(elements.arenaMap.innerHTML, /timeline-track/);
  assert.match(elements.arenaMap.innerHTML, /data-replay-action="jump"/);
  assert.doesNotMatch(elements.arenaMap.innerHTML, /FLAG\{secret\}/);
});

test("renderer generates, copies, and downloads a redacted battle report", async () => {
  const { elements, protocolHandlers, calls, createdElements } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "ROOM_UPDATE",
    payload: {
      room: {
        room_id: "room_001",
        room_name: "周赛训练房",
        max_players: 4,
        status: "FINISHED",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", target_ready: true, agent_ready: true },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", target_ready: true, agent_ready: true },
        ],
        spectators: [{ display_name: "观察员" }],
      },
    },
  });
  protocolHandlers.message({
    type: "MATCH_CONFIG",
    payload: {
      match_id: "match_001",
      team_id: "team_a",
      flag: "FLAG{secret}",
      target_template_id: "real_ctf_web_awd_01",
      opponents: [{ team_id: "team_b", base_url: "http://127.0.0.1:18082" }],
      allowed_targets: ["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
      target_manifest: {
        name: "Web攻防演示靶机",
        difficulty: "professional",
        runtime: "docker-compose",
        healthcheck: { path: "/health" },
      },
      target_runtime: {
        project_name: "aiawd_room_001_team_a",
        health_url: "http://127.0.0.1:18081/health",
        commands: {
          install: {},
          start: {},
          stop: {},
          reset: {},
        },
      },
    },
  });
  protocolHandlers.message({
    type: "RANKING_UPDATE",
    payload: {
      rankings: [
        { team_id: "team_a", display_name: "Alice", score: 100 },
        { team_id: "team_b", display_name: "Bob", score: -50 },
      ],
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_a",
        target_team_id: "team_b",
        score_delta: 100,
        code: "OK",
      },
    },
  });
  protocolHandlers.message({
    type: "PHASE_SYNC",
    payload: { match: { match_id: "match_001", phase: "FINISHED", status: "FINISHED" } },
  });

  await elements.generateReport.listeners.click();

  assert.match(elements.reportPreview.textContent, /# AI-AWD Arena AI攻防大乱斗战报/);
  assert.match(elements.reportPreview.textContent, /周赛训练房/);
  assert.match(elements.reportPreview.textContent, /攻陷次数：1/);
  assert.match(elements.reportPreview.textContent, /防线完整玩家：1\/2/);
  assert.match(elements.reportPreview.textContent, /攻陷领先：team_a · 攻陷 1/);
  assert.match(elements.reportPreview.textContent, /范围边界：仅限房间下发的 allowed_targets/);
  assert.match(elements.reportPreview.textContent, /1\. team_a · Alice · 100 分/);
  assert.match(elements.reportPreview.textContent, /## 防线完整情况/);
  assert.match(elements.reportPreview.textContent, /team_a · 防线完整 · 攻陷 1/);
  assert.match(elements.reportPreview.textContent, /team_b · 失守 1 次 · 攻陷 0/);
  assert.match(elements.reportPreview.textContent, /1\. team_a 攻陷 team_b \+100 分/);
  assert.match(elements.reportPreview.textContent, /FLAG\{已隐藏\}/);
  assert.match(elements.reportPreview.textContent, /FLAG/);
  assert.match(elements.reportPreview.textContent, /Flag：FLAG\{已隐藏\}/);
  assert.doesNotMatch(elements.reportPreview.textContent, /FLAG\{secret\}/);
  assert.equal(elements.copyReport.disabled, false);
  assert.equal(elements.downloadReport.disabled, false);

  await elements.copyReport.listeners.click();
  await elements.downloadReport.listeners.click();

  const copied = calls.find((call) => call[0] === "clipboard")[1];
  const downloaded = calls.find((call) => call[0] === "createObjectURL")[1];
  assert.match(copied, /AI-AWD Arena AI攻防大乱斗战报/);
  assert.match(downloaded, /AI-AWD Arena AI攻防大乱斗战报/);
  assert.doesNotMatch(copied, /FLAG\{secret\}/);
  assert.doesNotMatch(downloaded, /FLAG\{secret\}/);
  assert.equal(createdElements[0].download, "room_001-battle-report.md");
  assert.equal(createdElements[0].clicked, true);
});

test("renderer lets users select a public room from the room list", async () => {
  const { elements, protocolHandlers } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "LIST_ROOMS_RES",
    payload: {
      rooms: [
        {
          room_id: "room_777",
          room_name: "周赛训练房",
          status: "LOBBY",
          players: [{ team_id: "team_a" }],
          max_players: 2,
          allow_spectators: true,
          target_template_id: "real_ctf_web_awd_01",
        },
      ],
    },
  });

  assert.match(elements.roomList.innerHTML, /周赛训练房/);
  assert.match(elements.roomList.innerHTML, /周赛训练房/);
  assert.match(elements.roomList.innerHTML, /1\/2 玩家/);

  const roomButton = elements.roomList.querySelectorAll("[data-room-id]")[0];
  await roomButton.listeners.click();

  assert.equal(elements.roomId.value, "room_777");
  assert.equal(elements.selectedRoom.textContent, "room_777");
  assert.match(elements.events.innerHTML, /已选房间/);
  assert.match(elements.events.innerHTML, /room_777/);
});

test("renderer records Chinese validation event when submitting an empty flag", async () => {
  const { elements } = loadRenderer();

  await elements.submitFlag.listeners.click();

  assert.match(elements.events.innerHTML, /未提交/);
  assert.match(elements.events.innerHTML, /data-tone="warn"/);
});

test("renderer shows floating score delta popup on FLAG_CAPTURED", () => {
  const { elements, protocolHandlers } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "ROOM_UPDATE",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 2,
        status: "ATTACK",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", target_ready: true, agent_ready: true },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", target_ready: true, agent_ready: true },
        ],
        spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_a",
        target_team_id: "team_b",
        score_delta: 100,
        code: "OK",
      },
    },
  });

  // score-popup appears inside team_a's combatant card
  assert.match(elements.arenaMap.innerHTML, /score-popup/);
  assert.match(elements.arenaMap.innerHTML, /is-gain/);
  assert.match(elements.arenaMap.innerHTML, /\+100/);
  assert.doesNotMatch(elements.arenaMap.innerHTML, /FLAG\{secret\}/);
});

test("renderer shows negative score delta popup with is-loss class", () => {
  const { elements, protocolHandlers } = loadRenderer();

  protocolHandlers.message({
    type: "WELCOME",
    client_id: "client_001",
    payload: { client_id: "client_001" },
  });
  protocolHandlers.message({
    type: "ROOM_UPDATE",
    payload: {
      room: {
        room_id: "room_001",
        max_players: 2,
        status: "ATTACK",
        players: [
          { client_id: "client_001", team_id: "team_a", display_name: "Alice", target_ready: true, agent_ready: true },
          { client_id: "client_002", team_id: "team_b", display_name: "Bob", target_ready: true, agent_ready: true },
        ],
        spectators: [],
      },
    },
  });
  protocolHandlers.message({
    type: "EVENT",
    payload: {
      event_type: "FLAG_CAPTURED",
      event: {
        submitter_team_id: "team_b",
        target_team_id: "team_a",
        score_delta: -50,
        code: "OK",
      },
    },
  });

  assert.match(elements.arenaMap.innerHTML, /score-popup/);
  assert.match(elements.arenaMap.innerHTML, /is-loss/);
  assert.match(elements.arenaMap.innerHTML, /-50/);
  assert.doesNotMatch(elements.arenaMap.innerHTML, /FLAG\{secret\}/);
});

// —— Onboarding / 新手教程 tests ——

test("onboarding HTML elements exist in index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(html, /id="onboardingOverlay"/);
  assert.match(html, /id="onboardingSpotlight"/);
  assert.match(html, /id="onboardingTooltip"/);
  assert.match(html, /id="onboardingProgress"/);
  assert.match(html, /id="startOnboarding"/);
  assert.match(html, /新手教程/);
  assert.match(html, /onboarding\.js/);
});

test("onboarding auto-starts on first visit and records event", () => {
  const { elements, context } = loadRenderer();

  // After auto-start (setTimeout fires immediately in test), overlay should be visible
  assert.equal(elements.onboardingOverlay.style.display, "block");
  // The first step is welcome (center), so overlay should have is-center class
  assert.ok(elements.onboardingOverlay._classList.has("is-center"));
  // Tooltip should contain welcome content
  assert.match(elements.onboardingTooltip.innerHTML, /欢迎来到 AI-AWD Arena/);
  assert.match(elements.onboardingTooltip.innerHTML, /AI 攻防大乱斗竞技场/);
  // Event should be recorded
  assert.match(elements.events.innerHTML, /ONBOARDING_STARTED/);
});

test("onboarding marks completed in localStorage after finishing all steps", () => {
  const { elements, context, localStorageStore } = loadRenderer();

  // Navigate through all 10 steps (indices 0-8 advance, 9th click on last step finishes)
  for (let i = 0; i < 10; i++) {
    const nextButton = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
      .find((btn) => btn.dataset.onboardingAction === "next");
    assert.ok(nextButton, `next button should exist at step ${i}`);
    nextButton.listeners.click();
  }

  // After finishing, overlay should be hidden
  assert.equal(elements.onboardingOverlay.style.display, "none");
  const stored = JSON.parse(localStorageStore["aiawd_onboarding_v1"]);
  assert.equal(stored.completed, true);
  assert.ok(stored.completedAt > 0);
});

test("onboarding skip dismisses and records in localStorage without marking completed", () => {
  const { elements, localStorageStore } = loadRenderer();

  // Click the skip button on the first step
  const skipButton = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
    .find((btn) => btn.dataset.onboardingAction === "dismiss");
  assert.ok(skipButton);
  skipButton.listeners.click();

  // Overlay should be hidden
  assert.equal(elements.onboardingOverlay.style.display, "none");
  // localStorage should record dismissed (not completed)
  const stored = JSON.parse(localStorageStore["aiawd_onboarding_v1"]);
  assert.equal(stored.completed, false);
  assert.equal(stored.dismissed, true);
});

test("onboarding does not auto-start when already completed", () => {
  // Pre-populate localStorage as completed
  const { elements, localStorageStore } = (() => {
    const store = { aiawd_onboarding_v1: JSON.stringify({ completed: true, completedAt: Date.now() }) };
    const localCalls = [];
    const localIntervals = [];
    const localCreatedElements = [];

    // Build a fresh context with pre-populated localStorage
    const els = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new FakeElement(id)]));
    const winListeners = {};
    const protoHandlers = {};
    const bridge = {
      connect: async () => ({ connected: true, clientId: "client_001" }),
      disconnect: async () => ({ connected: false }),
      listTargets: async () => {},
      listRooms: async () => {},
      createRoom: async (r) => localCalls.push(["createRoom", r]),
      joinRoom: async (r) => localCalls.push(["joinRoom", r]),
      startMatch: async () => {},
      markTargetReady: async (r) => localCalls.push(["markTargetReady", r]),
      markAgentReady: async (r) => localCalls.push(["markAgentReady", r]),
      submitFlag: async () => {},
      runTargetAction: async (r) => {
        localCalls.push(["runTargetAction", r]);
        return { ok: true, action: r.action, message: `${r.action} done` };
      },
      snapshot: async () => ({ connected: false }),
      onMessage: (cb) => { protoHandlers.message = cb; return () => {}; },
      onStatus: (cb) => { protoHandlers.status = cb; return () => {}; },
    };
    const ctx = {
      console,
      setTimeout: (cb) => { cb(); return 1; },
      requestAnimationFrame: (cb) => { cb(); return 1; },
      setInterval: (cb, delay) => { localIntervals.push({ callback: cb, delay }); return localIntervals.length; },
      document: {
        getElementById: (id) => els[id],
        createElement: (tag) => { const e = new FakeElement(tag); localCreatedElements.push(e); return e; },
        addEventListener: () => {},
        querySelectorAll: () => [],
      },
      window: {
        aiawd: bridge,
        navigator: { clipboard: { writeText: async (text) => localCalls.push(["clipboard", text]) } },
        addEventListener: (type, cb) => { winListeners[type] = cb; },
        innerHeight: 800,
      },
      localStorage: {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
      },
      Blob: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } },
      URL: {
        createObjectURL: (blob) => { localCalls.push(["createObjectURL", blob.parts.join("")]); return "blob:report"; },
        revokeObjectURL: (url) => localCalls.push(["revokeObjectURL", url]),
      },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    const onboardingPath = path.join(__dirname, "onboarding.js");
    vm.runInContext(fs.readFileSync(onboardingPath, "utf8"), ctx, { filename: onboardingPath });
    ctx.OnboardingEngine = ctx.window.OnboardingEngine;
    const rendererPath = path.join(__dirname, "renderer.js");
    vm.runInContext(fs.readFileSync(rendererPath, "utf8"), ctx, { filename: rendererPath });
    winListeners.DOMContentLoaded();
    return { elements: els, localStorageStore: store, context: ctx };
  })();

  // Overlay should NOT be visible since onboarding was already completed
  // style.display starts undefined (not set by autoStart which returned false)
  assert.ok(!elements.onboardingOverlay.style.display || elements.onboardingOverlay.style.display === "none");
});

test("onboarding 新手教程 button re-launches the tutorial", () => {
  // Pre-complete onboarding so auto-start doesn't fire
  const { elements } = (() => {
    const store = { aiawd_onboarding_v1: JSON.stringify({ completed: true, completedAt: Date.now() }) };
    const localCalls = [];
    const localIntervals = [];
    const localCreatedElements = [];
    const els = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new FakeElement(id)]));
    const winListeners = {};
    const protoHandlers = {};
    const bridge = {
      connect: async () => ({ connected: true, clientId: "client_001" }),
      disconnect: async () => ({ connected: false }),
      listTargets: async () => {},
      listRooms: async () => {},
      createRoom: async (r) => localCalls.push(["createRoom", r]),
      joinRoom: async (r) => localCalls.push(["joinRoom", r]),
      startMatch: async () => {},
      markTargetReady: async (r) => localCalls.push(["markTargetReady", r]),
      markAgentReady: async (r) => localCalls.push(["markAgentReady", r]),
      submitFlag: async () => {},
      runTargetAction: async (r) => {
        localCalls.push(["runTargetAction", r]);
        return { ok: true, action: r.action, message: `${r.action} done` };
      },
      snapshot: async () => ({ connected: false }),
      onMessage: (cb) => { protoHandlers.message = cb; return () => {}; },
      onStatus: (cb) => { protoHandlers.status = cb; return () => {}; },
    };
    const ctx = {
      console,
      setTimeout: (cb) => { cb(); return 1; },
      requestAnimationFrame: (cb) => { cb(); return 1; },
      setInterval: (cb, delay) => { localIntervals.push({ callback: cb, delay }); return localIntervals.length; },
      document: {
        getElementById: (id) => els[id],
        createElement: (tag) => { const e = new FakeElement(tag); localCreatedElements.push(e); return e; },
        addEventListener: () => {},
        querySelectorAll: () => [],
      },
      window: {
        aiawd: bridge,
        navigator: { clipboard: { writeText: async (text) => localCalls.push(["clipboard", text]) } },
        addEventListener: (type, cb) => { winListeners[type] = cb; },
        innerHeight: 800,
      },
      localStorage: {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
      },
      Blob: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } },
      URL: {
        createObjectURL: (blob) => { localCalls.push(["createObjectURL", blob.parts.join("")]); return "blob:report"; },
        revokeObjectURL: (url) => localCalls.push(["revokeObjectURL", url]),
      },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "onboarding.js"), "utf8"), ctx, { filename: "onboarding.js" });
    ctx.OnboardingEngine = ctx.window.OnboardingEngine;
    vm.runInContext(fs.readFileSync(path.join(__dirname, "renderer.js"), "utf8"), ctx, { filename: "renderer.js" });
    winListeners.DOMContentLoaded();
    return { elements: els, context: ctx };
  })();

  // Overlay should be hidden (already completed, autoStart returned false)
  assert.ok(!elements.onboardingOverlay.style.display || elements.onboardingOverlay.style.display === "none");

  // Click the 新手教程 button
  elements.startOnboarding.listeners.click();

  // Overlay should now be visible with welcome step
  assert.equal(elements.onboardingOverlay.style.display, "block");
  assert.match(elements.onboardingTooltip.innerHTML, /欢迎来到 AI-AWD Arena/);
  // Event should note it's a replay
  assert.match(elements.events.innerHTML, /ONBOARDING_STARTED/);
});

test("onboarding step navigation: next/prev through spotlight steps", () => {
  const { elements } = loadRenderer();

  // Step 0 is welcome (center) - no spotlight
  assert.ok(elements.onboardingOverlay._classList.has("is-center"));

  // Next → step 1 (connect, right position, spotlight)
  const nextBtn = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
    .find((btn) => btn.dataset.onboardingAction === "next");
  nextBtn.listeners.click();

  // Should now be in spotlight mode
  assert.ok(elements.onboardingOverlay._classList.has("is-spotlight"));
  assert.match(elements.onboardingTooltip.innerHTML, /连接裁判服务器/);
  assert.match(elements.onboardingTooltip.innerHTML, /2 \/ 10/);

  // Next → step 2 (create-room)
  const nextBtn2 = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
    .find((btn) => btn.dataset.onboardingAction === "next");
  nextBtn2.listeners.click();
  assert.match(elements.onboardingTooltip.innerHTML, /创建 AI 攻防房间/);
  assert.match(elements.onboardingTooltip.innerHTML, /3 \/ 10/);

  // Go back to step 1
  const prevBtn = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
    .find((btn) => btn.dataset.onboardingAction === "prev");
  prevBtn.listeners.click();
  assert.match(elements.onboardingTooltip.innerHTML, /连接裁判服务器/);
  assert.match(elements.onboardingTooltip.innerHTML, /2 \/ 10/);

  // First step should have prev disabled
  // Navigate back to step 0
  const prevBtn2 = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
    .find((btn) => btn.dataset.onboardingAction === "prev");
  prevBtn2.listeners.click();
  assert.match(elements.onboardingTooltip.innerHTML, /欢迎来到 AI-AWD Arena/);
  assert.match(elements.onboardingTooltip.innerHTML, /1 \/ 10/);

  // Previous button should be disabled at step 0
  const prevBtn3 = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
    .find((btn) => btn.dataset.onboardingAction === "prev");
  assert.equal(prevBtn3.disabled, true);
});

test("onboarding progress dots allow jumping to arbitrary steps", () => {
  const { elements } = loadRenderer();

  // Progress dots should be rendered
  assert.match(elements.onboardingProgress.innerHTML, /onboarding-dot/);
  assert.match(elements.onboardingProgress.innerHTML, /is-active/);

  // Click the 5th progress dot (step index 4, "join-ready")
  const dots = elements.onboardingProgress.querySelectorAll("[data-onboarding-go-to]");
  assert.ok(dots.length >= 10, `expected >= 10 dots, got ${dots.length}`);

  const targetDot = dots.find((d) => d.dataset.onboardingGoTo === "4");
  assert.ok(targetDot, "dot for step 4 should exist");
  targetDot.listeners.click();

  assert.match(elements.onboardingTooltip.innerHTML, /参赛入场与准备/);
  assert.match(elements.onboardingTooltip.innerHTML, /5 \/ 10/);
});

test("onboarding displays all step titles in Chinese", () => {
  const { elements } = loadRenderer();

  const titles = [];
  // Collect all step titles by navigating through
  for (let i = 0; i < 10; i++) {
    const match = elements.onboardingTooltip.innerHTML.match(/<h3>([^<]+)<\/h3>/);
    if (match) titles.push(match[1]);
    const nextBtn = elements.onboardingTooltip.querySelectorAll("[data-onboarding-action]")
      .find((btn) => btn.dataset.onboardingAction === "next");
    if (nextBtn && i < 9) nextBtn.listeners.click();
  }

  assert.equal(titles.length, 10);
  assert.equal(titles[0], "欢迎来到 AI-AWD Arena");
  assert.ok(titles.some((t) => t.includes("连接裁判服务器")));
  assert.ok(titles.some((t) => t.includes("创建 AI 攻防房间")));
  assert.ok(titles.some((t) => t.includes("公开房间")));
  assert.ok(titles.some((t) => t.includes("参赛入场与准备")));
  assert.ok(titles.some((t) => t.includes("开始比赛")));
  assert.ok(titles.some((t) => t.includes("大乱斗战场")));
  assert.ok(titles.some((t) => t.includes("提交攻陷凭证")));
  assert.ok(titles.some((t) => t.includes("比赛结算与战报")));
  assert.ok(titles[9], "准备就绪！");
});

test("onboarding resets localStorage correctly", () => {
  const { localStorageStore, context } = loadRenderer();

  // After auto-start, localStorage should not have completed yet
  assert.equal(localStorageStore["aiawd_onboarding_v1"], undefined);

  // Complete the onboarding (10 steps, last click finishes)
  for (let i = 0; i < 10; i++) {
    const nextBtn = context.window.OnboardingEngine._tooltipEl
      .querySelectorAll("[data-onboarding-action]")
      .find((btn) => btn.dataset.onboardingAction === "next");
    if (nextBtn) nextBtn.listeners.click();
  }

  // Now localStorage should have completed = true
  const stored = JSON.parse(localStorageStore["aiawd_onboarding_v1"]);
  assert.equal(stored.completed, true);

  // Reset
  context.window.OnboardingStore.reset();
  assert.equal(localStorageStore["aiawd_onboarding_v1"], undefined);
});
