const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ELEMENT_IDS = [
  "host",
  "port",
  "displayName",
  "connect",
  "disconnect",
  "connectionState",
  "clientId",
  "roomName",
  "maxPlayers",
  "targetTemplateId",
  "prepareSeconds",
  "defenseSeconds",
  "attackSeconds",
  "createRoom",
  "refreshRooms",
  "roomId",
  "agentRuntime",
  "modelDisplayName",
  "joinPlayer",
  "joinSpectator",
  "markTargetReady",
  "markAgentReady",
  "startMatch",
  "flagInput",
  "submitFlag",
  "roomList",
  "targetList",
  "players",
  "spectators",
  "selectedRoom",
  "myRole",
  "phase",
  "phaseTimer",
  "scoreSummary",
  "battleHeat",
  "nextStepTitle",
  "nextStepBody",
  "roomSummary",
  "matchSummary",
  "battleKit",
  "targetLifecycleStatus",
  "targetInstall",
  "targetStart",
  "targetHealth",
  "targetStop",
  "targetReset",
  "arenaMap",
  "survivalBoard",
  "resultSummary",
  "podiumList",
  "captureRecap",
  "generateReport",
  "copyReport",
  "downloadReport",
  "reportPreview",
  "rankings",
  "events",
  "messages",
  "matchConfig",
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
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [...this._innerHTML.matchAll(/data-room-id="([^"]+)"/g)].map((match) => {
      const child = new FakeElement(`room-${match[1]}`);
      child.dataset.roomId = match[1];
      return child;
    });
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  click() {
    this.clicked = true;
    if (this.listeners.click) {
      return this.listeners.click();
    }
    return undefined;
  }

  querySelectorAll(selector) {
    return selector === "[data-room-id]" ? this.children : [];
  }
}

function loadRenderer() {
  const elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new FakeElement(id)]));
  const windowListeners = {};
  const protocolHandlers = {};
  const calls = [];
  const intervals = [];
  const createdElements = [];
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
  return { elements, protocolHandlers, calls, intervals, createdElements };
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
  assert.equal(elements.battleHeat.textContent, "暂无交火");
  assert.equal(elements.nextStepTitle.textContent, "先连接裁判服务器");
  assert.match(elements.nextStepBody.textContent, /AWD 大厅/);
  assert.equal(elements.roomSummary.textContent, "还没有进入 AWD 房间");
  assert.equal(elements.matchSummary.textContent, "等待比赛配置");
  assert.equal(elements.battleKit.textContent, "等待私人比赛配置");
  assert.equal(elements.targetLifecycleStatus.textContent, "等待本地靶机计划");
  assert.equal(elements.targetLifecycleStatus.dataset.state, "idle");
  assert.match(elements.arenaMap.innerHTML, /等待玩家入场/);
  assert.match(elements.survivalBoard.innerHTML, /等待玩家入场/);
  assert.equal(elements.resultSummary.textContent, "等待比赛结果");
  assert.match(elements.podiumList.innerHTML, /排行榜同步后生成结算/);
  assert.equal(elements.captureRecap.textContent, "暂无击杀记录");
  assert.equal(elements.copyReport.disabled, true);
  assert.equal(elements.downloadReport.disabled, true);
  assert.match(elements.reportPreview.textContent, /私有 Flag 会保持隐藏/);
  assert.match(elements.players.innerHTML, /暂无参赛玩家/);
  assert.match(elements.spectators.innerHTML, /暂无观战方/);
  assert.match(elements.rankings.innerHTML, /暂无分数/);
  assert.match(elements.events.innerHTML, /暂无事件/);
  assert.match(elements.messages.innerHTML, /暂无消息/);
  assert.match(elements.targetList.innerHTML, /尚未加载靶机/);
  assert.equal(elements.connect.disabled, false);
  assert.equal(elements.createRoom.disabled, true);
  assert.equal(elements.markTargetReady.disabled, true);
  assert.equal(elements.markAgentReady.disabled, true);
  assert.equal(elements.targetStart.disabled, true);
  assert.equal(elements.targetHealth.disabled, true);
  assert.equal(intervals[0].delay, 1000);
});

