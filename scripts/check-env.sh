#!/usr/bin/env bash
# ==========================================================================
# AI-AWD Arena — 环境诊断 + 修复指南（macOS + Windows）
# Windows 用 Git Bash 运行：bash scripts/check-env.sh
# ==========================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0; WARN=0
FIXES=()

_is_windows() { [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; }
_python()  { if _is_windows; then echo "python"; else echo "python3"; fi; }
_docker()  { if _is_windows; then echo "docker.exe"; else echo "docker"; fi; }
_os_label(){ if _is_windows; then echo "Windows"; else echo "macOS"; fi; }
_npm_cmd() { echo "cd client && npm install"; }
_pip_cmd() { if _is_windows; then echo "pip install"; else echo "pip3 install"; fi; }

fix() { FIXES+=("$1"); }

check() {
  local label="$1"; shift
  printf "  %-48s" "${label}"
  if "$@" >/dev/null 2>&1; then echo -e "${GREEN}✓${NC}"; PASS=$((PASS+1)); return 0
  else echo -e "${RED}✗${NC}"; FAIL=$((FAIL+1)); return 1; fi
}

warn() {
  local label="$1"; shift
  printf "  %-48s" "${label}"
  if "$@" >/dev/null 2>&1; then echo -e "${GREEN}✓${NC}"; PASS=$((PASS+1)); return 0
  else echo -e "${YELLOW}○${NC}"; WARN=$((WARN+1)); return 1; fi
}

echo ""
echo -e "${BOLD}=========================================${NC}"
echo -e "${BOLD} AI-AWD Arena  环境诊断 · $(_os_label)${NC}"
echo " $(date)"
echo -e "${BOLD}=========================================${NC}"
echo ""

# ═══ 项目根定位 ═══
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$SCRIPT_DIR" == */scripts ]]; then PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"; fi
echo "  项目根: ${PROJECT_ROOT}"
echo ""

# ═══ 基础依赖 ═══
echo -e "${BOLD}[基础依赖]${NC}"
PY=$(_python); DKR=$(_docker); OS=$(_os_label)

if ! check "Python 3.11+" "$PY" -c "import sys; assert sys.version_info >= (3,11)"; then
  fix "安装 Python 3.11+: https://python.org/downloads/ （Windows 勾选 Add to PATH）"
fi
echo "      版本: $($PY --version 2>/dev/null || echo ?)"

if ! check "Node.js 18+"  node -e "process.exit(+process.version.slice(1) < 18 ? 1 : 0)"; then
  fix "安装 Node.js 18+: https://nodejs.org/ （选 LTS）"
fi
echo "      版本: $(node -v 2>/dev/null || echo ?)"

if ! check "npm"  npm --version; then
  fix "npm 随 Node.js 一起安装，重装 Node.js 即可"
fi
echo ""

# ═══ 项目文件 ═══
echo -e "${BOLD}[项目文件]${NC}"

check "server 源码存在"  test -f "${PROJECT_ROOT}/server/aiawd_server/main.py"
check "client 源码存在"  test -f "${PROJECT_ROOT}/client/main.js"

if ! check "client/node_modules"  test -d "${PROJECT_ROOT}/client/node_modules"; then
  fix "cd ${PROJECT_ROOT}/client && npm install"
fi
if ! check "protocol.md"  test -f "${PROJECT_ROOT}/protocol.md"; then
  fix "文件缺失，请重新 clone: git clone https://github.com/cyclotr0nzxj/ai-awd.git"
fi
echo ""

# ═══ Git ═══
echo -e "${BOLD}[Git]${NC}"
if ! check "git 可用"  git --version; then
  fix "安装 Git: https://git-scm.com/downloads"
fi
echo ""

# ═══ Docker（mock-agent 模式跳过此项）═══
echo -e "${BOLD}[Docker — mock-agent 模式不需要]${NC}"
HAS_DOCKER=false
if command -v "$DKR" &>/dev/null; then
  if $DKR info >/dev/null 2>&1; then
    echo -e "  ${GREEN}docker 就绪${NC}"; HAS_DOCKER=true
  else
    echo -e "  ${YELLOW}docker CLI 存在但 daemon 未运行${NC}"
    if _is_windows; then
      fix "启动 Docker Desktop（开始菜单 → Docker Desktop），等待鲸鱼图标稳定"
    else
      fix "启动 Docker Desktop: open -a Docker，等待菜单栏图标稳定"
    fi
  fi
else
  echo -e "  ${YELLOW}未安装${NC}"
  if _is_windows; then
    fix "安装 Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
  else
    fix "安装 Docker Desktop: https://docs.docker.com/desktop/install/mac-install/ （Apple Silicon 选 Apple Chip 版本）"
  fi
fi

if $HAS_DOCKER; then
  warn "docker compose 可用"  $DKR compose version
  echo ""
  echo -e "${BOLD}[靶机 compose 文件]${NC}"
  for tpl in real_ctf_web_awd_02 real_ctf_web_awd_01 pwn_awd_echo_01 crypto_awd_oracle_01; do
    warn "  ${tpl}"  test -f "${PROJECT_ROOT}/extras/targets/${tpl}/docker-compose.yml"
  done
fi
echo ""

# ═══ 端口 ═══
echo -e "${BOLD}[端口占用]${NC}"
port_listen() {
  if command -v lsof &>/dev/null; then lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v netstat &>/dev/null; then netstat -an 2>/dev/null | grep -q ":$1.*LISTEN"
  elif command -v ss &>/dev/null; then ss -tlnp "sport = :$1" 2>/dev/null | grep -q ":$1"
  else return 1; fi
}

if port_listen 9000; then
  warn "端口 9000 (TCP)"  true  # already in use, ok
else
  check "端口 9000 空闲"  true
fi

if port_listen 9001; then
  warn "端口 9001 (HTTP)"  true
else
  check "端口 9001 空闲"  true
fi
echo ""

# ═══ Python 模块 ═══
echo -e "${BOLD}[Python 模块]${NC}"
if ! check "aiawd_server 可导入"  "$PY" -c "import sys; sys.path.insert(0,'${PROJECT_ROOT}/server'); import aiawd_server" 2>/dev/null; then
  fix "服务端模块缺失。仓库不完整，重新 clone: git clone https://github.com/cyclotr0nzxj/ai-awd.git"
fi
echo ""

# ═══ 网络 ═══
echo -e "${BOLD}[网络]${NC}"
if _is_windows; then
  LAN_IP=$(ipconfig 2>/dev/null | grep -E "IPv4" | grep -v "127.0.0.1" | head -1 | awk '{print $NF}' | tr -d '\r')
else
  LAN_IP=$(ifconfig 2>/dev/null | grep -E "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}')
fi
echo "  局域网 IP: ${LAN_IP:-未检测到}"
if [ -z "$LAN_IP" ]; then
  fix "未检测到局域网 IP，检查网络连接"
fi
echo ""

# ═══ 服务端状态 ═══
echo -e "${BOLD}[服务端状态]${NC}"
if port_listen 9000; then
  echo -e "  ${GREEN}服务端已在运行 (port 9000)${NC}"
else
  echo -e "  ${YELLOW}服务端未运行${NC}"
fi
echo ""

# ═══════════════════════════════════════════
# 小结 + 修复指令
# ═══════════════════════════════════════════
echo -e "${BOLD}=========================================${NC}"
echo -e "  通过 ${GREEN}${PASS}${NC}  ·  失败 ${RED}${FAIL}${NC}  ·  跳过 ${YELLOW}${WARN}${NC}  ·  待修复 ${#FIXES[@]}"
echo -e "${BOLD}=========================================${NC}"
echo ""

if [ ${#FIXES[@]} -gt 0 ]; then
  echo -e "${BOLD}📋 修复步骤（按顺序执行）：${NC}"
  echo ""
  for i in "${!FIXES[@]}"; do
    echo -e "  ${CYAN}$((i+1)).${NC} ${FIXES[$i]}"
  done
  echo ""
fi

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}✓ 环境就绪，启动对战：${NC}"
  echo ""
  echo "  ┌─ 服务器（一台电脑执行）─────────────────"
  echo "  │  bash extras/scripts/start-server.sh --lan"
  echo "  └──────────────────────────────────────────"
  echo ""
  echo "  ┌─ 客户端（每人各自执行）─────────────────"
  echo "  │  cd client && npm start"
  echo "  └──────────────────────────────────────────"
  echo ""
  echo "  ┌─ 再次诊断 ──────────────────────────────"
  echo "  │  bash scripts/check-env.sh"
  echo "  └──────────────────────────────────────────"
elif [ "$FAIL" -le 2 ] && [ ${#FIXES[@]} -le 3 ]; then
  echo -e "  ${YELLOW}以上失败项修复后即可启动。${NC}"
  echo -e "  ${YELLOW}提示：mock-agent 模式不需要 Docker。${NC}"
else
  echo -e "  ${RED}${BOLD}请先修复以上 ${#FIXES[@]} 项再启动。${NC}"
fi
echo ""
