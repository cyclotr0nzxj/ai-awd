import unittest

from aiawd_server.models import Role, Session
from aiawd_server.room_manager import RoomError, RoomManager


class RoomManagerTest(unittest.TestCase):
    def test_create_room_joins_owner_as_player(self) -> None:
        manager = RoomManager()
        owner = Session(client_id="client_a", display_name="Alice")

        room = manager.create_room(
            owner,
            {
                "room_name": "Demo",
                "max_players": 2,
                "target_template_id": "real_ctf_web_awd_01",
                "agent_runtime": "tui-agent",
                "model_display_name": "model-alpha",
            },
        )

        self.assertEqual(room.room_name, "Demo")
        self.assertEqual(room.owner_client_id, "client_a")
        self.assertEqual(room.players()[0].team_id, "team_a")
        self.assertEqual(room.players()[0].agent_runtime, "tui-agent")
        self.assertEqual(room.players()[0].model_display_name, "model-alpha")
        self.assertEqual(owner.room_id, room.room_id)
        self.assertEqual(owner.role, Role.PLAYER)

    def test_join_room_allows_second_player_and_spectator(self) -> None:
        manager = RoomManager()
        owner = Session(client_id="client_a", display_name="Alice")
        room = manager.create_room(owner, {"max_players": 2})
        player = Session(client_id="client_b", display_name="Bob")
        spectator = Session(client_id="client_c", display_name="Carol")

        player_member = manager.join_room(player, room.room_id, Role.PLAYER, {})
        spectator_member = manager.join_room(spectator, room.room_id, Role.SPECTATOR, {})

        self.assertEqual(player_member.team_id, "team_b")
        self.assertIsNone(spectator_member.team_id)
        self.assertEqual(len(room.players()), 2)
        self.assertEqual(len(room.spectators()), 1)

    def test_room_capacity_rejects_extra_player(self) -> None:
        manager = RoomManager()
        owner = Session(client_id="client_a")
        room = manager.create_room(owner, {"max_players": 1})

        with self.assertRaises(RoomError) as exc:
            manager.join_room(Session(client_id="client_b"), room.room_id, Role.PLAYER, {})

        self.assertEqual(exc.exception.code, "ROOM_FULL")

    def test_spectator_rejected_when_room_disallows_spectators(self) -> None:
        manager = RoomManager()
        owner = Session(client_id="client_a")
        room = manager.create_room(owner, {"allow_spectators": False})

        with self.assertRaises(RoomError) as exc:
            manager.join_room(Session(client_id="client_c"), room.room_id, Role.SPECTATOR, {})

        self.assertEqual(exc.exception.code, "INVALID_ROLE")


if __name__ == "__main__":
    unittest.main()
