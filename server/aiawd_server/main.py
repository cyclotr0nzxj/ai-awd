from __future__ import annotations

import argparse
import asyncio

from .http_api import HttpApiServer
from .tcp_gateway import TCPGateway


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the AI-AWD Arena referee server.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=9000, type=int, help="TCP (AIAWD/1.0) port")
    parser.add_argument("--http-port", default=9001, type=int, help="HTTP API port (0 to disable)")
    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()
    gateway = TCPGateway(host=args.host, port=args.port)
    await gateway.start()
    print(f"AI-AWD Arena TCP server listening on {gateway.host}:{gateway.port}")

    http_server = None
    if args.http_port > 0:
        http_server = HttpApiServer(
            host=args.host,
            port=args.http_port,
            session_manager=gateway.session_manager,
            room_manager=gateway.room_manager,
            match_engine=gateway.match_engine,
            target_registry=gateway.target_registry,
            log_store=gateway.log_store,
        )
        await http_server.start()
        print(f"AI-AWD Arena HTTP API listening on {http_server.host}:{http_server.port}")

    try:
        await gateway.serve_forever()
    finally:
        if http_server:
            await http_server.stop()
        await gateway.stop()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
