# Electron AWD 战情大厅

当前客户端是一个中文 Electron GUI，视觉方向是 AWD 比赛战情大厅。主进程负责 AIAWD/1.0 TCP 连接，renderer 只通过 preload API 展示服务端权威状态。

已覆盖的界面：

1. 服务端连接。
2. 大厅两个大卡片（加入房间 / 创建房间），点击弹出浮层子页面。加入浮层含搜索、房间列表（点击自动填入）和参赛/观战按钮。创建浮层含地图卡片、赛制预设和房间配置。
3. 房间页全宽玩家列表，底部准备栏（Agent 选择 + API Key + 模型名 + 准备按钮），房主可开始大乱斗。
4. 靶机/Agent 就绪状态上报。
6. 比赛阶段、阶段倒计时、带领先/落后提示的排行榜、带成功/失败状态的实时战报、协议消息和比赛配置展示。
7. AI攻防大乱斗竞技场：可点击 Agent 玩家卡、模型头像、准备度条、攻陷路线、战斗回放和战场焦点面板。
8. AI攻防态势：防线完整人数、攻陷领先、失守最多、连续攻陷状态，以及每位玩家的攻陷/失守状态。
9. 私人战斗包摘要：玩家 ID、模型、靶场、难度、运行时、健康检查路径、对手数量、允许目标数量。
10. 不再内置新手教程；详细说明见 README 和文档。
11. 本地靶机生命周期：诊断、安装、启动、巡检、停止、重置都通过 Electron 主进程执行，renderer 只显示脱敏状态。
12. Agent 自动攻击：进入攻防阶段自动持续执行（3 秒间隔），无需手动操作。命令根据阶段自动生成（攻击/加固 prompt）。支持自动提交 Flag。Agent 动态实时广播给房间所有成员。

注意：比赛配置中的私有 flag 默认在界面中脱敏显示。

## 模块

- `aiawdProtocol.js` — AIAWD/1.0 协议编解码
- `agentRuntime.js` — Agent 运行时管理（AgentManager, CustomCommandAdapter, parseActivitySteps）
- `adapters.js` — 多提供者适配器入口（Hermes, OpenClaw, OpenCLI, Codex, Pi, CustomPython, 自定义命令）
- `providerDetect.js` — 厂商检测 + Logo 映射，主进程/渲染进程共享
- `scopeguard.js` — 安全边界（网络范围、文件范围、进程安全）
- `targetLifecycle.js` — 本地靶机生命周期与 Docker 诊断
- `main.js` — Electron 主进程，TCP 桥 + IPC 处理
- `preload.js` — preload API 桥
- `renderer.js` — 中文战情 UI（含 Agent 实时动态播报、厂商 Logo 自动检测、attack 阶段自动启停）

## 测试

```bash
npm test
```

该命令会运行 AIAWD 协议编解码测试、`targetLifecycle` 主进程安全边界测试、`agentRuntime` 测试、`adapters` 测试、IPC 桥接测试，以及不依赖 Electron 的 `test-renderer.js` 中文 UI 烟测（共 80 tests，77 pass，3 已知失败）。

## 端到端协议证据

```bash
npm run e2e:protocol
```

该命令会启动本地 Python referee server，并用 Electron 主进程同款 `AiawdClient` 驱动 Alice/Bob/Carol 三个客户端完成创建房间、参赛、观战、开赛、提交 flag 和排行榜更新流程。输出写入 `logs/electron/e2e_protocol_evidence.json`，其中私有 flag 已脱敏。

## BrowserWindow 截图证据

```bash
npm run e2e:windows
```

该命令会启动本地 Python referee server，打开 Alice/Bob/Carol 三个 Electron BrowserWindow，驱动创建房间、Agent 玩家参赛、观战、开赛、攻陷计分、上一攻/最新回放切换、点击玩家卡切换战场焦点流程，并将截图写入 `logs/electron/browserwindow/`，JSON 证据写入 `logs/electron/e2e_browserwindow_evidence.json`。

## 打包

```bash
npm run pack          # 测试打包（不生成安装包）
npm run dist:mac      # macOS .dmg
npm run dist:win      # Windows .exe
```

构建产物输出到 `dist/`。打包前需将 `icon.icns` 和 `icon.ico` 放入 `build/`。
