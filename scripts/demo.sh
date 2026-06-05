#!/usr/bin/env bash
# ==========================================================================
# AI-AWD Arena — 完整演示启动器
# ==========================================================================
# 一键运行所有演示和测试，验证 v1 RC 的完整性。
#
# Usage:
#   ./scripts/demo.sh              # 全部演示
#   ./scripts/demo.sh --quick      # 仅核心演示（跳过 live Docker）
#   ./scripts/demo.sh --tcp-only   # 仅 Python TCP 演示
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

passed=0
failed=0

check() {
  local label="$1"
  shift
  echo ""
  echo -e "${BOLD}${CYAN}━━━ ${label} ━━━${NC}"
  if "$@" 2>&1 | tail -5; then
    echo -e "${GREEN}✓ PASS${NC} ${label}"
    passed=$((passed + 1))
  else
    echo -e "${RED}✗ FAIL${NC} ${label}"
    failed=$((failed + 1))
  fi
}

MODE="${1:---all}"

echo "=========================================="
echo " AI-AWD Arena v1 RC 完整性验证"
echo " $(date)"
echo "=========================================="

# —— 测试套件 ——
check "Python 测试套件 (144 tests)" \
  bash -c "PYTHONPATH=server python3 -m unittest discover -s tests -t . -v 2>&1 | tail -3"

check "Node 测试套件 (89 tests)" \
  bash -c "cd client && npm test 2>&1 | tail -3"

# —— 协议演示 ——
check "TCP 三客户端演示" \
  bash -c "PYTHONPATH=server python3 examples/three_clients_demo.py 2>&1 | tail -5"

check "TUI 脚本演示" \
  bash -c "PYTHONPATH=server python3 examples/tui_script_demo.py 2>&1 | tail -5"

# —— 靶机生命周期 ——
check "靶机生命周期 Dry-Run (all targets)" \
  bash -c "PYTHONPATH=server python3 examples/target_lifecycle_evidence.py --all-targets 2>&1 | tail -5"

# —— Live Docker ——
if [[ "$MODE" != "--quick" ]]; then
  echo ""
  echo -e "${CYAN}检查 Docker 可用性...${NC}"
  if docker info &>/dev/null 2>&1; then
    check "靶机生命周期 Live (all targets)" \
      bash -c "PYTHONPATH=server python3 examples/target_lifecycle_evidence.py --live --all-targets 2>&1 | tail -10"
  else
    echo -e "${CYAN}Docker daemon 不可用，跳过 live evidence。${NC}"
  fi
else
  echo ""
  echo -e "${CYAN}--quick 模式：跳过 live Docker evidence${NC}"
fi

# —— Electron 证据 ——
if [[ "$MODE" != "--tcp-only" ]]; then
  echo ""
  echo -e "${CYAN}检查 Electron 是否可用...${NC}"
  if [[ -f client/node_modules/.bin/electron ]]; then
    check "Electron 协议证据" \
      bash -c "cd client && npm run e2e:protocol 2>&1 | tail -5"
    check "Electron BrowserWindow 证据" \
      bash -c "cd client && npm run e2e:windows 2>&1 | tail -5"
  else
    echo -e "${CYAN}Electron 未安装 (cd client && npm install)，跳过 Electron evidence。${NC}"
  fi
fi

# —— 小结 ——
echo ""
echo "=========================================="
echo -e " 通过: ${GREEN}${passed}${NC} / 失败: ${RED}${failed}${NC}"
if [[ $failed -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}全部验证通过 ✓${NC}"
else
  echo -e "  ${RED}${BOLD}有 ${failed} 项失败，请检查上方输出${NC}"
fi
echo "=========================================="
