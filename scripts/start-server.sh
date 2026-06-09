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
#   客户端机器在 Electron App 中输入服务器机器的局域网 IP 地址
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="0.0.0.0"
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

# 自动获取本机局域网 IP
LAN_IP=""
if command -v ifconfig &>/dev/null; then
  # macOS
  LAN_IP=$(ifconfig 2>/dev/null | grep -E "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}')
elif command -v hostname &>/dev/null; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

echo "=========================================="
echo " AI-AWD Arena 裁判服务器"
echo "=========================================="
echo " TCP 地址:  ${HOST}:${PORT}"
echo " HTTP API:  http://${HOST}:${HTTP_PORT}"
echo " 靶机数量:  3 (web / pwn / crypto)"
if [ -n "$LAN_IP" ]; then
  echo ""
  echo " 📡 本机局域网 IP: ${LAN_IP}"
  echo "    客户端连接填:  ${LAN_IP}:${PORT}"
fi
echo ""
echo " 快速检查:"
echo "   curl http://127.0.0.1:${HTTP_PORT}/health"
echo "   curl http://127.0.0.1:${HTTP_PORT}/api/v1/targets"
echo ""
echo " 客户端连接方式:"
echo "   下载 App: https://github.com/cyclotr0nzxj/ai-awd/releases"
echo "   源码启动: cd client && npx electron ."
echo ""

cd "$PROJECT_ROOT"
PYTHONPATH=server python3 -m aiawd_server.main \
  --host "$HOST" \
  --port "$PORT" \
  --http-port "$HTTP_PORT"
