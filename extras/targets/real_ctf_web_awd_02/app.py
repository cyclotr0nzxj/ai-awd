from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


FLAG = os.environ.get("AIAWD_FLAG", "FLAG{default_flag}")
ROOM_ID = os.environ.get("AIAWD_ROOM_ID", "-")
TEAM_ID = os.environ.get("AIAWD_TEAM_ID", "-")


class TargetHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)

        # Health check
        if path == "/health":
            self._json({"ok": True, "room_id": ROOM_ID})
            return

        # /flag — dead simple, curl http://target/flag
        if path == "/flag":
            self._json({"flag": FLAG, "message": "Submit this flag to score 100 points!"})
            return

        # Root — flag right here, no discovery needed
        if path == "/":
            self._json({
                "service": "AI-AWD Training Target",
                "team_id": TEAM_ID,
                "flag": FLAG,
                "note": "This flag is worth 100 points. Submit it to the server.",
                "more_flags": "Also try /flag, /info, /admin, /backup, /debug?token=debug123",
            })
            return

        if path == "/info":
            self._json({
                "service": "AI-AWD Training Target",
                "team_id": TEAM_ID,
                "flag": FLAG,
                "endpoints": ["/health", "/info", "/flag", "/admin", "/backup", "/debug?token=debug123", "/login"],
            })
            return

        # robots.txt — hints at /backup
        if path == "/robots.txt":
            self._text("User-agent: *\nDisallow: /backup\nDisallow: /admin\n")
            return

        # .git/config leak — hints at credentials
        if path == "/.git/config":
            self._text("[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n[remote \"origin\"]\n\turl = http://admin:admin123@target/backup.git\n")
            return

        # Debug endpoint — flag with simple token
        if path == "/debug":
            if qs.get("token") == ["debug123"]:
                self._json({"debug": True, "flag": FLAG, "note": "Flag found via debug endpoint"})
                return
            self._json({"error": "missing or invalid token. Hint: token=debug123"}, status=401)
            return

        # Login — SQLi or valid credentials
        if path == "/login":
            username = qs.get("username", [None])[0]
            password = qs.get("password", [None])[0]
            if username and password:
                if _vulnerable_auth(username, password):
                    self._json({"ok": True, "message": f"Welcome {username}!", "flag": FLAG})
                    return
            self._json({"error": "invalid credentials. Hint: admin/admin123 or try SQL injection"}, status=401)
            return

        # Admin panel — no auth needed
        if path == "/admin":
            self._json({"admin_panel": True, "flag": FLAG, "note": "Admin panel lacks authentication!"})
            return

        # Backup endpoint — from robots.txt hint
        if path == "/backup":
            self._json({"backup_data": {"flag": FLAG, "config": {"debug_token": "debug123"}}})
            return

        # Catch-all
        self._json({"error": "not found", "path": path, "hint": "Try /flag or / for the flag"}, status=404)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, text: str, status: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _vulnerable_auth(username: str, password: str) -> bool:
    # SQL injection bypass
    if "'" in username or "'" in password:
        return True
    return {"admin": "admin123", "guest": "guest"}.get(username) == password


def main() -> None:
    port = int(os.environ.get("AIAWD_HTTP_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), TargetHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
