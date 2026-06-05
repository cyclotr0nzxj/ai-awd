const state = {
  connected: false,
  clientId: null,
  roomId: null,
  role: null,
  matchId: null,
  room: null,
  match: null,
  rankings: [],
  targets: [],
  events: [],
  messages: [],
  configs: [],
  reportText: "",
  targetActionStatus: {
    state: "idle",
    message: "等待本地靶机计划",
  },
  agentStatus: {
    state: "idle",
    message: "Agent 未启动",
  },
  captureCounts: {},
  breachCounts: {},
  scorePopup: null,
  focusedTeamId: null,
  replayIndex: 0,
  autoPlayActive: false,
  autoPlayTimer: null,
};

const els = {};

window.addEventListener("DOMContentLoaded", () => {
  for (const id of [
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
    "attackHeat",
    "nextStepTitle",
    "nextStepBody",
    "roomSummary",
    "matchSummary",
    "attackKit",
    "targetLifecycleStatus",
    "targetDoctor",
    "targetInstall",
    "targetStart",
    "targetHealth",
    "targetStop",
    "targetReset",
    "arenaMap",
    "defenseBoard",
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
    "agentCommand",
    "agentStart",
    "agentStop",
    "agentStatus",
    "startOnboarding",
    "apiKey",
  ]) {
    els[id] = document.getElementById(id);
  }

  // —— Phase timing presets ——
  const phasePresets = {
    quick: { prepare: 30, defense: 60, attack: 120 },
    standard: { prepare: 60, defense: 600, attack: 1800 },
    long: { prepare: 120, defense: 1800, attack: 3600 },
  };
  for (const btn of document.querySelectorAll("[data-phase-preset]")) {
    btn.addEventListener("click", () => {
      const preset = phasePresets[btn.dataset.phasePreset];
      if (!preset) return;
      els.prepareSeconds.value = preset.prepare;
      els.defenseSeconds.value = preset.defense;
      els.attackSeconds.value = preset.attack;
      for (const b of document.querySelectorAll("[data-phase-preset]")) b.classList.remove("active");
      btn.classList.add("active");
    });
  }

  els.connect.addEventListener("click", connect);
  els.disconnect.addEventListener("click", disconnect);
  els.refreshRooms.addEventListener("click", listRooms);
  els.createRoom.addEventListener("click", createRoom);
  els.joinPlayer.addEventListener("click", () => joinRoom("player"));
  els.joinSpectator.addEventListener("click", () => joinRoom("spectator"));
  els.markTargetReady.addEventListener("click", () => markReady("TARGET_READY"));
  els.markAgentReady.addEventListener("click", () => markReady("AGENT_READY"));
  els.startMatch.addEventListener("click", startMatch);
  els.submitFlag.addEventListener("click", submitFlag);
  els.targetDoctor.addEventListener("click", () => runTargetLifecycle("doctor"));
  els.targetInstall.addEventListener("click", () => runTargetLifecycle("install"));
  els.targetStart.addEventListener("click", () => runTargetLifecycle("start"));
  els.targetHealth.addEventListener("click", () => runTargetLifecycle("health"));
  els.targetStop.addEventListener("click", () => runTargetLifecycle("stop"));
  els.targetReset.addEventListener("click", () => runTargetLifecycle("reset"));
  if (els.agentStart) els.agentStart.addEventListener("click", agentStart);
  if (els.agentStop) els.agentStop.addEventListener("click", agentStop);
  els.generateReport.addEventListener("click", generateReport);
  els.copyReport.addEventListener("click", copyReport);
  els.downloadReport.addEventListener("click", downloadReport);

  // —— Onboarding / 新手教程 ——
  if (typeof OnboardingEngine !== "undefined") {
    OnboardingEngine.init();
    // Auto-start on first visit (after a short delay so the UI paints first)
    setTimeout(() => {
      if (OnboardingEngine.autoStart()) {
        addEvent("ONBOARDING_STARTED", {});
        render();
      }
    }, 600);
    if (els.startOnboarding) {
      els.startOnboarding.addEventListener("click", () => {
        OnboardingEngine.start();
        addEvent("ONBOARDING_STARTED", { replay: true });
        render();
      });
    }
  }

  // —— Tab switching ——
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => {
      for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
      btn.classList.add("active");
      for (const p of document.querySelectorAll(".tab-panel")) p.classList.remove("active");
      const panel = document.querySelector(`[data-panel="${btn.dataset.tab}"]`);
      if (panel) panel.classList.add("active");
    });
  }

  window.aiawd = window.aiawd || unavailableBridge();
  window.aiawd.onMessage(handleMessage);
  window.aiawd.onStatus((status) => {
    if (!status.connected) {
      state.connected = false;
      state.clientId = null;
      render();
    }
  });
  setInterval(refreshPhaseTimer, 1000);

  render();
});

async function connect() {
  try {
    const snapshot = await window.aiawd.connect({
      host: els.host.value.trim() || "127.0.0.1",
      port: Number(els.port.value || 9000),
      displayName: els.displayName.value.trim() || "本地玩家",
    });
    state.connected = snapshot.connected;
    state.clientId = snapshot.clientId;
    addEvent("CLIENT_CONNECTED", snapshot);
    await window.aiawd.listTargets();
    await window.aiawd.listRooms();
  } catch (error) {
    addEvent("CONNECT_FAILED", { message: error.message });
  }
  render();
}

async function disconnect() {
  await window.aiawd.disconnect();
  state.connected = false;
  state.clientId = null;
  addEvent("CLIENT_DISCONNECTED", {});
  render();
}

async function createRoom() {
  await action("CREATE_ROOM", () =>
    window.aiawd.createRoom({
      roomName: els.roomName.value.trim() || "AI-AWD AI攻防乱斗演示房间",
      maxPlayers: Number(els.maxPlayers.value || 2),
      targetTemplateId: els.targetTemplateId.value.trim() || "real_ctf_web_awd_01",
      displayName: els.displayName.value.trim() || "本地玩家",
      agentRuntime: els.agentRuntime.value.trim() || "mock-agent",
      modelDisplayName: els.modelDisplayName.value.trim() || "claude-sonnet-4-6",
      apiKey: els.apiKey?.value?.trim() || "",
      allowSpectators: true,
      phaseSeconds: {
        prepare: Number(els.prepareSeconds.value || 60),
        defense: Number(els.defenseSeconds.value || 600),
        attack: Number(els.attackSeconds.value || 1800),
      },
    }),
  );
}

async function joinRoom(role) {
  const roomId = els.roomId.value.trim() || state.roomId;
  if (!roomId) {
    addEvent("JOIN_SKIPPED", { message: "需要填写房间 ID" });
    render();
    return;
  }
  state.role = role;
  await action("JOIN_ROOM", () =>
    window.aiawd.joinRoom({
      displayName: els.displayName.value.trim() || "本地玩家",
      agentRuntime: els.agentRuntime.value.trim() || "mock-agent",
      modelDisplayName: els.modelDisplayName.value.trim() || "claude-sonnet-4-6",
      apiKey: els.apiKey?.value?.trim() || "",
      roomId,
      role,
    }),
  );
}

async function startMatch() {
  const roomId = els.roomId.value.trim() || state.roomId;
  await action("START_MATCH", () => window.aiawd.startMatch({ roomId }));
}

