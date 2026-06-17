const test = require("node:test");
const assert = require("node:assert/strict");

const { FrameDecoder, ProtocolError, encodeMessage } = require("./aiawdProtocol");

test("encodes and decodes one AIAWD frame", () => {
  const frame = encodeMessage({ v: 1, seq: 1, type: "PING", payload: { ok: true } });
  assert.equal(frame.readUInt32BE(0), frame.length - 4);

  const messages = new FrameDecoder().feed(frame);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "PING");
  assert.deepEqual(messages[0].payload, { ok: true });
});

test("decodes sticky packets", () => {
  const decoder = new FrameDecoder();
  const chunk = Buffer.concat([
    encodeMessage({ v: 1, seq: 1, type: "PING", payload: {} }),
    encodeMessage({ v: 1, seq: 2, type: "PONG", payload: {} }),
  ]);

  assert.deepEqual(
    decoder.feed(chunk).map((message) => message.type),
    ["PING", "PONG"],
  );
});

test("buffers partial packets", () => {
  const decoder = new FrameDecoder();
  const frame = encodeMessage({ v: 1, seq: 1, type: "PING", payload: { x: 1 } });

  assert.deepEqual(decoder.feed(frame.subarray(0, 2)), []);
  assert.deepEqual(decoder.feed(frame.subarray(2, 6)), []);
  assert.deepEqual(decoder.feed(frame.subarray(6)).map((message) => message.payload), [{ x: 1 }]);
});

test("rejects oversized frames", () => {
  const decoder = new FrameDecoder(4);
  const frame = Buffer.alloc(9);
  frame.writeUInt32BE(5, 0);

  assert.throws(() => decoder.feed(frame), ProtocolError);
});
