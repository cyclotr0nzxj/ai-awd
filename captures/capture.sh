#!/usr/bin/env bash
# ==========================================================================
# AI-AWD Arena — 一键抓包脚本
# ==========================================================================
# 后台启动 tcpdump 抓取 AIAWD/1.0 协议流量，等待用户按回车后停止。
#
# Usage:
#   bash captures/capture.sh                    # 自动检测 loopback 接口
#   bash captures/capture.sh -i en0             # 指定网卡
#   bash captures/capture.sh -i en0 -p 9090     # 指定端口
#   bash captures/capture.sh --lan              # 局域网模式（抓 en0/eth0）
#
# Output: captures/aiawd_match_YYYYMMDD_HHMMSS.pcap
# ==========================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
CAPTURE_FILE="${SCRIPT_DIR}/aiawd_match_${TIMESTAMP}.pcap"

# ---- 参数解析 ----
INTERFACE=""
PORT="9000"
MODE="auto"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i) INTERFACE="$2"; shift 2 ;;
    -p) PORT="$2"; shift 2 ;;
    --lan) MODE="lan"; shift ;;
    -h|--help)
      echo "Usage: bash captures/capture.sh [-i <iface>] [-p <port>] [--lan]"
      echo ""
      echo "  -i <iface>   网卡接口名（如 en0、eth0、lo0）"
      echo "  -p <port>    AIAWD 端口号（默认 9000）"
      echo "  --lan        局域网模式，自动检测物理网卡"
      echo "  -h, --help   显示帮助"
      exit 0
      ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# ---- 自动检测网卡 ----
detect_interface() {
  local os
  os="$(uname -s)"
  if [[ "$os" == "Darwin" ]]; then
    # macOS: loopback 是 lo0，物理网卡通常是 en0
    if [[ "$MODE" == "lan" ]]; then
      echo "en0"
    else
      echo "lo0"
    fi
  elif [[ "$os" == "Linux" ]]; then
    if [[ "$MODE" == "lan" ]]; then
      ip route get 1.1.1.1 2>/dev/null | awk '{print $5; exit}' || echo "eth0"
    else
      echo "lo"
    fi
  else
    echo "lo0"
  fi
}

if [[ -z "$INTERFACE" ]]; then
  INTERFACE="$(detect_interface)"
fi

# ---- 检查依赖 ----
if ! command -v tcpdump &>/dev/null; then
  echo -e "${RED}错误：未安装 tcpdump${NC}"
  echo "macOS: 已预装"
  echo "Linux: sudo apt install tcpdump 或 sudo yum install tcpdump"
  exit 1
fi

# ---- 启动 ----
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   AI-AWD Arena — 协议抓包工具       ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  网卡接口:  ${GREEN}${INTERFACE}${NC}"
echo -e "  端口过滤:  ${GREEN}${PORT}${NC}"
echo -e "  输出文件:  ${GREEN}${CAPTURE_FILE}${NC}"
echo -e "  模式:      ${YELLOW}$([[ "$MODE" == "lan" ]] && echo '局域网' || echo '本地 loopback')${NC}"
echo ""

# ---- 启动 tcpdump ----
echo -e "${YELLOW}正在后台启动 tcpdump...${NC}"
echo -e "  (可能需要 sudo 密码)${NC}"
echo ""

sudo tcpdump \
  -i "${INTERFACE}" \
  -w "${CAPTURE_FILE}" \
  -s 0 \
  "tcp port ${PORT}" &
TCPDUMP_PID=$!

# 等待 tcpdump 启动
sleep 2

if ! kill -0 "${TCPDUMP_PID}" 2>/dev/null; then
  echo -e "${RED}错误：tcpdump 启动失败${NC}"
  exit 1
fi

echo -e "${GREEN}✓ tcpdump 已启动 (PID ${TCPDUMP_PID})${NC}"
echo ""

# ---- 提示 ----
echo -e "${BOLD}============================================${NC}"
echo ""
echo -e "  ${GREEN}●${NC} 抓包进行中..."
echo ""
echo -e "  现在请在 ${BOLD}另一个终端${NC}执行："
echo ""
echo -e "    ${CYAN}# 启动服务端${NC}"
echo -e "    ${CYAN}PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port ${PORT}${NC}"
echo ""
echo -e "    ${CYAN}# 运行演示（再开一个终端）${NC}"
echo -e "    ${CYAN}PYTHONPATH=server python3 examples/three_clients_demo.py${NC}"
echo ""
echo -e "  ${YELLOW}或直接使用 Electron 客户端进行人工对战${NC}"
echo ""
echo -e "  ${BOLD}完成后按回车停止抓包...${NC}"
echo ""
echo -e "${BOLD}============================================${NC}"

# ---- 等待用户按回车 ----
read -r

# ---- 停止 tcpdump ----
echo ""
echo -e "${YELLOW}正在停止 tcpdump...${NC}"
sudo kill "${TCPDUMP_PID}" 2>/dev/null || true
sleep 1

# 确保进程停止
if kill -0 "${TCPDUMP_PID}" 2>/dev/null; then
  sudo kill -9 "${TCPDUMP_PID}" 2>/dev/null || true
fi

# ---- 输出结果 ----
echo ""
echo -e "${GREEN}${BOLD}✓ 抓包完成！${NC}"
echo ""

if [[ -f "${CAPTURE_FILE}" ]]; then
  FILE_SIZE=$(ls -lh "${CAPTURE_FILE}" | awk '{print $5}')
  PACKET_COUNT=$(tcpdump -r "${CAPTURE_FILE}" 2>/dev/null | wc -l | tr -d ' ')
  echo -e "  文件:     ${GREEN}${CAPTURE_FILE}${NC}"
  echo -e "  大小:     ${GREEN}${FILE_SIZE}${NC}"
  echo -e "  包数量:   ${GREEN}${PACKET_COUNT}${NC}"
  echo ""

  if [[ "${PACKET_COUNT}" -gt 0 ]]; then
    echo -e "  ${BOLD}快速预览（前 10 条消息类型）:${NC}"
    echo ""
    tcpdump -r "${CAPTURE_FILE}" -A 2>/dev/null | grep -o '"type":"[^"]*"' | head -10 | sed 's/"type":"/  → /;s/"//'
    echo ""
  fi

  echo -e "  ${BOLD}用 Wireshark 打开:${NC}"
  echo -e "  ${CYAN}open ${CAPTURE_FILE}${NC}"
  echo ""
  echo -e "  ${BOLD}命令行查看:${NC}"
  echo -e "  ${CYAN}tcpdump -r ${CAPTURE_FILE} -A | less${NC}"
else
  echo -e "  ${RED}警告：pcap 文件未生成（可能没有捕获到流量）${NC}"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
