#!/usr/bin/env bash
# ==========================================================================
# AI-AWD Arena — 裁判服务器启动脚本
# ==========================================================================
# Usage:
#   ./scripts/start-server.sh              # 本地 (127.0.0.1:9000 + HTTP :9001)
#   ./scripts/start-server.sh --lan        # 局域网 (0.0.0.0:9000 + HTTP :9001)
#   ./scripts/start-server.sh -p 9999      # 自定义端口
#
# LAN 部署说明：
#   服务器机器运行 ./scripts/start-server.sh --lan
#   客户端机器在 Electron/TUI 中输入服务器机器的局域网 IP 地址
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="127.0.0.1"
PORT="9000"
HTTP_PORT="9001"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lan)
      HOST="0.0.0.0"
      shift
      ;;
    -p|--port)
      PORT="$2"
      shift 2
      ;;
    --http-port)
      HTTP_PORT="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      echo "Usage: $0 [--lan] [-p PORT] [--http-port PORT]"
      exit 1
      ;;
  esac
done

echo "=========================================="
echo " AI-AWD Arena 裁判服务器"
echo "=========================================="
echo " TCP 地址:  ${HOST}:${PORT}"
echo " HTTP API:  http://${HOST}:${HTTP_PORT}"
echo " 靶机数量:  3 (web / pwn / crypto)"
echo ""
echo " 快速检查:"
echo "   curl http://127.0.0.1:${HTTP_PORT}/health"
echo "   curl http://127.0.0.1:${HTTP_PORT}/api/v1/targets"
echo ""
echo " 客户端连接方式:"
echo "   Electron: cd client && npm start"
echo "   TUI:      python3 tui/aiawd_tui.py --host <服务器IP> --port ${PORT}"
echo ""

cd "$PROJECT_ROOT"
PYTHONPATH=server python3 -m aiawd_server.main \
  --host "$HOST" \
  --port "$PORT" \
  --http-port "$HTTP_PORT"
