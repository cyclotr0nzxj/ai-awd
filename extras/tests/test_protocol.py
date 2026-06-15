import json
import struct
import unittest

from aiawd_server.protocol import FrameDecoder, Message, ProtocolError, decode_body, encode_message


class ProtocolTest(unittest.TestCase):
    def test_encode_decode_message_round_trip(self) -> None:
        frame = encode_message(Message(type="PING", seq=1, payload={"hello": "world"}))

        self.assertEqual(struct.unpack(">I", frame[:4])[0], len(frame) - 4)
        messages = FrameDecoder().feed(frame)

        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].type, "PING")
        self.assertEqual(messages[0].seq, 1)
        self.assertEqual(messages[0].payload, {"hello": "world"})

    def test_decoder_handles_sticky_packets(self) -> None:
        first = encode_message({"v": 1, "seq": 1, "type": "PING", "payload": {}})
        second = encode_message({"v": 1, "seq": 2, "type": "PONG", "payload": {}})

        messages = FrameDecoder().feed(first + second)

        self.assertEqual([message.type for message in messages], ["PING", "PONG"])

    def test_decoder_buffers_partial_packets(self) -> None:
        frame = encode_message({"v": 1, "seq": 1, "type": "PING", "payload": {"x": 1}})
        decoder = FrameDecoder()

        self.assertEqual(decoder.feed(frame[:3]), [])
        self.assertEqual(decoder.feed(frame[3:8]), [])
        messages = decoder.feed(frame[8:])

        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].payload, {"x": 1})

    def test_decode_rejects_invalid_json(self) -> None:
        with self.assertRaises(ProtocolError):
            decode_body(b"{not json")

    def test_decode_rejects_non_object_payload(self) -> None:
        body = json.dumps({"v": 1, "type": "PING", "payload": []}).encode("utf-8")

        with self.assertRaises(ProtocolError):
            decode_body(body)

    def test_decoder_rejects_oversized_frame(self) -> None:
        decoder = FrameDecoder(max_frame_bytes=8)
        frame = struct.pack(">I", 9) + b"x" * 9

        with self.assertRaises(ProtocolError):
            decoder.feed(frame)


if __name__ == "__main__":
    unittest.main()
