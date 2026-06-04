import unittest

from aiawd_server.match_engine import MatchEngine
from aiawd_server.models import Phase, Role, Session
from aiawd_server.room_manager import RoomManager


def _room_with_two_players():
    room_manager = RoomManager()
    owner = Session(client_id="client_a")
    room = room_manager.create_room(owner, {"max_players": 2})
    player_b = Session(client_id="client_b")
    room_manager.join_room(player_b, room.room_id, Role.PLAYER, {})
    return room, room.members["client_a"], room.members["client_b"]


def _room_with_three_players():
    room_manager = RoomManager()
    owner = Session(client_id="client_a")
    room = room_manager.create_room(owner, {"max_players": 3})
    room_manager.join_room(Session(client_id="client_b"), room.room_id, Role.PLAYER, {})
    room_manager.join_room(Session(client_id="client_c"), room.room_id, Role.PLAYER, {})
    return room, room.members["client_a"], room.members["client_b"], room.members["client_c"]


class MatchEngineTest(unittest.TestCase):
    def test_start_match_generates_private_configs_and_flags(self) -> None:
        room, member_a, member_b = _room_with_two_players()
        engine = MatchEngine()

        match, configs = engine.start_match(room, member_a.client_id)

        self.assertEqual(match.phase, Phase.PREPARE)
        self.assertEqual(configs[member_a.client_id]["team_id"], "team_a")
        self.assertEqual(configs[member_b.client_id]["team_id"], "team_b")
        self.assertNotEqual(configs[member_a.client_id]["flag"], configs[member_b.client_id]["flag"])
        self.assertEqual(
            configs[member_a.client_id]["opponents"],
            [{"team_id": "team_b", "base_url": "http://127.0.0.1:18082"}],
        )

    def test_start_match_builds_free_for_all_opponent_targets(self) -> None:
        room, member_a, member_b, member_c = _room_with_three_players()
        engine = MatchEngine()

        _, configs = engine.start_match(room, member_a.client_id)

        self.assertEqual(
            {opponent["team_id"] for opponent in configs[member_a.client_id]["opponents"]},
            {"team_b", "team_c"},
        )
        self.assertEqual(
            {opponent["team_id"] for opponent in configs[member_b.client_id]["opponents"]},
            {"team_a", "team_c"},
        )
        self.assertEqual(len(configs[member_c.client_id]["allowed_targets"]), 3)

    def test_submit_flag_scores_once_and_rejects_self_or_duplicate(self) -> None:
        room, member_a, member_b = _room_with_two_players()
        engine = MatchEngine()
        _, configs = engine.start_match(room, member_a.client_id)
        engine.set_phase(room, Phase.ATTACK)

        valid = engine.submit_flag(room, member_a, {"flag": configs[member_b.client_id]["flag"]})
        duplicate = engine.submit_flag(room, member_a, {"flag": configs[member_b.client_id]["flag"]})
        self_flag = engine.submit_flag(room, member_a, {"flag": configs[member_a.client_id]["flag"]})
        invalid = engine.submit_flag(room, member_a, {"flag": "FLAG{missing}"})

        self.assertTrue(valid.valid)
        self.assertEqual(valid.code, "OK")
        self.assertEqual(member_a.score, 100)
        self.assertEqual(member_b.score, -50)
        self.assertEqual(duplicate.code, "DUPLICATE_FLAG")
        self.assertEqual(self_flag.code, "SELF_FLAG")
        self.assertEqual(invalid.code, "INVALID_FLAG")

    def test_submit_flag_rejects_spectator(self) -> None:
        room_manager = RoomManager()
        owner = Session(client_id="client_a")
        room = room_manager.create_room(owner, {"max_players": 2})
        player_b = Session(client_id="client_b")
        room_manager.join_room(player_b, room.room_id, Role.PLAYER, {})
        spectator_session = Session(client_id="client_c")
        spectator = room_manager.join_room(spectator_session, room.room_id, Role.SPECTATOR, {})
        member_a = room.members["client_a"]
        member_b = room.members["client_b"]
        engine = MatchEngine()
        _, configs = engine.start_match(room, member_a.client_id)
        engine.set_phase(room, Phase.ATTACK)

        result = engine.submit_flag(room, spectator, {"flag": configs[member_b.client_id]["flag"]})

        self.assertFalse(result.valid)
        self.assertEqual(result.code, "INVALID_ROLE")


if __name__ == "__main__":
    unittest.main()
