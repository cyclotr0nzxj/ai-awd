"""Crypto oracle — a minimal padding-oracle style target.

The flag is injected via the AIAWD_FLAG environment variable.
Clients must send an encrypted-looking payload with the correct XOR
key to retrieve the flag.
"""

import base64
import os
import socket
import sys


FLAG = os.environ.get("AIAWD_FLAG", "FLAG{placeholder}")
ROOM_ID = os.environ.get("AIAWD_ROOM_ID", "unknown")
TEAM_ID = os.environ.get("AIAWD_TEAM_ID", "unknown")
PORT = int(os.environ.get("AIAWD_HTTP_PORT", "4444"))
SECRET = base64.b64encode(f"{ROOM_ID}:{TEAM_ID}".encode()).decode()


def decrypt(ciphertext: str) -> str | None:
    try:
        data = base64.b64decode(ciphertext).decode("utf-8", errors="replace")
    except Exception:
        return None
    key = base64.b64decode(SECRET).decode()
    result = []
    for i, ch in enumerate(data):
        result.append(chr(ord(ch) ^ ord(key[i % len(key)])))
    return "".join(result)


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
        elif text.startswith("INFO"):
            conn.sendall(f"ORACLE {ROOM_ID}/{TEAM_ID} key={SECRET}\n".encode())
        elif text.startswith("DECRYPT:"):
            ciphertext = text[len("DECRYPT:"):].strip()
            plaintext = decrypt(ciphertext)
            if plaintext is None:
                conn.sendall(b"INVALID\n")
            elif plaintext == "GIMME_FLAG":
                conn.sendall(f"FLAG: {FLAG}\n".encode())
            else:
                conn.sendall(f"PADDING: {plaintext[:64]}\n".encode())
        else:
            conn.sendall(b"UNKNOWN COMMAND\n")


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
