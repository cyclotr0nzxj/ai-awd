from __future__ import annotations

import argparse
import asyncio

from .tcp_gateway import TCPGateway


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the AI-AWD Arena referee server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9000, type=int)
    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()
    gateway = TCPGateway(host=args.host, port=args.port)
    await gateway.start()
    print(f"AI-AWD Arena server listening on {gateway.host}:{gateway.port}")
    try:
        await gateway.serve_forever()
    finally:
        await gateway.stop()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