test("index.html keeps Chinese shell text and defaults", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>AI-AWD Arena 战情大厅<\/title>/);
  assert.match(html, /id="displayName" value="本地玩家"/);
  assert.match(html, /id="agentRuntime" value="mock-agent"/);
  assert.match(html, /id="modelDisplayName" value="mock-model"/);
  assert.match(html, /id="roomName" value="AI AWD 演示房间"/);
  assert.match(html, /id="maxPlayers" type="number" min="2" value="4"/);
  assert.match(html, /id="battleHeat">暂无交火/);
  assert.match(html, /data-state="offline">未连接/);
  assert.match(html, /黑客攻防战情大厅/);
  assert.match(html, /大逃杀竞技场/);
  assert.match(html, /Agent 玩家入场与准备/);
  assert.match(html, /Agent 运行时/);
  assert.match(html, /模型名称/);
  assert.match(html, /生存态势/);
  assert.match(html, /大逃杀结算/);
  assert.match(html, /存活和击杀/);
  assert.match(html, /存活、击杀王、高危玩家和连击/);
  assert.match(html, /生成战报/);
  assert.match(html, /targetLifecycleStatus/);
  assert.match(html, /安装/);
  assert.match(html, /启动/);
  assert.match(html, /巡检/);
  assert.match(html, /reportPreview/);
  assert.match(html, /看谁能存活更久、击杀更多/);
  assert.match(html, /加固/);
  assert.match(html, /攻防/);
  assert.match(html, /TUI: 已支持/);
  assert.match(html, /macOS \/ Windows/);
  assert.match(html, /排障信息/);
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
        roomId: "room_001",
        role: "player",
      },
    ],
  ]));
});

