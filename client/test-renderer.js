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
      ...this._innerHTML.matchAll(/class="[^"]*room-join-btn[^"]*"\s+data-room="([^"]+)"\s+data-role="([^"]+)"/g),
    ].map((match) => {
      const attr = match[0];
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
      if (kind === "room_join") {
        child.dataset.room = match[2];
        child.dataset.role = match[3];
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
    }    if (selector === ".room-join-btn" || selector.includes("room-join-btn")) {
      return this.children.filter((child) => child.dataset.room && child.dataset.role);
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
  const timeouts = [];
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
    agentStart: async (request) => {
      calls.push(["agentStart", request]);
      return { ok: true, flagsCaptured: [], actions: [], elapsedMs: 1 };
    },
    agentStop: async () => {
      calls.push(["agentStop"]);
      return { ok: true, message: "Agent 已停止" };
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
      timeouts.push({ callback, delay });
      return timeouts.length;
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
        if (selector === "[data-phase-preset]") return [];        return [];
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
      innerHeight: 800
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
  const rendererPath = path.join(__dirname, "renderer.js");
  vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: rendererPath });
  windowListeners.DOMContentLoaded();
  return { elements, protocolHandlers, calls, intervals, timeouts, createdElements, context, localStorageStore };
}

test("renderer loads after shared provider script without global collisions", () => {
  const context = {
    console,
    window: {
      addEventListener: () => {},
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  const providerPath = path.join(__dirname, "providerDetect.js");
  const rendererPath = path.join(__dirname, "renderer.js");

  vm.runInContext(fs.readFileSync(providerPath, "utf8"), context, { filename: providerPath });
  vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: rendererPath });

  assert.equal(typeof context.window.AIAWD_PROVIDER.detectProvider, "function");
});

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
  assert.match(html, /id="agentRuntime"/);
  assert.match(html, /id="modelDisplayName"/);
  assert.match(html, /id="modelDisplayName" value="deepseek-chat"/);
  assert.match(html, /id="apiBaseUrl" value="https:\/\/api\.deepseek\.com"/);
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
  assert.match(html, /prepare-select/);
  assert.match(html, /prepare-select/);
  assert.match(html, /prepare-input/);
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
        apiBaseUrl: "",
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
        apiBaseUrl: "",
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
  assert.match(elements.arenaMap.innerHTML, /combatant-provider/);
  assert.match(elements.arenaMap.innerHTML, /readiness-track/);
  assert.match(elements.arenaMap.innerHTML, /1\/2 防线完整 · 1 次攻陷/);
  assert.match(elements.arenaMap.innerHTML, /is-leader/);
  assert.match(elements.arenaMap.innerHTML, /team_a/);
  assert.match(elements.arenaMap.innerHTML, /model-alpha/);
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

  // Room list shows room_777 with join buttons
  assert.match(elements.roomList.innerHTML, /room_777/);
  assert.match(elements.roomList.innerHTML, /参赛/);
  assert.match(elements.roomList.innerHTML, /观战/);
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
