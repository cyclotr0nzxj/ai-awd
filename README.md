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

## 怎么玩？

### 🎮 下载 App（推荐）

从 [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases) 下载 macOS `.dmg`，拖进 Applications 就行。Windows 用户下载 `.exe`。

### 🖥️ 开个房间

在**一台电脑**上启动裁判服务器（持续运行，直到所有人玩完）：

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh
```

输出大概是：
```
AI-AWD Arena 裁判服务器
TCP 地址:  127.0.0.1:9000
HTTP API:  http://127.0.0.1:9001
```

如果在局域网玩，加 `--lan` 就行：
```bash
bash scripts/start-server.sh --lan
```

输出：
```
AI-AWD Arena 裁判服务器
TCP 地址:  0.0.0.0:9000
HTTP API:  http://0.0.0.0:9001

📡 本机局域网 IP: 192.168.1.100
   客户端连接填:  192.168.1.100:9000
```

把 `192.168.1.100` 这个 IP 发给其他玩家，他们在自己电脑的客户端里填这个地址就能连上。

### 🎯 上场比赛

打开 App，左边面板：

1. **连接** → 输入服务器 IP 和端口，点连接
2. **选 AI 模型** → 下拉选 Anthropic Claude / OpenAI GPT / 本地模型，填 API Key
3. **创建或加入房间** → 输入房间 ID，点参赛
4. **准备** → 点「靶机就绪」和「Agent 就绪」
5. **开打** → 房主点「开始比赛」

比赛流程：**准备** → **加固**（修自己的漏洞）→ **攻防**（AI Agent 攻击对手）→ **结算**

### ⚔️ 怎么得分

攻防阶段中，你的 Agent 会自动扫描对手靶机，找到 `FLAG{...}` 后提交：

- 成功攻陷对手 Flag → **+100 分**
- 自己的 Flag 被对手拿到 → **-50 分**
- 同一 Flag 只能被提交一次

打完看排行榜，生成 Markdown 战报。

## ✨ 特性

- **真正的 AI 对战** — 支持 Anthropic Claude、OpenAI GPT、Hermes、OpenClaw、Codex 等 7 种 AI 后端
- **可视化竞技场** — 实时玩家卡片、攻击路线动画、分数弹出、防线状态
- **新手教程** — 首次启动自动弹出 10 步引导，3 分钟上手
- **攻陷回放** — 时间线拖拽、自动播放、上一攻/下一攻
- **安全边界** — 靶机只绑 localhost，Flag 自动脱敏，观战只读
- **战报导出** — 一键生成 Markdown 战报，复制或下载

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
