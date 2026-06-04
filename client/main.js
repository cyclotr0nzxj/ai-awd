const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { AiawdClient } = require("./aiawdProtocol");
const { runTargetAction } = require("./targetLifecycle");

let mainWindow = null;
const client = new AiawdClient();

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    title: "AI-AWD Arena 控制台",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.loadFile(path.join(__dirname, "index.html"));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

client.on("message", (message) => sendToRenderer("aiawd:message", message));
client.on("disconnect", () => sendToRenderer("aiawd:status", client.snapshot()));
client.on("error", (error) => sendToRenderer("aiawd:status", { ...client.snapshot(), error: error.message }));

ipcMain.handle("aiawd:connect", (_event, config) => client.connect(config));
ipcMain.handle("aiawd:disconnect", () => {
  client.disconnect();
  return client.snapshot();
});
ipcMain.handle("aiawd:snapshot", () => client.snapshot());
ipcMain.handle("aiawd:listTargets", () => client.send("LIST_TARGETS_REQ"));
ipcMain.handle("aiawd:listRooms", () => client.send("LIST_ROOMS_REQ"));
ipcMain.handle("aiawd:createRoom", (_event, room) =>
  client.send("CREATE_ROOM_REQ", {
    room_name: room.roomName,
    max_players: room.maxPlayers,
    target_template_id: room.targetTemplateId,
    display_name: room.displayName,
    agent_runtime: room.agentRuntime || "mock-agent",
    model_display_name: room.modelDisplayName || "mock-model",
    allow_spectators: room.allowSpectators,
    phase_seconds: room.phaseSeconds,
  }),
);
ipcMain.handle("aiawd:joinRoom", (_event, request) =>
  client.send(
    "JOIN_ROOM_REQ",
    {
      display_name: request.displayName,
      role: request.role,
      agent_runtime: request.agentRuntime || "mock-agent",
      model_display_name: request.modelDisplayName || "mock-model",
    },
    { roomId: request.roomId, role: request.role },
  ),
);
ipcMain.handle("aiawd:startMatch", (_event, request) =>
  client.send("START_MATCH_REQ", {}, { roomId: request.roomId, role: "player" }),
);
ipcMain.handle("aiawd:markTargetReady", (_event, request) =>
  client.send("TARGET_READY", {}, { roomId: request.roomId, role: "player" }),
);
ipcMain.handle("aiawd:markAgentReady", (_event, request) =>
  client.send("AGENT_READY", {}, { roomId: request.roomId, role: "player" }),
);
ipcMain.handle("aiawd:submitFlag", (_event, request) =>
  client.send(
    "SUBMIT_FLAG_REQ",
    {
      match_id: request.matchId,
      claimed_target_team_id: request.claimedTargetTeamId,
      flag: request.flag,
      source: "electron-ui",
    },
    { roomId: request.roomId, role: "player" },
  ),
);
ipcMain.handle("aiawd:targetAction", (_event, request) => runTargetAction(request));

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
