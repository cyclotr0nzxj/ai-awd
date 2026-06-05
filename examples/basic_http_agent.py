#!/usr/bin/env python3
"""Basic HTTP Agent — built-in reconnaissance agent for AI-AWD Arena.

Takes a target URL as argument, probes common paths, and extracts FLAG{...}
patterns from responses. Uses only the Python standard library.

Usage:
  python3 examples/basic_http_agent.py http://127.0.0.1:18081
  AIAWD_FLAG=... python3 examples/basic_http_agent.py http://127.0.0.1:18081

Environment variables (from AgentContext):
  AIAWD_MATCH_ID, AIAWD_ROOM_ID, AIAWD_TEAM_ID, AIAWD_PHASE,
  AIAWD_TARGETS, AIAWD_LOCAL_TARGET, AIAWD_ALLOWED_TARGETS,
  AIAWD_TARGET_TEMPLATE, AIAWD_FLAG
"""

from __future__ import annotations

import os
import re
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

FLAG_RE = re.compile(r"FLAG\{[A-Za-z0-9_/-]+\}")

PROBE_PATHS = [
    "/",
    "/health",
    "/healthz",
    "/api",
    "/api/flag",
    "/flag",
    "/debug",
    "/admin",
    "/status",
    "/.env",
    "/config",
    "/robots.txt",
    "/sitemap.xml",
]

PROBE_METHODS = ["GET", "POST", "OPTIONS"]


def probe_target(target_url: str, timeout: int = 10) -> list[str]:
    flags: list[str] = []
    base = target_url.rstrip("/")

    for path in PROBE_PATHS:
        for method in PROBE_METHODS:
            url = f"{base}{path}"
            try:
                req = Request(url, method=method, headers={"User-Agent": "AI-AWD-Basic-Agent/1.0"})
                if method == "POST":
                    req.data = b'{"query":"flag"}'
                    req.add_header("Content-Type", "application/json")
                with urlopen(req, timeout=timeout) as resp:
                    body = resp.read().decode("utf-8", errors="replace")
                    found = FLAG_RE.findall(body)
                    for flag in found:
                        flags.append(flag)
            except (URLError, HTTPError, OSError):
                continue

    return list(set(flags))


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: basic_http_agent.py <target_url>", file=sys.stderr)
        return 1

    target_url = sys.argv[1]
    match_id = os.environ.get("AIAWD_MATCH_ID", "unknown")
    room_id = os.environ.get("AIAWD_ROOM_ID", "unknown")

    print(f"# AI-AWD Basic HTTP Agent", flush=True)
    print(f"# Match: {match_id}  Room: {room_id}", flush=True)
    print(f"# Target: {target_url}", flush=True)

    started = time.time()
    flags = probe_target(target_url)
    elapsed = time.time() - started

    if flags:
        for flag in flags:
            print(flag, flush=True)
        print(f"# Found {len(flags)} flag(s) in {elapsed:.1f}s", flush=True)
    else:
        print(f"# No flags found in {elapsed:.1f}s", flush=True)

    return 0 if flags else 1


if __name__ == "__main__":
    raise SystemExit(main())
