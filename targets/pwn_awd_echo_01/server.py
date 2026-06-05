"""PWN echo server — a minimal binary-exploitation style target.

The flag is injected via the AIAWD_FLAG environment variable and
returned when a client sends the correct overflow-like payload format.
"""

import os
import socket
import sys


FLAG = os.environ.get("AIAWD_FLAG", "FLAG{placeholder}")
ROOM_ID = os.environ.get("AIAWD_ROOM_ID", "unknown")
TEAM_ID = os.environ.get("AIAWD_TEAM_ID", "unknown")
PORT = int(os.environ.get("AIAWD_HTTP_PORT", "31337"))


def handle(conn: socket.socket) -> None:
    with conn:
        conn.settimeout(10)
        try:
            data = conn.recv(4096)
            text = data.decode("utf-8", errors="replace").strip()
        except OSError:
            return
        if text.startswith("HEALTH"):
            conn.sendall(b"OK\n")
        elif text.startswith("EXPLOIT:"):
            payload = text[len("EXPLOIT:"):].strip()
            if len(payload) >= 16 and "A" * 8 in payload:
                conn.sendall(f"SEGFAULT: {FLAG}\n".encode())
            else:
                conn.sendall(b"NOPE\n")
        else:
            conn.sendall(f"ECHO [{ROOM_ID}/{TEAM_ID}]: {text[:256]}\n".encode())


def main() -> int:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", PORT))
    server.listen(5)
    while True:
        conn, _addr = server.accept()
        handle(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
