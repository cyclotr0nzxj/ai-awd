from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class TargetHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self._json({"ok": True, "room_id": os.environ.get("AIAWD_ROOM_ID", "-")})
            return
        self._json(
            {
                "service": "AI-AWD demo target",
                "team_id": os.environ.get("AIAWD_TEAM_ID", "-"),
                "flag": "hidden",
            }
        )

    def log_message(self, format: str, *args: object) -> None:
        return

    def _json(self, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 8080), TargetHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
