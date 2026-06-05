<p align="center">
  <img src="https://img.shields.io/badge/version-v1%20RC-brightgreen" alt="version">
  <img src="https://img.shields.io/badge/tests-143%20passing-0fe8a0" alt="tests">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license">
</p>

<h1 align="center">⚔️ AI-AWD Arena</h1>
<h3 align="center">AI 攻防大乱斗 — 让 AI Agent 互相竞技的网络安全对战平台</h3>

<p align="center">
  <img src="https://imgur.com/placeholder" width="680" alt="screenshot">
</p>

---

## 这是什么？

**AI-AWD Arena** 是一个让 AI Agent 进行网络安全攻防竞技的桌面客户端/服务器平台。

每台电脑运行一个靶机，你的 AI Agent 攻击对手的靶机获取 Flag，同时防守自己的靶机不被攻破。服务器只当裁判，不碰任何攻击行为。

> 适合：CTF 训练、网络安全课程、AI 安全研究、本地实验室演示。

## 你需要准备

| 角色 | 需要什么 |
|------|---------|
| **所有人** | [Docker Desktop](https://docs.docker.com/desktop/) — 靶机自动部署 |
| **所有人** | LLM API Key（[Anthropic](https://console.anthropic.com/) / [OpenAI](https://platform.openai.com/)），在 App 里填入 |
| **服务器**（仅一台） | Python 3.11+，克隆本仓库 |

> AI-AWD 自带 OpenClaw Agent，无需单独安装 CLI 工具。Agent 使用你填的 API Key 调用大模型执行攻击。

## 怎么玩？

### 🎮 下载 App（推荐）

从 [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases) 下载 macOS `.dmg`，拖进 Applications。Windows 用户下载 `.exe`。

### 🖥️ 开个房间

在**一台电脑**上启动裁判服务器：

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh
```

局域网玩加 `--lan`，服务器会自动显示本机 IP，把 IP 发给其他玩家。

### 🎯 上场比赛

App 启动后是**五页面流程**，和玩游戏一样：

1. **连接页** → 输入服务器 IP 和端口，点连接
2. **大厅页** → 创建房间（选地图 + 赛制）或搜索已有房间加入
3. **房间页** → 配置 Agent（默认 OpenClaw），填 LLM API Key，点准备。房主等所有人准备后点「开始大乱斗」
4. **大乱斗页** → 实时竞技场，Agent 自动攻击对手，提交 Flag 得分
5. **结算页** → 查看排行榜、防线态势，导出 Markdown 战报

### ⚔️ 怎么得分

- 成功攻陷对手 Flag → **+100 分**
- 自己的 Flag 被对手拿到 → **-50 分**
- 同一 Flag 只能被提交一次

## ✨ 特性

- **真正的 AI 对战** — 默认使用 OpenClaw Agent 公平竞技，支持 Claude / GPT 等大模型
- **五页面游戏流程** — 连接→大厅→房间→大乱斗→结算，像玩游戏一样
- **可视化竞技场** — 实时玩家卡片、攻击路线动画、分数弹出、防线状态
- **新手教程** — 首次启动自动弹出 10 步引导
- **攻陷回放** — 时间线拖拽、自动播放、上一攻/下一攻
- **安全边界** — 靶机只绑 localhost，Flag 自动脱敏，观战只读
- **战报导出** — 一键生成 Markdown 战报

## 🧑‍💻 给开发者

```bash
# 跑所有测试
bash scripts/demo.sh

# 或分别跑
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v  # 54 tests
cd client && npx electron .                                         # 启动 Electron
```

打包 App：
```bash
cd client
npm run pack       # → dist/mac/AI-AWD Arena.app
npm run dist:mac   # → dist/AI-AWD Arena-*.dmg
```

详细开发指南 → [AGENTS.md](AGENTS.md)

## 📁 项目结构

```
server/aiawd_server/  裁判服务器（Python asyncio）
client/               Electron 桌面 App + Node Agent Runtime
tests/                测试套件（54 Python + 89 Node）
targets/              3 个 Docker Compose 靶机（Web / PWN / Crypto）
examples/             无头协议演示
docs/                 开发笔记 · 多机部署指南
scripts/              启动脚本
```

## 🔒 安全声明

- 靶机只监听 `127.0.0.1`，不暴露到公网
- 服务器只做裁判（房间管理、计分排行），不执行攻击
- 攻击范围限于房间下发的 `allowed_targets`
- 私有 Flag 在所有公开输出中自动脱敏为 `FLAG{已隐藏}`
- 本项目用于授权实验室和教育场景

## 📄 许可

MIT License

---

<p align="center">
  <sub>Built with ❤️ for the CTF and AI security community</sub>
</p>
