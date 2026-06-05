from __future__ import annotations

import json
import struct
import tempfile
import unittest
from pathlib import Path

from tui.pcap_collector import (
    LINKTYPE_RAW,
    PCAP_MAGIC,
    PCAP_GLOBAL_HEADER,
    CaptureSession,
    PacketRecord,
    PcapCollector,
    _build_synthetic_packet,
    _pcap_global_header,
    capture_session,
)


class PacketRecordTest(unittest.TestCase):
    def test_redacted_path_hides_flag_in_url(self):
        record = PacketRecord(
            timestamp=1000.0, src_host="127.0.0.1", src_port=12345,
            dst_host="127.0.0.1", dst_port=18081, protocol="TCP",
            method="GET", path="/submit?flag=FLAG{secret}", status=200,
            request_bytes=128, response_bytes=64, duration_ms=5.0,
        )
        self.assertNotIn("/submit?flag=", record.redacted_path())
        self.assertIn("redacted", record.redacted_path())

    def test_summary_includes_all_fields(self):
        record = PacketRecord(
            timestamp=1000.0, src_host="127.0.0.1", src_port=12345,
            dst_host="127.0.0.1", dst_port=18081, protocol="TCP",
            method="POST", path="/api", status=201,
            request_bytes=256, response_bytes=128, duration_ms=12.5,
        )
        summary = record.summary()
        self.assertEqual(summary["method"], "POST")
        self.assertEqual(summary["status"], 201)
        self.assertEqual(summary["req_bytes"], 256)
        self.assertEqual(summary["proto"], "TCP")


class CaptureSessionTest(unittest.TestCase):
    def test_add_record_only_when_target_allowed(self):
        session = CaptureSession(
            session_id="s1", room_id="r1", team_id="t1",
            match_id="m1", allowed_targets=["http://127.0.0.1:18081"],
        )
        allowed = PacketRecord(
            timestamp=1.0, src_host="127.0.0.1", src_port=0,
            dst_host="127.0.0.1", dst_port=18081, protocol="TCP",
            method="GET", path="/", status=200,
            request_bytes=100, response_bytes=200, duration_ms=1.0,
        )
        blocked = PacketRecord(
            timestamp=2.0, src_host="127.0.0.1", src_port=0,
            dst_host="10.0.0.1", dst_port=8080, protocol="TCP",
            method="GET", path="/", status=200,
            request_bytes=100, response_bytes=200, duration_ms=1.0,
        )
        session.add(allowed)
        session.add(blocked)
        self.assertEqual(len(session.packets), 1)
        self.assertEqual(session.packets[0].dst_port, 18081)

    def test_total_bytes_sums_request_and_response(self):
        session = CaptureSession(
            session_id="s2", room_id="r1", team_id="t1",
            match_id="m1", allowed_targets=["http://127.0.0.1:18081"],
        )
        record = PacketRecord(
            timestamp=1.0, src_host="127.0.0.1", src_port=0,
            dst_host="127.0.0.1", dst_port=18081, protocol="TCP",
            method="GET", path="/", status=200,
            request_bytes=150, response_bytes=350, duration_ms=1.0,
        )
        session.add(record)
        self.assertEqual(session.total_bytes, 500)


class PcapCollectorTest(unittest.TestCase):
    def setUp(self):
        self.collector = PcapCollector(
            room_id="room_001", team_id="team_a", match_id="match_001",
            allowed_targets=["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
        )

    def test_ignores_records_when_inactive(self):
        record = self.collector.record_http(url="http://127.0.0.1:18081/health")
        self.assertIsNone(record)
        self.assertEqual(len(self.collector.session.packets), 0)

    def test_records_http_traffic_when_active(self):
        self.collector.start()
        record = self.collector.record_http(
            method="POST", url="http://127.0.0.1:18081/exploit",
            status=200, request_bytes=512, response_bytes=1024, duration_ms=25.0,
        )
        self.collector.stop()
        self.assertIsNotNone(record)
        self.assertEqual(len(self.collector.session.packets), 1)
        self.assertEqual(record.method, "POST")

    def test_records_tcp_traffic_when_active(self):
        self.collector.start()
        record = self.collector.record_tcp(
            host="127.0.0.1", port=31337, sent_bytes=64, recv_bytes=256, duration_ms=10.0,
        )
        self.collector.stop()
        self.assertIsNotNone(record)
        self.assertEqual(record.protocol, "TCP")
        self.assertEqual(record.dst_port, 31337)

    def test_filters_out_of_scope_targets(self):
        self.collector.start()
        self.collector.record_http(url="http://10.0.0.1:8080/admin")
        self.collector.stop()
        self.assertEqual(len(self.collector.session.packets), 0)

    def test_write_json_creates_valid_evidence(self):
        self.collector.start()
        self.collector.record_http(url="http://127.0.0.1:18081/health", status=200)
        self.collector.stop()
        with tempfile.TemporaryDirectory() as d:
            path = self.collector.write_json(Path(d) / "test.json")
            data = json.loads(path.read_text())
            self.assertEqual(data["room_id"], "room_001")
            self.assertEqual(data["packet_count"], 1)
            self.assertEqual(data["packets"][0]["status"], 200)

    def test_write_pcap_creates_valid_pcap_file(self):
        self.collector.start()
        self.collector.record_http(url="http://127.0.0.1:18081/health", status=200)
        self.collector.stop()
        with tempfile.TemporaryDirectory() as d:
            path = self.collector.write_pcap(Path(d) / "test.pcap")
            data = path.read_bytes()
            self.assertGreater(len(data), 24)
            magic, ver_major, ver_minor = struct.unpack_from("<IHH", data)
            self.assertEqual(magic, PCAP_MAGIC)
            self.assertEqual(ver_major, 2)
            self.assertEqual(ver_minor, 4)

    def test_write_evidence_produces_both_formats(self):
        self.collector.start()
        self.collector.record_http(url="http://127.0.0.1:18081/health", status=200)
        self.collector.stop()
        with tempfile.TemporaryDirectory() as d:
            paths = self.collector.write_evidence(Path(d))
            self.assertTrue(paths["json"].exists())
            self.assertTrue(paths["pcap"].exists())

    def test_capture_session_context_manager(self):
        with capture_session(
            room_id="r1", team_id="t1", match_id="m1",
            allowed_targets=["http://127.0.0.1:18081"],
        ) as col:
            self.assertTrue(col.active)
            col.record_http(url="http://127.0.0.1:18081/health")
        self.assertFalse(col.active)
        self.assertEqual(len(col.session.packets), 1)


class PcapBinaryFormatTest(unittest.TestCase):
    def test_global_header_structure(self):
        header = _pcap_global_header(65535)
        magic, maj, min_, _, _, snaplen, linktype = PCAP_GLOBAL_HEADER.unpack(header)
        self.assertEqual(magic, PCAP_MAGIC)
        self.assertEqual(maj, 2)
        self.assertEqual(min_, 4)
        self.assertEqual(snaplen, 65535)
        self.assertEqual(linktype, LINKTYPE_RAW)

    def test_synthetic_packet_redacts_flag_paths(self):
        record = PacketRecord(
            timestamp=1.0, src_host="127.0.0.1", src_port=0,
            dst_host="127.0.0.1", dst_port=18081, protocol="TCP",
            method="GET", path="/submit?flag=FLAG{abc_123}", status=200,
            request_bytes=10, response_bytes=100, duration_ms=1.0,
        )
        payload = _build_synthetic_packet(record)
        self.assertNotIn(b"/submit", payload)
        self.assertIn(b"redacted_flag_path", payload)


if __name__ == "__main__":
    unittest.main()