test("renderer sends Agent runtime and model metadata when creating a room", async () => {
  const { elements, calls } = loadRenderer();

  await elements.connect.listeners.click();
  elements.roomName.value = "模型大逃杀";
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
        roomName: "模型大逃杀",
        maxPlayers: 3,
        targetTemplateId: "real_ctf_web_awd_01",
        displayName: "Alice",
        agentRuntime: "hermes-local",
        modelDisplayName: "model-alpha",
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
        name: "Web AWD 演示靶机",
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
          name: "Web AWD 演示靶机",
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
  assert.equal(elements.battleHeat.textContent, "1 次击杀 · team_a→team_b");
  assert.equal(elements.nextStepTitle.textContent, "大逃杀攻防已开启");
  assert.match(elements.roomSummary.textContent, /room_001/);
  assert.match(elements.roomSummary.textContent, /大逃杀/);
  assert.match(elements.matchSummary.textContent, /match_001/);
  assert.match(elements.battleKit.textContent, /大逃杀战斗包/);
  assert.match(elements.battleKit.textContent, /玩家 team_a/);
  assert.match(elements.battleKit.textContent, /team_a/);
  assert.match(elements.battleKit.textContent, /Web AWD 演示靶机/);
  assert.match(elements.battleKit.textContent, /进阶/);
  assert.match(elements.battleKit.textContent, /本地 Docker Compose/);
  assert.match(elements.battleKit.textContent, /健康 \/health/);
  assert.match(elements.battleKit.textContent, /计划 aiawd_room_001_team_a/);
  assert.match(elements.battleKit.textContent, /命令 install\/start\/stop\/reset/);
  assert.match(elements.battleKit.textContent, /巡检 http:\/\/127\.0\.0\.1:18081\/health/);
  assert.match(elements.battleKit.textContent, /对手 1 个/);
  assert.match(elements.battleKit.textContent, /允许目标 2 个/);
  assert.doesNotMatch(elements.battleKit.textContent, /FLAG\{secret\}/);
  assert.match(elements.targetLifecycleStatus.textContent, /计划 aiawd_room_001_team_a/);
  assert.equal(elements.targetLifecycleStatus.dataset.state, "idle");
  assert.equal(elements.targetStart.disabled, false);
  assert.equal(elements.targetHealth.disabled, false);
  assert.match(elements.arenaMap.innerHTML, /生存战场/);
  assert.match(elements.arenaMap.innerHTML, /我方存活王/);
  assert.match(elements.arenaMap.innerHTML, /对手玩家/);
  assert.match(elements.arenaMap.innerHTML, /is-leader/);
  assert.match(elements.arenaMap.innerHTML, /team_a/);
  assert.match(elements.arenaMap.innerHTML, /模型 model-alpha/);
  assert.match(elements.arenaMap.innerHTML, /100 分/);
  assert.match(elements.arenaMap.innerHTML, /存活 · 击杀 1/);
  assert.match(elements.arenaMap.innerHTML, /team_b/);
  assert.match(elements.arenaMap.innerHTML, /-50 分/);
  assert.match(elements.arenaMap.innerHTML, /被击破 1 次 · 击杀 0/);
  assert.match(elements.arenaMap.innerHTML, /is-breached/);
  assert.doesNotMatch(elements.arenaMap.innerHTML, /FLAG\{secret\}/);
  assert.match(elements.survivalBoard.innerHTML, /存活/);
  assert.match(elements.survivalBoard.innerHTML, /1\/2/);
  assert.match(elements.survivalBoard.innerHTML, /击杀王/);
  assert.match(elements.survivalBoard.innerHTML, /team_a/);
  assert.match(elements.survivalBoard.innerHTML, /高危玩家/);
  assert.match(elements.survivalBoard.innerHTML, /team_b/);
  assert.match(elements.survivalBoard.innerHTML, /被击破 1 次/);
  assert.match(elements.survivalBoard.innerHTML, /连击/);
  assert.match(elements.survivalBoard.innerHTML, /team_a x1/);
  assert.doesNotMatch(elements.survivalBoard.innerHTML, /FLAG\{secret\}/);
  assert.match(elements.resultSummary.textContent, /当前存活王 team_a/);
  assert.match(elements.resultSummary.textContent, /击杀 1/);
  assert.match(elements.resultSummary.textContent, /存活/);
  assert.match(elements.podiumList.innerHTML, /冠军/);
  assert.match(elements.podiumList.innerHTML, /team_a/);
  assert.match(elements.captureRecap.textContent, /最近击杀：team_a 击杀 team_b \+100 分/);
  assert.match(elements.players.innerHTML, /Alice/);
  assert.match(elements.players.innerHTML, /靶机已好/);
  assert.match(elements.players.innerHTML, /Agent 待确认/);
  assert.equal(elements.markTargetReady.disabled, false);
  assert.equal(elements.markAgentReady.disabled, false);
  assert.match(elements.spectators.innerHTML, /观察员/);
  assert.match(elements.rankings.innerHTML, /team_a/);
  assert.match(elements.rankings.innerHTML, /100 分/);
  assert.match(elements.rankings.innerHTML, /Alice · 我方 · 领先/);
  assert.match(elements.rankings.innerHTML, /Bob · 落后 150 分/);
  assert.match(elements.targetList.innerHTML, /进阶/);
  assert.match(elements.targetList.innerHTML, /本地 Docker Compose/);
  assert.match(elements.events.innerHTML, /击杀得分/);
  assert.match(elements.events.innerHTML, /data-tone="good"/);
  assert.match(elements.events.innerHTML, /team_a 击杀 team_b \+100 分/);
  assert.match(elements.messages.innerHTML, /PHASE_SYNC/);
  assert.match(elements.matchConfig.textContent, /FLAG\{已隐藏\}/);
  assert.doesNotMatch(elements.matchConfig.textContent, /FLAG\{secret\}/);

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

test("renderer shows battle royale final results after finished phase", () => {
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
  assert.equal(elements.nextStepTitle.textContent, "大逃杀结算完成");
  assert.equal(elements.submitFlag.disabled, true);
  assert.match(elements.resultSummary.textContent, /冠军 team_b · Bob · 150 分 · 击杀 1 · 存活/);
  assert.match(elements.podiumList.innerHTML, /team_b/);
  assert.match(elements.podiumList.innerHTML, /team_a/);
  assert.match(elements.podiumList.innerHTML, /team_c/);
  assert.match(elements.captureRecap.textContent, /最近击杀：team_b 击杀 team_c \+100 分/);
  assert.match(elements.arenaMap.innerHTML, /存活王玩家/);
  assert.match(elements.arenaMap.innerHTML, /生存战场/);
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
        name: "Web AWD 演示靶机",
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

  assert.match(elements.reportPreview.textContent, /# AI-AWD Arena 大逃杀战报/);
  assert.match(elements.reportPreview.textContent, /周赛训练房/);
  assert.match(elements.reportPreview.textContent, /击杀次数：1/);
  assert.match(elements.reportPreview.textContent, /存活玩家：1\/2/);
  assert.match(elements.reportPreview.textContent, /击杀王：team_a · 击杀 1/);
  assert.match(elements.reportPreview.textContent, /范围边界：仅限房间下发的 allowed_targets/);
  assert.match(elements.reportPreview.textContent, /1\. team_a · Alice · 100 分/);
  assert.match(elements.reportPreview.textContent, /## 存活情况/);
  assert.match(elements.reportPreview.textContent, /team_a · 存活 · 击杀 1/);
  assert.match(elements.reportPreview.textContent, /team_b · 被击破 1 次 · 击杀 0/);
  assert.match(elements.reportPreview.textContent, /1\. team_a 击杀 team_b \+100 分/);
  assert.match(elements.reportPreview.textContent, /靶场运行：进阶 · 本地 Docker Compose · 健康 \/health/);
  assert.match(elements.reportPreview.textContent, /本地运行计划：计划 aiawd_room_001_team_a · 命令 install\/start\/stop\/reset · 巡检 http:\/\/127\.0\.0\.1:18081\/health/);
  assert.match(elements.reportPreview.textContent, /Flag：FLAG\{已隐藏\}/);
  assert.doesNotMatch(elements.reportPreview.textContent, /FLAG\{secret\}/);
  assert.equal(elements.copyReport.disabled, false);
  assert.equal(elements.downloadReport.disabled, false);

  await elements.copyReport.listeners.click();
  await elements.downloadReport.listeners.click();

  const copied = calls.find((call) => call[0] === "clipboard")[1];
  const downloaded = calls.find((call) => call[0] === "createObjectURL")[1];
  assert.match(copied, /AI-AWD Arena 大逃杀战报/);
  assert.match(downloaded, /AI-AWD Arena 大逃杀战报/);
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
  assert.match(elements.roomList.innerHTML, /大逃杀/);
  assert.match(elements.roomList.innerHTML, /1\/2 玩家/);

  const roomButton = elements.roomList.querySelectorAll("[data-room-id]")[0];
  await roomButton.listeners.click();

  assert.equal(elements.roomId.value, "room_777");
  assert.equal(elements.selectedRoom.textContent, "room_777");
  assert.match(elements.events.innerHTML, /已选择房间/);
  assert.match(elements.events.innerHTML, /room_777/);
});

test("renderer records Chinese validation event when submitting an empty flag", async () => {
  const { elements } = loadRenderer();

  await elements.submitFlag.listeners.click();

  assert.match(elements.events.innerHTML, /未提交/);
  assert.match(elements.events.innerHTML, /data-tone="warn"/);
});