async function markReady(type) {
  const roomId = els.roomId.value.trim() || state.roomId;
  await action(type, () =>
    type === "TARGET_READY" ? window.aiawd.markTargetReady({ roomId }) : window.aiawd.markAgentReady({ roomId }),
  );
}

async function submitFlag() {
  const roomId = els.roomId.value.trim() || state.roomId;
  const flag = els.flagInput.value.trim();
  if (!flag) {
    addEvent("SUBMIT_SKIPPED", { message: "需要填写 Flag" });
    render();
    return;
  }
  await action("SUBMIT_FLAG", () =>
    window.aiawd.submitFlag({
      roomId,
      matchId: state.matchId,
      flag,
    }),
  );
}

async function runTargetLifecycle(actionName) {
  const config = state.configs[0];
  if (!config?.target_runtime) {
    addEvent("TARGET_ACTION_SKIPPED", { message: "等待本地靶机计划" });
    render();
    return;
  }
  const label = targetActionLabel(actionName);
  state.targetActionStatus = { state: "running", action: actionName, message: `${label}中...` };
  render();
  try {
    const result = await window.aiawd.runTargetAction({
      action: actionName,
      runtime: config.target_runtime,
      flag: config.flag,
    });
    state.targetActionStatus = {
      state: result.ok ? "ok" : "warn",
      action: actionName,
      message: targetActionResultText(result),
    };
    addEvent("TARGET_ACTION_DONE", { action: actionName, message: state.targetActionStatus.message });
  } catch (error) {
    state.targetActionStatus = {
      state: "bad",
      action: actionName,
      message: error.message || `${label}失败`,
    };
    addEvent("TARGET_ACTION_FAILED", { action: actionName, message: state.targetActionStatus.message });
  }
  render();
}

async function agentStart() {
  const config = state.configs[0];
  if (!config) {
    addEvent("AGENT_SKIPPED", { message: "等待比赛配置" });
    render();
    return;
  }
  const command = els.agentCommand.value.trim().split(/\s+/).filter(Boolean);
  if (!command.length) {
    addEvent("AGENT_SKIPPED", { message: "需要指定 Agent 命令" });
    render();
    return;
  }
  state.agentStatus = { state: "running", message: "Agent 攻击中..." };
  render();
  try {
    const result = await window.aiawd.agentStart({
      command,
      matchConfig: config,
      roomStatus: state.match?.phase || state.room?.status || "LOBBY",
      matchId: state.matchId,
      roomId: state.roomId,
    });
    state.agentStatus = {
      state: result.ok ? "ok" : "warn",
      message: result.ok
        ? `Agent 完成 · ${result.flagsCaptured?.length || 0} Flag · ${result.elapsedMs}ms`
        : result.error || "Agent 执行失败",
    };
    if (result.flagsCaptured?.length) {
      addEvent("AGENT_FLAGS_FOUND", { flags: result.flagsCaptured, elapsedMs: result.elapsedMs });
    } else {
      addEvent("AGENT_DONE", { message: state.agentStatus.message });
    }
  } catch (error) {
    state.agentStatus = { state: "bad", message: error.message || "Agent 失败" };
    addEvent("AGENT_FAILED", { message: state.agentStatus.message });
  }
  render();
}

async function agentStop() {
  try {
    await window.aiawd.agentStop();
    state.agentStatus = { state: "idle", message: "Agent 已停止" };
  } catch (error) {
    state.agentStatus = { state: "idle", message: `停止失败: ${error.message}` };
  }
  render();
}

async function listRooms() {
  await action("LIST_ROOMS", () => window.aiawd.listRooms());
}

async function action(type, run) {
  if (!state.connected) {
    addEvent("SEND_SKIPPED", { type, message: "尚未连接裁判服务器" });
    render();
    return;
  }
  try {
    await run();
  } catch (error) {
    addEvent("SEND_FAILED", { type, message: error.message });
  }
}

function handleMessage(message) {
  state.messages.unshift(message);
  state.messages = state.messages.slice(0, 80);

  switch (message.type) {
    case "WELCOME":
      state.clientId = message.payload?.client_id || message.client_id;
      state.connected = true;
      break;
    case "CREATE_ROOM_RES":
    case "JOIN_ROOM_RES":
      if (message.payload?.room) {
        state.room = message.payload.room;
        state.roomId = state.room.room_id;
        els.roomId.value = state.roomId;
        state.role = message.role || inferRoleFromRoom(state.room) || state.role;
        syncArenaFocus();
      }
      if (message.role) {
        state.role = message.role;
      }
      break;
    case "LIST_ROOMS_RES":
      renderRooms(message.payload?.rooms || []);
      break;
    case "LIST_TARGETS_RES":
      state.targets = message.payload?.targets || [];
      if (state.targets[0]?.template_id && !els.targetTemplateId.value) {
        els.targetTemplateId.value = state.targets[0].template_id;
      }
      break;
    case "ROOM_UPDATE":
      state.room = message.payload?.room || state.room;
      state.roomId = state.room?.room_id || state.roomId;
      state.role = inferRoleFromRoom(state.room) || state.role;
      syncArenaFocus();
      if (state.roomId) {
        els.roomId.value = state.roomId;
      }
      break;
    case "MATCH_CONFIG":
      state.configs.unshift(message.payload);
      state.configs = state.configs.slice(0, 3);
      state.matchId = message.payload?.match_id || state.matchId;
      state.targetActionStatus = {
        state: "idle",
        message: targetRuntimePlanText(message.payload) || "等待本地靶机计划",
      };
      break;
    case "PHASE_SYNC":
      state.match = message.payload?.match || state.match;
      state.matchId = state.match?.match_id || state.matchId;
      break;
    case "RANKING_UPDATE":
      state.rankings = message.payload?.rankings || [];
      syncArenaFocus();
      break;
    case "EVENT": {
      const eventType = message.payload?.event_type;
      const eventPayload = message.payload?.event || message.payload;
      addEvent(eventType || "EVENT", eventPayload);
      if (eventType === "FLAG_CAPTURED" && eventPayload) {
        const submitter = eventPayload.submitter_team_id;
        const target = eventPayload.target_team_id;
        if (submitter) {
          state.captureCounts[submitter] = (state.captureCounts[submitter] || 0) + 1;
        }
        if (target) {
          state.breachCounts[target] = (state.breachCounts[target] || 0) + 1;
        }
        if (submitter) {
          state.focusedTeamId = submitter;
        }
        state.scorePopup = {
          teamId: submitter,
          delta: eventPayload.score_delta || 0,
          timestamp: Date.now(),
        };
        state.replayIndex = 0;
      }
      break;
    }
    case "ERROR":
      addEvent("ERROR", message.payload || {});
      break;
    default:
      break;
  }

  render();
}

function addEvent(type, payload) {
  state.events.unshift({
    type,
    payload,
    at: new Date().toLocaleTimeString(),
  });
  state.events = state.events.slice(0, 40);
}

function generateReport() {
  state.reportText = buildReportText();
  addEvent("REPORT_GENERATED", { room_id: state.roomId || "-", match_id: state.matchId || "-" });
  render();
}

async function copyReport() {
  if (!state.reportText) {
    return;
  }
  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(state.reportText);
    addEvent("REPORT_COPIED", {});
  } else {
    addEvent("REPORT_COPY_UNAVAILABLE", { message: "当前环境不支持剪贴板" });
  }
  render();
}

