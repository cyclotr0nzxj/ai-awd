from __future__ import annotations

import time
import unittest

from aiawd_server.models import Session
from aiawd_server.session_manager import SessionManager


class SessionManagerTest(unittest.TestCase):
    def setUp(self):
        self.manager = SessionManager()

    def test_create_session_auto_assigns_client_id(self):
        session = self.manager.create_session({"display_name": "Alice"})
        self.assertTrue(session.client_id.startswith("client_"))
        self.assertEqual(session.display_name, "Alice")
        self.assertIn(session.client_id, self.manager.sessions)

    def test_get_session_by_id(self):
        session = self.manager.create_session({"display_name": "Bob"})
        found = self.manager.get(session.client_id)
        self.assertIsNotNone(found)
        self.assertEqual(found.client_id, session.client_id)

    def test_get_nonexistent_returns_none(self):
        self.assertIsNone(self.manager.get("nobody"))

    def test_touch_updates_last_seen_at(self):
        session = self.manager.create_session({"display_name": "Alice"})
        original = session.last_seen_at
        time.sleep(0.01)
        self.manager.touch(session.client_id)
        self.assertGreater(session.last_seen_at, original)

    def test_cleanup_stale_removes_old_sessions(self):
        # Create a session and set its last_seen_at far in the past
        session = self.manager.create_session({"display_name": "Stale"})
        session.last_seen_at = time.time() - 7200  # 2 hours ago
        removed = self.manager.cleanup_stale(max_age_sec=3600)
        self.assertIn(session.client_id, removed)
        self.assertNotIn(session.client_id, self.manager.sessions)

    def test_cleanup_stale_keeps_fresh_sessions(self):
        session = self.manager.create_session({"display_name": "Fresh"})
        # last_seen_at is already set to current time by default
        removed = self.manager.cleanup_stale(max_age_sec=3600)
        self.assertNotIn(session.client_id, removed)
        self.assertIn(session.client_id, self.manager.sessions)

    def test_cleanup_stale_with_custom_max_age(self):
        session = self.manager.create_session({"display_name": "Mid"})
        session.last_seen_at = time.time() - 60  # 1 minute ago
        # With max_age=30s, this should be stale
        removed = self.manager.cleanup_stale(max_age_sec=30)
        self.assertIn(session.client_id, removed)

    def test_cleanup_stale_returns_empty_when_none_stale(self):
        self.manager.create_session({"display_name": "Alice"})
        self.manager.create_session({"display_name": "Bob"})
        removed = self.manager.cleanup_stale(max_age_sec=3600)
        self.assertEqual(removed, [])

    def test_cleanup_stale_handles_empty_sessions(self):
        removed = self.manager.cleanup_stale(max_age_sec=3600)
        self.assertEqual(removed, [])
