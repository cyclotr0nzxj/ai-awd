const net = require("node:net");
const { EventEmitter } = require("node:events");

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1024 * 1024;
const HEADER_BYTES = 4;

class ProtocolError extends Error {}

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_FRAME_BYTES) {
    throw new ProtocolError("Message exceeds maximum frame size");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

class FrameDecoder {
  constructor(maxFrameBytes = MAX_FRAME_BYTES) {
    this.maxFrameBytes = maxFrameBytes;
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];

    while (this.buffer.length >= HEADER_BYTES) {
      const frameLength = this.buffer.readUInt32BE(0);
      if (frameLength <= 0) {
        throw new ProtocolError("Frame length must be positive");
      }
      if (frameLength > this.maxFrameBytes) {
        throw new ProtocolError("Frame exceeds maximum size");
      }
      if (this.buffer.length < HEADER_BYTES + frameLength) {
        break;
      }

      const body = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + frameLength);
      this.buffer = this.buffer.subarray(HEADER_BYTES + frameLength);
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch (error) {
        throw new ProtocolError(`Invalid JSON body: ${error.message}`);
      }
      messages.push(parsed);
    }

    return messages;
  }
}

class AiawdClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.decoder = new FrameDecoder();
    this.seq = 1;
    this.clientId = null;
    this.connected = false;
  }

  connect({ host, port, displayName }) {
    if (this.socket) {
      this.disconnect();
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port: Number(port) });
      let settled = false;

      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      socket.on("connect", () => {
        this.socket = socket;
        this.connected = true;
        this.send("HELLO", {
          display_name: displayName || "Electron 客户端",
          platform: process.platform,
          capabilities: ["player", "spectator"],
        }).catch(fail);
      });

      socket.on("data", (chunk) => {
        try {
          for (const message of this.decoder.feed(chunk)) {
            if (message.type === "WELCOME") {
              this.clientId = message.payload?.client_id || message.client_id;
              if (!settled) {
                settled = true;
                resolve(this.snapshot());
              }
            }
            this.emit("message", message);
          }
        } catch (error) {
          this.emit("error", error);
          fail(error);
        }
      });

      socket.on("error", (error) => {
        this.emit("error", error);
        fail(error);
      });

      socket.on("close", () => {
        this.connected = false;
        this.socket = null;
        this.emit("disconnect");
      });
    });
  }

  async send(type, payload = {}, options = {}) {
    if (!this.socket || !this.connected) {
      throw new ProtocolError("Client is not connected");
    }
    const message = {
      v: PROTOCOL_VERSION,
      seq: this.seq++,
      type,
      client_id: this.clientId,
      room_id: options.roomId,
      role: options.role,
      ts: Date.now() / 1000,
      payload,
    };
    this.socket.write(encodeMessage(dropUndefined(message)));
    return message;
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.clientId = null;
    this.decoder = new FrameDecoder();
  }

  snapshot() {
    return {
      clientId: this.clientId,
      connected: this.connected,
    };
  }
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

module.exports = {
  AiawdClient,
  FrameDecoder,
  ProtocolError,
  encodeMessage,
};