function downloadReport() {
  if (!state.reportText || typeof Blob === "undefined" || typeof URL === "undefined") {
    addEvent("REPORT_DOWNLOAD_UNAVAILABLE", { message: "当前环境不支持下载" });
    render();
    return;
  }
  const blob = new Blob([state.reportText], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilePart(state.roomId || "aiawd")}-battle-report.md`;
  link.click();
  URL.revokeObjectURL(url);
  addEvent("REPORT_DOWNLOADED", { file: link.download });
  render();
}

function render() {
  els.connectionState.textContent = state.connected ? "已连接" : "未连接";
  els.connectionState.dataset.state = state.connected ? "connected" : "offline";
  els.clientId.textContent = state.clientId || "-";

  const players = state.room?.players || [];
  const spectators = state.room?.spectators || [];
  els.players.innerHTML = players.map(memberItem).join("") || "<li>暂无参赛玩家</li>";
  els.spectators.innerHTML = spectators.map(memberItem).join("") || "<li>暂无观战方</li>";

  const phase = state.match?.phase || state.room?.status || "LOBBY";
  els.phase.textContent = displayPhase(phase);
  els.phase.dataset.phase = phase;
  els.phaseTimer.textContent = phaseTimerSummary();
  els.selectedRoom.textContent = state.roomId || "未选择";
  els.myRole.textContent = displayRole(state.role);
  els.scoreSummary.textContent = myScoreSummary();
  els.attackHeat.textContent = attackHeatSummary();
  renderGuidance(phase, players);
  renderSummaries(phase, players, spectators);
  renderBattleKit();
  renderTargetLifecycle();
  renderArenaMap(phase, players);
  renderSurvivalBoard(phase, players);
  renderResultsPanel(phase);
  renderAgentStatus();

  els.connect.disabled = state.connected;
  els.disconnect.disabled = !state.connected;
  els.createRoom.disabled = !state.connected;
  els.refreshRooms.disabled = !state.connected;
  els.joinPlayer.disabled = !state.connected;
  els.joinSpectator.disabled = !state.connected;
  els.markTargetReady.disabled = !state.connected || !state.roomId || state.role === "spectator";
  els.markAgentReady.disabled = !state.connected || !state.roomId || state.role === "spectator";
  els.startMatch.disabled = !state.connected || !state.roomId || state.role === "spectator";
  els.submitFlag.disabled = !state.connected || phase !== "ATTACK" || state.role === "spectator";
  setTargetLifecycleDisabled();
  els.copyReport.disabled = !state.reportText;
  els.downloadReport.disabled = !state.reportText;
  els.reportPreview.textContent = state.reportText || "战报将在这里生成，私有 Flag 会保持隐藏。";

  els.rankings.innerHTML =
    state.rankings
      .map(
        (row, index) =>
          `<li class="rank-row" data-rank="${index + 1}">
            <span>
              <b>第 ${index + 1} 名 · ${escapeHtml(row.team_id || "-")}</b>
              <small>${escapeHtml(rankingMeta(row, index))}</small>
            </span>
            <strong>${escapeHtml(row.score ?? 0)} 分</strong>
          </li>`,
      )
      .join("") || "<li>暂无分数</li>";

  els.events.innerHTML =
    state.events
      .map(
        (event) =>
          `<li class="event-row" data-tone="${escapeHtml(eventTone(event))}">
            <span>
              <small>${escapeHtml(event.at)}</small>
              ${escapeHtml(eventSummary(event))}
            </span>
            <strong>${escapeHtml(displayEventType(event.type))}</strong>
          </li>`,
      )
      .join("") ||
    "<li>暂无事件</li>";

  els.messages.innerHTML =
    state.messages
      .map((message) => `<li><strong>${escapeHtml(message.type)}</strong><span>${escapeHtml(message.room_id || "")}</span></li>`)
      .join("") || "<li>暂无消息</li>";

  els.matchConfig.textContent = state.configs.length ? JSON.stringify(redactMatchConfig(state.configs[0]), null, 2) : "{}";
  els.targetList.innerHTML =
    state.targets
      .map(
        (target) =>
          `<li><span>${escapeHtml(displayDifficulty(target.difficulty))} · ${escapeHtml(displayRuntime(target.runtime))}</span><strong>${escapeHtml(target.name || target.template_id)}</strong></li>`,
      )
      .join("") ||
    "<li>尚未加载靶机</li>";
}

function refreshPhaseTimer() {
  if (els.phaseTimer) {
    els.phaseTimer.textContent = phaseTimerSummary();
  }
  if (state.scorePopup && Date.now() - state.scorePopup.timestamp > 2000) {
    state.scorePopup = null;
    render();
  }
}

function renderGuidance(phase, players) {
  const targetReadyCount = players.filter((player) => player.target_ready).length;
  const agentReadyCount = players.filter((player) => player.agent_ready).length;

  if (!state.connected) {
    els.nextStepBody.textContent = "先连接裁判服务器";
    els.nextStepBody.textContent = "连接后进入AI攻防乱斗大厅，可以创建房间，或输入房间 ID 加入已有比赛。";
    return;
  }
  if (!state.roomId) {
    els.nextStepBody.textContent = "选择一场AI攻防乱斗";
    els.nextStepBody.textContent = "房主创建AI攻防房间；玩家从公开房间选择后参赛或观战。";
    return;
  }
  if (state.role === "spectator") {
    els.nextStepBody.textContent = "正在观战";
    els.nextStepBody.textContent = "观战席只能查看阶段、事件和排行，不能开始比赛或提交 Flag。";
    return;
  }
  if (phase === "LOBBY") {
    els.nextStepBody.textContent = "AI攻防大乱斗入场准备";
    els.nextStepBody.textContent = `房间内全员互为目标，目标是尽量保持防线完整并完成更多攻陷。已加入 ${players.length} 位玩家，靶机 ${targetReadyCount}/${players.length}，Agent ${agentReadyCount}/${players.length}。`;
    return;
  }
  if (phase === "ATTACK") {
    els.nextStepBody.textContent = "AI攻防大乱斗已开启";
    els.nextStepBody.textContent = "每位玩家都可在 allowed_targets 内攻击对手靶机，拿到 Flag 后提交攻陷凭证刷新排行。";
    return;
  }
  if (phase === "FINISHED") {
    els.nextStepBody.textContent = "AI攻防大乱斗结算完成";
    els.nextStepBody.textContent = "比赛已结束，查看冠军、前三名、防线完整情况和攻陷回放，准备导出报告或复盘。";
    return;
  }
  els.nextStepTitle.textContent = `${displayPhase(phase)}阶段进行中`;
  els.nextStepBody.textContent = "请关注事件和排行榜，等待裁判服务器同步下一阶段。";
}

function renderSummaries(phase, players, spectators) {
  if (!state.room) {
    els.roomSummary.textContent = "还没有进入AI攻防乱斗房间";
  } else {
    const roomName = state.room.room_name || state.room.room_id;
    els.roomSummary.textContent = `${roomName} · AI攻防大乱斗 · ${players.length}/${state.room.max_players || "-"} 位玩家 · ${spectators.length} 位观战`;
  }

  if (!state.matchId) {
    els.matchSummary.textContent = "等待比赛配置";
  } else {
    els.matchSummary.textContent = `${displayPhase(phase)}阶段 · 比赛 ${state.matchId}`;
  }
}

function renderBattleKit() {
  const config = state.configs[0];
  if (!config) {
    els.attackKit.textContent = "等待私人战斗包";
    return;
  }
  const opponentCount = Array.isArray(config.opponents) ? config.opponents.length : 0;
  const allowedCount = Array.isArray(config.allowed_targets) ? config.allowed_targets.length : 0;
  const targetMeta = targetMetaParts(config);
  const runtimePlan = targetRuntimePlanText(config);
  els.attackKit.textContent = `私人战斗包 · 玩家 ${config.team_id || "-"} · ${targetMeta.join(" · ")}${runtimePlan ? ` · ${runtimePlan}` : ""} · 对手 ${opponentCount} 个 · 允许目标 ${allowedCount} 个`;
}

function renderTargetLifecycle() {
  const config = state.configs[0];
  const hasRuntime = Boolean(config?.target_runtime?.project_name);
  els.targetLifecycleStatus.textContent =
    state.targetActionStatus.message || (hasRuntime ? targetRuntimePlanText(config) : "等待本地靶机计划");
  els.targetLifecycleStatus.dataset.state = state.targetActionStatus.state || "idle";
}

function renderAgentStatus() {
  if (!els.agentStatus) return;
  els.agentStatus.textContent = state.agentStatus?.message || "Agent 未启动";
  els.agentStatus.dataset.state = state.agentStatus?.state || "idle";
  const hasConfig = Boolean(state.configs[0]);
  const isAttack = (state.match?.phase || "") === "ATTACK";
  if (els.agentStart) els.agentStart.disabled = !state.connected || !hasConfig || !isAttack || state.role === "spectator";
  if (els.agentStop) els.agentStop.disabled = state.agentStatus?.state !== "running";
}

function setTargetLifecycleDisabled() {
  const hasRuntime = Boolean(state.configs[0]?.target_runtime?.project_name);
  const isRunning = state.targetActionStatus.state === "running";
  const disabled = !hasRuntime || isRunning || state.role === "spectator";
  for (const button of [els.targetDoctor, els.targetInstall, els.targetStart, els.targetHealth, els.targetStop, els.targetReset]) {
    button.disabled = disabled;
  }
}

function renderArenaMap(phase, players) {
  if (!players.length) {
    els.arenaMap.innerHTML = `
      <div class="arena-node node-referee">
        <span>REF</span>
        <strong>裁判服务器</strong>
      </div>
      <div class="arena-empty">等待玩家入场</div>
    `;
    return;
  }

  const ownTeamId = state.configs[0]?.team_id;
  const leaderTeamId = state.rankings[0]?.team_id;
  const focusedTeamId = selectedArenaTeamId(players);
  const replay = currentReplay();
  const replayPayload = replay ? capturePayload(replay) : {};
  const combatants = players
    .map((player, index) => {
      const teamId = player.team_id || `slot_${index + 1}`;
      const isSelf = (ownTeamId && teamId === ownTeamId) || player.client_id === state.clientId;
      const isLeader = leaderTeamId && teamId === leaderTeamId;
      const isFocused = focusedTeamId && teamId === focusedTeamId;
      const isAttacker = replayPayload.submitter_team_id && teamId === replayPayload.submitter_team_id;
      const isTarget = replayPayload.target_team_id && teamId === replayPayload.target_team_id;
      const nodeLabel = isSelf && isLeader ? "我方防线完整领先" : isSelf ? "我方 Agent 模型玩家" : isLeader ? "防线完整领先玩家" : "Agent 模型玩家";
      const score = teamScore(teamId);
      const readyText = `${player.target_ready ? "靶机已好" : "靶机待确认"} · ${player.agent_ready ? "Agent 已好" : "Agent 待确认"}`;
      const modelText = player.model_display_name ? `模型 ${player.model_display_name}` : "";
      const playerText = [player.display_name || "-", modelText].filter(Boolean).join(" · ");
      const isBreached = breachCount(teamId) > 0;
      const readiness = readinessPercent(player);
      const popup = state.scorePopup;
      const showScorePopup = popup && popup.teamId === teamId && Date.now() - popup.timestamp < 2000;
      const scorePopupHtml = showScorePopup
        ? `<div class="score-popup${popup.delta > 0 ? " is-gain" : " is-loss"}">${popup.delta > 0 ? "+" : ""}${popup.delta}</div>`
        : "";
      return `<button type="button" class="arena-combatant${isSelf ? " is-self" : ""}${isLeader ? " is-leader" : ""}${isBreached ? " is-breached" : ""}${isFocused ? " is-focused" : ""}${isAttacker ? " is-attacker" : ""}${isTarget ? " is-target" : ""}" data-team-id="${escapeHtml(teamId)}">
        ${scorePopupHtml}
        <div class="combatant-head">
          <div class="combatant-avatar" data-status="${escapeHtml(isBreached ? "breached" : "alive")}">${escapeHtml(combatantInitials(player, teamId))}</div>
          <div>
            <span>${escapeHtml(nodeLabel)}</span>
            <strong>${escapeHtml(teamId)}</strong>
          </div>
        </div>
        <small>${escapeHtml(playerText)}</small>
        <div class="combatant-stats">
          <em>${escapeHtml(score === null ? "暂无分数" : `${score} 分`)}</em>
          <b>${escapeHtml(captureCount(teamId))} 攻陷 · ${escapeHtml(breachCount(teamId))} 失守</b>
        </div>
        <div class="readiness-track" title="靶机和 Agent 就绪度"><span style="width: ${readiness}%"></span></div>
        <i>${escapeHtml(combatMetricText(teamId))}</i>
        <small>${escapeHtml(readyText)}</small>
      </button>`;
    })
    .join("");
  const captures = captureEvents();
  normalizeReplayIndex(captures);
  const threatLanes = captures.length
    ? captures.slice(0, 4).map((event, index) => threatLane(event, index, index === state.replayIndex)).join("")
    : `<div class="threat-lane is-idle">
        <span>等待首次攻陷</span>
        <strong>REF</strong>
        <em>${escapeHtml(players.length)} 位 Agent 模型玩家待交火</em>
      </div>`;

  els.arenaMap.innerHTML = `
    <div class="arena-core${replay ? " is-replay" : ""}${state.autoPlayActive ? " is-autoplay" : ""}">
      <span>${escapeHtml(displayPhase(phase))}</span>
      <strong>AI攻防大乱斗</strong>
      <small>${escapeHtml(aliveCount(players))}/${escapeHtml(players.length)} 防线完整 · ${escapeHtml(captures.length)} 次攻陷</small>
    </div>
    <div class="arena-field">
      <div class="arena-battlefield">${combatants}</div>
      <div class="arena-threats">${threatLanes}</div>
      ${arenaFocusPanel(players, focusedTeamId)}
      ${arenaReplayPanel(captures)}
    </div>
  `;
  bindArenaFocus();
  bindArenaReplay();
}

function renderSurvivalBoard(phase, players) {
  if (!players.length) {
    els.defenseBoard.innerHTML = "<div class=\"arena-empty\">等待玩家入场</div>";
    return;
  }

  const stats = teamStats(players);
  const alive = stats.filter((stat) => stat.breaches === 0).length;
  const captureLeader = captureLeaderStat(stats);
  const highRisk = highRiskStat(stats);
  const streak = captureStreak();
  const latest = captureEvents()[0];

  els.defenseBoard.innerHTML = `
    <div class="survival-metrics">
      ${defenseMetric("防线完整情况", `${alive}/${stats.length}`, `${escapeHtml(displayPhase(phase))} · ${captureEvents().length} 次攻陷`, "ok")}
      ${defenseMetric("攻陷领先", captureLeader ? captureLeader.teamId : "暂无", captureLeader ? `攻陷 ${captureLeader.captures} · ${captureLeader.score} 分` : "等待首次攻陷", "hot")}
      ${defenseMetric("失守最多", highRisk ? highRisk.teamId : "暂无", highRisk ? `失守 ${highRisk.breaches} 次` : "全员防线完整", highRisk ? "danger" : "ok")}
      ${defenseMetric("连续攻陷", streak ? `${streak.teamId} x${streak.count}` : "暂无", latest ? captureRoute(latest) : "等待交火", streak && streak.count >= 2 ? "hot" : "")}
    </div>
    <div class="survival-roster">
      ${stats.map(defenseRosterItem).join("")}
    </div>
  `;
}

function defenseMetric(label, value, detail, tone = "") {
  return `<div class="survival-metric${tone ? ` is-${escapeHtml(tone)}` : ""}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(detail)}</small>
  </div>`;
}

function defenseRosterItem(stat) {
  const status = stat.breaches ? `失守 ${stat.breaches} 次` : "防线完整";
  const model = stat.model ? `模型 ${stat.model}` : "";
  const ready = `${stat.targetReady ? "靶机已好" : "靶机待确认"} · ${stat.agentReady ? "Agent 已好" : "Agent 待确认"}`;
  const detail = [stat.name, model, ready].filter(Boolean).join(" · ");
  return `<div class="defense-team${stat.breaches ? " is-breached" : ""}">
    <span>${escapeHtml(status)}</span>
    <strong>${escapeHtml(stat.teamId)}</strong>
    <em>${escapeHtml(stat.captures)} 攻陷 · ${escapeHtml(stat.score)} 分</em>
    <small>${escapeHtml(detail || "-")}</small>
  </div>`;
}

function renderResultsPanel(phase) {
  const captures = captureEvents();
  if (!state.rankings.length) {
    els.resultSummary.textContent = "等待比赛结果";
    els.podiumList.innerHTML = "<li>排行榜同步后生成结算</li>";
    els.captureRecap.textContent = "暂无攻陷记录";
    return;
  }

  const leader = state.rankings[0];
  const leaderTeamId = leader.team_id || "";
  const title = phase === "FINISHED" ? "冠军" : "当前防线完整王";
  els.resultSummary.textContent = `${title} ${leaderTeamId || "-"} · ${leader.display_name || "-"} · ${leader.score ?? 0} 分 · 攻陷 ${captureCount(leaderTeamId)} · ${defenseText(leaderTeamId)}`;
  els.podiumList.innerHTML = state.rankings
    .slice(0, 3)
    .map(
      (row, index) =>
        `<li class="podium-row" data-rank="${index + 1}">
          <span>${escapeHtml(index === 0 ? "冠军" : `第 ${index + 1} 名`)}</span>
          <strong>${escapeHtml(row.team_id || "-")}</strong>
          <em>${escapeHtml(row.score ?? 0)} 分 · 攻陷 ${escapeHtml(captureCount(row.team_id || ""))} · ${escapeHtml(defenseText(row.team_id || ""))}</em>
        </li>`,
    )
    .join("");
  els.captureRecap.textContent = captures.length ? `最近攻陷：${captureRoute(captures[0])}` : "暂无攻陷记录";
}

function buildReportText() {
  const roomName = state.room?.room_name || state.roomId || "未进入房间";
  const phase = state.match?.phase || state.room?.status || "LOBBY";
  const players = state.room?.players || [];
  const spectators = state.room?.spectators || [];
  const captures = captureEvents();
  const config = state.configs[0] ? redactMatchConfig(state.configs[0]) : null;
  const lines = [
    "# AI-AWD Arena AI攻防大乱斗战报",
    "",
    `- 房间：${roomName}`,
    `- 房间 ID：${state.roomId || "-"}`,
    `- 比赛 ID：${state.matchId || "-"}`,
    `- 阶段：${displayPhase(phase)}`,
    `- 参赛玩家：${players.length}/${state.room?.max_players || "-"}`,
    `- 观战席：${spectators.length}`,
    `- 攻陷次数：${captures.length}`,
    `- 防线完整玩家：${aliveCount(players)}/${players.length}`,
    `- 攻陷领先：${reportKillLeader(players)}`,
    `- 范围边界：仅限房间下发的 allowed_targets，本报告不包含私有 Flag 明文。`,
    "",
    "## 排名",
    ...reportRankingLines(),
    "",
    "## 防线完整情况",
    ...reportSurvivalLines(players),
    "",
    "## 攻陷回放",
    ...(captures.length ? captures.map((event, index) => `${index + 1}. ${captureRoute(event)}`) : ["- 暂无攻陷记录"]),
  ];
  if (config) {
    lines.push(
      "",
      "## 私人战斗包摘要",
      `- 玩家：${config.team_id || "-"}`,
      `- 靶场：${config.target_manifest?.name || config.target_template_id || "-"}`,
      `- 靶场运行：${targetMetaParts(config).slice(1).join(" · ") || "-"}`,
      `- 本地运行计划：${targetRuntimePlanText(config) || "-"}`,
      `- 允许目标数量：${Array.isArray(config.allowed_targets) ? config.allowed_targets.length : 0}`,
      `- 对手数量：${Array.isArray(config.opponents) ? config.opponents.length : 0}`,
      `- Flag：${config.flag || "FLAG{已隐藏}"}`,
    );
  }
  return lines.join("\n");
}

function reportRankingLines() {
  if (!state.rankings.length) {
    return ["- 暂无排行榜"];
  }
  return state.rankings.map(
    (row, index) =>
      `${index + 1}. ${row.team_id || "-"} · ${row.display_name || "-"} · ${row.score ?? 0} 分 · 攻陷 ${captureCount(row.team_id || "")} · ${defenseText(row.team_id || "")}`,
  );
}

function reportSurvivalLines(players) {
  if (!players.length) {
    return ["- 暂无参赛玩家"];
  }
  return players.map((player) => {
    const teamId = player.team_id || "-";
    return `- ${teamId} · ${defenseText(teamId)} · 攻陷 ${captureCount(teamId)}`;
  });
}

function reportKillLeader(players) {
  const leader = captureLeaderStat(teamStats(players));
  return leader ? `${leader.teamId} · 攻陷 ${leader.captures}` : "暂无";
}

function aliveCount(players) {
  return players.filter((player) => breachCount(player.team_id || "-") === 0).length;
}

function syncArenaFocus() {
  const players = state.room?.players || [];
  if (!players.length) {
    state.focusedTeamId = null;
    state.replayIndex = 0;
    return;
  }
  normalizeReplayIndex(captureEvents());
  if (state.focusedTeamId && players.some((player) => player.team_id === state.focusedTeamId)) {
    return;
  }
  state.focusedTeamId = selectedArenaTeamId(players);
}

function selectedArenaTeamId(players) {
  if (state.focusedTeamId && players.some((player) => player.team_id === state.focusedTeamId)) {
    return state.focusedTeamId;
  }
  const replaySubmitter = capturePayload(currentReplay() || {}).submitter_team_id;
  if (replaySubmitter && players.some((player) => player.team_id === replaySubmitter)) {
    return replaySubmitter;
  }
  const leaderTeamId = state.rankings[0]?.team_id;
  if (leaderTeamId && players.some((player) => player.team_id === leaderTeamId)) {
    return leaderTeamId;
  }
  const ownTeamId = state.configs[0]?.team_id;
  if (ownTeamId && players.some((player) => player.team_id === ownTeamId)) {
    return ownTeamId;
  }
  return players[0]?.team_id || null;
}

function bindArenaFocus() {
  for (const button of els.arenaMap.querySelectorAll("[data-team-id]")) {
    button.addEventListener("click", () => {
      state.focusedTeamId = button.dataset.teamId;
      render();
    });
  }
}

function bindArenaReplay() {
  for (const button of els.arenaMap.querySelectorAll("[data-replay-action]")) {
    button.addEventListener("click", () => {
      const captures = captureEvents();
      if (!captures.length) {
        return;
      }
      const action = button.dataset.replayAction;
      if (action === "autoplay") {
        toggleAutoPlay(captures);
        return;
      }
      if (action === "jump") {
        const target = parseInt(button.dataset.replayTarget, 10);
        if (!isNaN(target) && target >= 0 && target < captures.length) {
          stopAutoPlay();
          state.replayIndex = target;
          const payload = capturePayload(captures[target] || {});
          if (payload.submitter_team_id) {
            state.focusedTeamId = payload.submitter_team_id;
          }
        }
        render();
        return;
      }
      stopAutoPlay();
      dispatchReplayAction(action, captures);
      render();
    });
  }
}

function dispatchReplayAction(action, captures) {
  if (action === "prev") {
    state.replayIndex = Math.min(captures.length - 1, state.replayIndex + 1);
  } else if (action === "next") {
    state.replayIndex = Math.max(0, state.replayIndex - 1);
  } else {
    state.replayIndex = 0;
  }
  const payload = capturePayload(captures[state.replayIndex] || {});
  if (payload.submitter_team_id) {
    state.focusedTeamId = payload.submitter_team_id;
  }
}

function toggleAutoPlay(captures) {
  if (state.autoPlayActive) {
    stopAutoPlay();
    render();
    return;
  }
  state.autoPlayActive = true;
  state.replayIndex = captures.length - 1;
  state.focusedTeamId = capturePayload(captures[state.replayIndex] || {}).submitter_team_id || null;
  state.autoPlayTimer = setInterval(() => {
    if (state.replayIndex <= 0) {
      stopAutoPlay();
      render();
      return;
    }
    state.replayIndex -= 1;
    const payload = capturePayload(captures[state.replayIndex] || {});
    if (payload.submitter_team_id) {
      state.focusedTeamId = payload.submitter_team_id;
    }
    render();
  }, 2000);
  render();
}

function stopAutoPlay() {
  if (state.autoPlayTimer) {
    clearInterval(state.autoPlayTimer);
    state.autoPlayTimer = null;
  }
  state.autoPlayActive = false;
}

function arenaFocusPanel(players, focusedTeamId) {
  const focused = players.find((player) => player.team_id === focusedTeamId) || players[0];
  if (!focused) {
    return "";
  }
  const teamId = focused.team_id || "-";
  const model = focused.model_display_name || focused.agent_runtime || "模型未标注";
  const readiness = readinessPercent(focused);
  const score = teamScore(teamId);
  return `<div class="arena-focus" data-focus-team="${escapeHtml(teamId)}">
    <span>战场焦点</span>
    <strong>${escapeHtml(teamId)} · ${escapeHtml(focused.display_name || "-")}</strong>
    <em>${escapeHtml(model)} · ${escapeHtml(score === null ? "暂无分数" : `${score} 分`)} · ${escapeHtml(defenseText(teamId))}</em>
    <small>${escapeHtml(captureCount(teamId))} 攻陷 · ${escapeHtml(breachCount(teamId))} 失守 · 准备度 ${escapeHtml(readiness)}%</small>
    <small>${escapeHtml(lastCombatNote(teamId))}</small>
  </div>`;
}

function lastCombatNote(teamId) {
  const event = captureEvents().find((item) => {
    const payload = capturePayload(item);
    return payload.submitter_team_id === teamId || payload.target_team_id === teamId;
  });
  if (!event) {
    return "暂无交火记录";
  }
  const payload = capturePayload(event);
  if (payload.submitter_team_id === teamId) {
    return `最近攻陷 ${payload.target_team_id || "未知目标"}`;
  }
  return `最近对 ${payload.submitter_team_id || "未知玩家"} 失守`;
}

function arenaReplayPanel(captures) {
  if (!captures.length) {
    return `<div class="arena-replay" data-replay-index="-1">
      <span>战斗回放</span>
      <strong>等待首次攻陷</strong>
      <em>裁判事件同步后可回看攻陷过程</em>
      <div class="replay-actions">
        <button type="button" data-replay-action="prev" disabled>上一攻</button>
        <button type="button" data-replay-action="next" disabled>下一攻</button>
        <button type="button" data-replay-action="latest" disabled>最新</button>
        <button type="button" data-replay-action="autoplay" disabled>▶ 播放</button>
      </div>
    </div>`;
  }
  normalizeReplayIndex(captures);
  const replay = captures[state.replayIndex];
  const payload = capturePayload(replay);
  const submitter = payload.submitter_team_id || "未知玩家";
  const target = payload.target_team_id || "未知目标";
  const delta = payload.score_delta ? `${payload.score_delta > 0 ? "+" : ""}${payload.score_delta} 分` : "攻陷得分";
  return `<div class="arena-replay" data-replay-index="${escapeHtml(state.replayIndex)}">
    <span>战斗回放</span>
    <strong>${escapeHtml(submitter)} 攻陷 ${escapeHtml(target)}</strong>
    <em>${escapeHtml(delta)} · 第 ${escapeHtml(state.replayIndex + 1)}/${escapeHtml(captures.length)} 次攻陷</em>
    <small>选择回放会自动聚焦攻陷方，当前只回放裁判攻陷事件。</small>
    <div class="replay-actions">
      <button type="button" data-replay-action="prev"${state.replayIndex >= captures.length - 1 ? " disabled" : ""}>上一攻</button>
      <button type="button" data-replay-action="next"${state.replayIndex <= 0 ? " disabled" : ""}>下一攻</button>
      <button type="button" data-replay-action="latest"${state.replayIndex === 0 ? " disabled" : ""}>最新</button>
      <button type="button" data-replay-action="autoplay" class="${state.autoPlayActive ? "is-paused" : ""}">${state.autoPlayActive ? "⏸ 暂停" : "▶ 播放"}</button>
    </div>
    ${replayTimeline(captures)}
  </div>`;
}

function replayTimeline(captures) {
  const dots = captures.map((event, index) => {
    const realIndex = captures.length - 1 - index;
    const payload = capturePayload(event);
    const isActive = realIndex === state.replayIndex;
    const isLatest = realIndex === captures.length - 1;
    const label = `${payload.submitter_team_id || "?"}→${payload.target_team_id || "?"}`;
    return `<button type="button"
      class="timeline-dot${isActive ? " is-active" : ""}${isLatest ? " is-latest" : ""}${state.autoPlayActive && isActive ? " is-pulsing" : ""}"
      data-replay-action="jump"
      data-replay-target="${escapeHtml(realIndex)}"
      title="${escapeHtml(label)} · 第${escapeHtml(realIndex + 1)}次攻陷"
      aria-label="跳到第${escapeHtml(realIndex + 1)}次攻陷：${escapeHtml(label)}"></button>`;
  }).join("");

  return `<div class="replay-timeline" role="tablist" aria-label="攻陷时间线">
    <span class="timeline-label">时间线</span>
    <div class="timeline-track">${dots}</div>
  </div>`;
}

function currentReplay() {
  const captures = captureEvents();
  if (!captures.length) {
    return null;
  }
  normalizeReplayIndex(captures);
  return captures[state.replayIndex] || captures[0];
}

function normalizeReplayIndex(captures) {
  if (!captures.length) {
    state.replayIndex = 0;
    return;
  }
  state.replayIndex = Math.min(Math.max(0, state.replayIndex), captures.length - 1);
}

function teamStats(players) {
  return players.map((player, index) => {
    const teamId = player.team_id || `slot_${index + 1}`;
    return {
      teamId,
      name: player.display_name || "",
      model: player.model_display_name || player.agent_runtime || "",
      captures: captureCount(teamId),
      breaches: breachCount(teamId),
      score: teamScore(teamId) ?? Number(player.score || 0),
      targetReady: Boolean(player.target_ready),
      agentReady: Boolean(player.agent_ready),
    };
  });
}

function captureLeaderStat(stats) {
  return stats
    .filter((stat) => stat.captures > 0)
    .sort((a, b) => b.captures - a.captures || b.score - a.score || a.teamId.localeCompare(b.teamId))[0] || null;
}

function highRiskStat(stats) {
  return stats
    .filter((stat) => stat.breaches > 0)
    .sort((a, b) => b.breaches - a.breaches || a.score - b.score || a.teamId.localeCompare(b.teamId))[0] || null;
}

function captureStreak() {
  const captures = captureEvents();
  if (!captures.length) {
    return null;
  }
  const teamId = capturePayload(captures[0]).submitter_team_id;
  if (!teamId) {
    return null;
  }
  let count = 0;
  for (const event of captures) {
    if (capturePayload(event).submitter_team_id !== teamId) {
      break;
    }
    count += 1;
  }
  return { teamId, count };
}

function targetMetaParts(config) {
  const manifest = config.target_manifest || {};
  const name = manifest.name || config.target_template_id || "未标注靶场";
  const difficulty = displayDifficulty(manifest.difficulty || config.difficulty || "");
  const runtime = displayRuntime(manifest.runtime || config.runtime || "");
  const healthPath = manifest.healthcheck?.path || "";
  return [
    name,
    difficulty !== "未标注" ? difficulty : "",
    runtime !== "未标注" ? runtime : "",
    healthPath ? `健康 ${healthPath}` : "",
  ].filter(Boolean);
}

function targetRuntimePlanText(config) {
  const runtime = config.target_runtime || {};
  if (!runtime.project_name) {
    return "";
  }
  const commands = ["install", "start", "stop", "reset"].filter((name) => runtime.commands?.[name]);
  return [
    `计划 ${runtime.project_name}`,
    commands.length ? `命令 ${commands.join("/")}` : "",
    runtime.health_url ? `巡检 ${runtime.health_url}` : "",
  ].filter(Boolean).join(" · ");
}

function targetActionLabel(actionName) {
  return {
    doctor: "诊断",
    install: "安装",
    start: "启动",
    health: "巡检",
    stop: "停止",
    reset: "重置",
  }[actionName] || actionName;
}

function targetActionResultText(result) {
  if (result.message) {
    return result.message;
  }
  if (result.action === "doctor" && Array.isArray(result.checks)) {
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.label || check.name);
    return failed.length ? `本地靶机诊断发现问题：${failed.join("、")}` : "本地靶机诊断通过";
  }
  if (result.action === "health") {
    return result.ok ? "本地靶机健康检查通过" : "本地靶机健康检查未通过";
  }
  return `${targetActionLabel(result.action)}完成`;
}

function combatMetricText(teamId) {
  return `${defenseText(teamId)} · 攻陷 ${captureCount(teamId)}`;
}

function combatantInitials(player, teamId) {
  const source = player.model_display_name || player.display_name || teamId || "AI";
  const compact = String(source).replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "");
  return (compact.slice(0, 2) || "AI").toUpperCase();
}

function readinessPercent(player) {
  let ready = 0;
  if (player.target_ready) ready += 50;
  if (player.agent_ready) ready += 50;
  return ready;
}

function threatLane(event, index, isReplay = false) {
  const submission = capturePayload(event);
  const submitter = submission.submitter_team_id || "未知玩家";
  const target = submission.target_team_id || "未知目标";
  const delta = submission.score_delta ? `${submission.score_delta > 0 ? "+" : ""}${submission.score_delta} 分` : "攻陷得分";
  return `<div class="threat-lane${index === 0 ? " is-latest" : ""}${isReplay ? " is-replay" : ""}">
    <span>${escapeHtml(index === 0 ? "最新攻陷" : `回放 ${index + 1}`)}</span>
    <strong>${escapeHtml(submitter)} → ${escapeHtml(target)}</strong>
    <em>${escapeHtml(delta)}</em>
  </div>`;
}

function captureCount(teamId) {
  if (!teamId) {
    return 0;
  }
  if (state.captureCounts[teamId] !== undefined) {
    return state.captureCounts[teamId];
  }
  return captureEvents().filter((event) => capturePayload(event).submitter_team_id === teamId).length;
}

function breachCount(teamId) {
  if (!teamId) {
    return 0;
  }
  if (state.breachCounts[teamId] !== undefined) {
    return state.breachCounts[teamId];
  }
  return captureEvents().filter((event) => capturePayload(event).target_team_id === teamId).length;
}

function defenseText(teamId) {
  const breaches = breachCount(teamId);
  return breaches ? `失守 ${breaches} 次` : "防线完整";
}

function renderRooms(rooms) {
  els.roomList.innerHTML =
    rooms
      .map(
        (room) =>
          `<button class="room-row" data-room-id="${escapeHtml(room.room_id)}">
            <span>
              <strong>${escapeHtml(room.room_name || room.room_id)}</strong>
              <small>${escapeHtml(roomMeta(room))}</small>
            </span>
            <em>${escapeHtml(displayPhase(room.status))}</em>
          </button>`,
      )
      .join("") || "<p class=\"empty\">暂无房间</p>";

  for (const button of els.roomList.querySelectorAll("[data-room-id]")) {
    button.addEventListener("click", () => {
      els.roomId.value = button.dataset.roomId;
      state.roomId = button.dataset.roomId;
      addEvent("ROOM_SELECTED", { room_id: button.dataset.roomId });
      render();
    });
  }
}

function roomMeta(room) {
  const players = Array.isArray(room.players) ? room.players.length : 0;
  const maxPlayers = room.max_players || "-";
  const spectatorLabel = room.allow_spectators ? "可观战" : "不可观战";
  return `${room.room_id || "-"} · AI攻防大乱斗 · ${players}/${maxPlayers} 玩家 · ${spectatorLabel} · ${room.target_template_id || "未标注靶场"}`;
}

function memberItem(member) {
  const status = member.team_id
    ? ` · ${member.target_ready ? "靶机已好" : "靶机待确认"} · ${member.agent_ready ? "Agent 已好" : "Agent 待确认"}`
    : "";
  const model = member.model_display_name ? ` · 模型 ${member.model_display_name}` : "";
  return `<li><span>${escapeHtml(member.team_id || "-")}${status}${escapeHtml(model)}</span><strong>${escapeHtml(member.display_name)}</strong></li>`;
}

function inferRoleFromRoom(room) {
  if (!room || !state.clientId) {
    return null;
  }
  if ((room.players || []).some((member) => member.client_id === state.clientId)) {
    return "player";
  }
  if ((room.spectators || []).some((member) => member.client_id === state.clientId)) {
    return "spectator";
  }
  return null;
}

function myScoreSummary() {
  if (!state.rankings.length) {
    return "暂无分数";
  }
  const ownTeamId = state.configs[0]?.team_id;
  const ownRank = ownTeamId ? state.rankings.find((row) => row.team_id === ownTeamId) : null;
  if (ownRank) {
    return `${ownRank.score} 分`;
  }
  const leader = state.rankings[0];
  return `${leader.score} 分领先`;
}

function attackHeatSummary() {
  const captures = captureEvents();
  if (!captures.length) {
    return "暂无交火";
  }
  const submission = capturePayload(captures[0]);
  const route =
    submission.submitter_team_id && submission.target_team_id
      ? `${submission.submitter_team_id}→${submission.target_team_id}`
      : "攻陷得分";
  return `${captures.length} 次攻陷 · ${route}`;
}

function captureEvents() {
  return state.events.filter((event) => event.type === "FLAG_CAPTURED");
}

function capturePayload(event) {
  return event.payload?.submission || event.payload || {};
}

function captureRoute(event) {
  const submission = capturePayload(event);
  const submitter = submission.submitter_team_id || "未知玩家";
  const target = submission.target_team_id || "未知目标";
  const delta = submission.score_delta ? ` +${submission.score_delta} 分` : "";
  return `${submitter} 攻陷 ${target}${delta}`;
}

function teamScore(teamId) {
  const row = state.rankings.find((ranking) => ranking.team_id === teamId);
  return row ? Number(row.score || 0) : null;
}

function rankingMeta(row, index) {
  const name = row.display_name || "";
  const ownTeamId = state.configs[0]?.team_id;
  const ownLabel = ownTeamId && row.team_id === ownTeamId ? "我方" : "";
  const leader = state.rankings[0];
  const labels = [name, ownLabel].filter(Boolean);
  if (index === 0) {
    labels.push("领先");
  } else if (leader) {
    const gap = Number(leader.score || 0) - Number(row.score || 0);
    labels.push(`落后 ${gap} 分`);
  }
  return labels.join(" · ") || "等待分数变化";
}

function phaseTimerSummary() {
  const phaseEndsAt = state.match?.phase_ends_at;
  if (!phaseEndsAt) {
    return "等待同步";
  }
  const secondsLeft = Math.max(0, Math.ceil(phaseEndsAt - Date.now() / 1000));
  if (secondsLeft <= 0) {
    return "等待切换";
  }
  return `${formatDuration(secondsLeft)} 后切换`;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds} 秒`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "aiawd";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function redactMatchConfig(config) {
  return { ...config, flag: config.flag ? "FLAG{已隐藏}" : undefined };
}

function unavailableBridge() {
  return {
    connect: async () => {
      throw new Error("Electron 预加载桥不可用");
    },
    disconnect: async () => ({ connected: false }),
    listTargets: async () => {},
    listRooms: async () => {},
    createRoom: async () => {},
    joinRoom: async () => {},
    startMatch: async () => {},
    markTargetReady: async () => {},
    markAgentReady: async () => {},
    submitFlag: async () => {},
    runTargetAction: async () => ({ ok: false, message: "Electron 主进程不可用" }),
    snapshot: async () => ({ connected: false }),
    onMessage: () => () => {},
    onStatus: () => () => {},
  };
}

function displayPhase(phase) {
  const phases = {
    LOBBY: "大厅",
    PREPARE: "准备",
    DEFENSE: "加固",
    ATTACK: "攻防",
    FINISHED: "结束",
  };
  return phases[phase] || phase;
}

function displayRole(role) {
  const roles = {
    player: "参赛玩家",
    spectator: "观战席",
  };
  return roles[role] || "未加入";
}

function displayDifficulty(difficulty) {
  const labels = {
    beginner: "入门",
    easy: "入门",
    medium: "中等",
    hard: "进阶",
    professional: "进阶",
  };
  return labels[difficulty] || difficulty || "未标注";
}

function displayRuntime(runtime) {
  const labels = {
    "docker-compose": "本地 Docker Compose",
    docker: "本地 Docker",
  };
  return labels[runtime] || runtime || "未标注";
}

function eventSummary(event) {
  const payload = event.payload || {};
  const submission = payload.submission || payload;
  if (submission.submitter_team_id || submission.target_team_id || submission.score_delta) {
    const submitter = submission.submitter_team_id || "未知玩家";
    const target = submission.target_team_id ? ` 攻陷 ${submission.target_team_id}` : "";
    const delta = submission.score_delta ? ` ${submission.score_delta > 0 ? "+" : ""}${submission.score_delta} 分` : "";
    const code = submission.code && submission.code !== "OK" ? ` · ${displaySubmissionCode(submission.code)}` : "";
    return `${submitter}${target}${delta}${code}`;
  }
  return payload.message || payload.team_id || payload.room_id || payload.match_id || "";
}

function displaySubmissionCode(code) {
  const codes = {
    INVALID_ROLE: "身份不允许",
    INVALID_PHASE: "阶段不允许",
    INVALID_FLAG: "无效 Flag",
    SELF_FLAG: "本人 Flag",
    DUPLICATE_FLAG: "重复提交",
  };
  return codes[code] || code;
}

function eventTone(event) {
  if (event.type === "FLAG_CAPTURED") {
    return "good";
  }
  if (event.type === "FLAG_REJECTED" || event.type === "ERROR" || event.type === "SEND_FAILED" || event.type === "TARGET_ACTION_FAILED") {
    return "bad";
  }
  if (event.type === "TARGET_ACTION_DONE") {
    return "good";
  }
  if (event.type === "SUBMIT_SKIPPED" || event.type === "JOIN_SKIPPED" || event.type === "SEND_SKIPPED" || event.type === "TARGET_ACTION_SKIPPED") {
    return "warn";
  }
  return "neutral";
}

function displayEventType(type) {
  const events = {
    CLIENT_CONNECTED: "客户端已连接",
    CLIENT_DISCONNECTED: "客户端已断开",
    CONNECT_FAILED: "连接失败",
    JOIN_SKIPPED: "未加入",
    SUBMIT_SKIPPED: "未提交",
    SEND_SKIPPED: "未发送",
    SEND_FAILED: "发送失败",
    ROOM_SELECTED: "已选择房间",
    REPORT_GENERATED: "战报已生成",
    REPORT_COPIED: "战报已复制",
    REPORT_DOWNLOADED: "战报已下载",
    REPORT_COPY_UNAVAILABLE: "复制不可用",
    REPORT_DOWNLOAD_UNAVAILABLE: "下载不可用",
    TARGET_ACTION_SKIPPED: "靶机未执行",
    TARGET_ACTION_DONE: "本地靶机",
    TARGET_ACTION_FAILED: "靶机失败",
    FLAG_CAPTURED: "攻陷得分",
    FLAG_REJECTED: "Flag 拒绝",
    ERROR: "错误",
    EVENT: "事件",
  };
  return events[type] || type;
}
