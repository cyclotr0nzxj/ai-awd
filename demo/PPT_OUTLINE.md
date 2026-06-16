# AI-AWD Arena — 演示 PPT 逐页指南

> **配色：浅色背景**（白底 + 深蓝/墨绿点缀），干净学术风格。
> **风格**：技术黑客 × 大学生本色 — 硬核但不装逼，说人话。
> **时长**：约 8 分钟（含 2 分钟视频播放）
>
> **配图**：`demo/screenshots/` 下 24 张截图 + `client/assets/vendors/` 下 45 个 AI 厂商 Logo

---

## Slide 1 · 封面

```
                        ⚔️ AI-AWD Arena

               自定义应用层协议 · 联网交互系统

                让 AI Agent 打一场 CTF 攻防赛

              ┌──────────────────────────┐
              │  网络编程实验 · 课程汇报   │
              └──────────────────────────┘
```

**设计要点**：
- 纯白背景，顶部用深蓝色 (#1a2740) 细线装饰
- 标题用墨绿色 (#16a34a)，副标题深灰色
- 底部放一排 AI 厂商 Logo（6~8 个，水平排列，半透明）：

| Logo | 文件 | 为什么要放 |
|------|------|-----------|
| DeepSeek | `client/assets/vendors/deepseek.png` | 我们实战用的模型 |
| OpenAI | `client/assets/vendors/openai.png` | 行业标杆 |
| Anthropic | `client/assets/vendors/anthropic.png` | Claude 的厂商 |
| Google | `client/assets/vendors/google.png` | Gemini |
| Meta | `client/assets/vendors/meta.png` | Llama 开源模型 |
| Qwen | `client/assets/vendors/qwen.png` | 国产通义千问 |
| Kimi | `client/assets/vendors/kimi.png` | Moonshot |
| Zhipu | `client/assets/vendors/zhipu.png` | 智谱 GLM |

> 💡 « 系统支持 45+ 大模型厂商，我们实战用的是 DeepSeek »


## Slide 2 · 这是什么

**两台电脑，两个 AI Agent，互相攻击对方靶机，抢 Flag 得分。**

```
   ┌─ 服务端（裁判）──┐
   │  不攻击 不防守    │
   │  只管计分 & 排名  │
   └──┬──────────┬───┘
      │  AIAWD/1.0│
  ┌───▼───┐  ┌───▼───┐
  │ Alice  │  │  Bob  │
  │ macOS  │  │ Win   │
  │DeepSeek│  │DeepSeek│
  │v4-pro  │  │ chat  │
  └────────┘  └───────┘
```

- 左右各放 Alice/Bob 的 Logo：`deepseek.png`
- 配图：`connect_mac.png` + `connect_win.png` 并排
- 口述：「左边 macOS，右边 Windows，打开客户端连上服务端，选好 AI，点开始——后面全自动。」


## Slide 3 · 架构一览

**C/S 架构 + 自定义协议 + AI Agent 驱动**

```
┌──────────────────────────────────────┐
│     服务端 · Python asyncio            │
│     TCP :9000 · HTTP :9001            │
│     房间管理 · 阶段调度 · Flag 校验      │
│     计分仲裁 · 事件广播                 │
└──┬──────────┬──────────┬──────────┘
   │          │          │
┌──▼──┐  ┌───▼───┐  ┌───▼──────┐
│Alice│  │ Bob   │  │Wireshark │
│macOS│  │Win    │  │抓包分析   │
└─────┘  └───────┘  └──────────┘
```

| 层级 | 技术 | 选型理由 |
|------|------|---------|
| 服务端 | Python 3.11 · asyncio | 标准库零依赖，协程天然并发 |
| 客户端 | Electron 30 · Node.js | 跨平台桌面端，一套代码双端 |
| AI 引擎 | DeepSeek · OpenClaw | 国产模型，API 便宜效果不差 |
| 协议 | AIAWD/1.0 | 自定二进制帧 + JSON，可读可调 |
| 靶机 | Docker Compose | 隔离安全，即开即用 |

- 配图：`server_mac.png`
- 口述：「服务端纯 Python 标准库，不装任何第三方包。一个协程伺候一个客户端，不搞多线程。」


## Slide 4 · 谁干什么（C/S 分工）

| 🖥️ 服务端（裁判） | 💻 客户端（玩家） |
|:--|:--|
| 管理房间 + 自动切换阶段 | 连服务端 + 展示界面 |
| 生成 Flag（只存 SHA-256） | 跑 AI Agent 攻击对手 |
| 校验 Flag（6 道关卡） | Docker 启动本地靶机 |
| 计分 + 广播排名 | 提交 Flag |
| **绝不攻击，绝不碰 Docker** | **不能改分，不能跨阶段操作** |

> 🔑 核心原则：服务端是唯一权威。客户端代码随便改，过不了我这 6 关 = 不算分。

- 口述：「为什么强调服务端权威？因为这是攻防比赛——如果客户端能自己改分数，那就不用玩了。」


## Slide 5 · 协议设计（一页 · 现场开 GitHub）

**AIAWD/1.0 — 简单到 Wireshark 抓下来直接能读**

```
┌──────────────┬────────────────────────┐
│  4 字节大端    │  可变长 UTF-8 JSON      │
│  长度前缀      │  消息体                 │
│  (0x0000005E) │  {"v":1,"type":...}    │
└──────────────┴────────────────────────┘
```

```
HELLO → WELCOME → CREATE_ROOM → JOIN → START
→ MATCH_CONFIG → PHASE_SYNC → SUBMIT_FLAG → RANKING
```

> 📎 **现场打开 GitHub** → [`protocol.md`](https://github.com/cyclotr0nzxj/ai-awd/blob/main/protocol.md)
> 28 种消息类型 · 字段含义 · 状态机 · 错误码表 — 都在这里面

- 口述：「协议就两层——4 字节告诉你有多少数据，后面纯 JSON。不搞二进制序列化、不定长编码，Wireshark 抓下来直接可读。」


## Slide 6 · 五阶段状态机

```
  LOBBY  ──→  PREPARE  ──→  DEFENSE  ──→  ATTACK  ──→  FINISHED
  大厅         准备           加固           攻防          结束
   │                                        │
   └─ 只能创建/加入房间                      └─ 唯一能提交 Flag 的阶段
```

| 操作 | LOBBY | PREPARE | DEFENSE | ATTACK | FINISHED |
|------|:--:|:--:|:--:|:--:|:--:|
| 创建/加入房间 | ✅ | | | | |
| 开始比赛 | ✅ | | | | |
| 准备就绪 | | ✅ | ✅ | ✅ | |
| **提交 Flag** | | | | ✅ | |
| 心跳 PING | ✅ | ✅ | ✅ | ✅ | ✅ |

- 服务端自动推进，每 5 秒广播 `PHASE_SYNC`
- 口述：「阶段切换是服务端在管，客户端只是被动收通知。不在 ATTACK 阶段提交 Flag？直接打回去——我们实战中 19 次 INVALID_PHASE 就是这么来的。」


## Slide 7 · 异常处理（实战数据）

**不是"我们做了异常处理"——是直接上数据：**

```
一次真实对战 · 67 次 Flag 提交 · 66 次被正确拒绝
```

| 异常码 | 次数 | 服务端怎么处理的 |
|--------|:--:|------|
| INVALID\_PHASE | 19 | 没到攻击阶段，拒绝 |
| INVALID\_FLAG | 32 | Flag 无效 / 没映射到对手 |
| DUPLICATE\_FLAG | 13 | 同一 Flag 已被用过（幂等） |
| SELF\_FLAG | 2 | 打到自己靶机了 |
| **OK** | **1** | Alice 攻陷 Bob，+100 分 ✨ |

- 配图：`events1_real.png`（终端日志截图，标注各异常码）
- 口述：「不是编的测试用例。是真人用 DeepSeek API 打出来的。每一种异常码都对应 `match_engine.py` 里一段校验逻辑。」


## Slide 8 · 现场演示（▶️ 播放视频）

**🎬 播放：`demo/video/battle_demo.mov`**

```
录屏内容全流程：
  连接服务器 → 创建房间 → 队友加入 → 双方准备
  → 自动靶机部署 → 比赛开始 → 阶段推进
  → AI 攻击动画 → 得分弹出 → 排行榜刷新 → 结算
```

- 口述：「这是我和队友的真实对战——macOS + Windows，DeepSeek v4-pro 对 deepseek-chat。」


## Slide 9 · 抓包分析

**tcpdump？不用。我们自己写了个协议层拦截器，直接出标准 PCAP。**

```
每条 AIAWD 消息：
  [4B长度] [UTF-8 JSON]
     ↓          ↓
  帧定界      完全明文可读
```

- 配图（左右并排）：
  - 左：`wireshark-stream.png` — Follow TCP Stream 全览
  - 右：`wireshark-frame.png` — 单帧 HEX + JSON 对照
- 口述：「打开 Wireshark，Follow TCP Stream，从 HELLO 握手到 RANKING_UPDATE 广播，全程明文。同一帧广播扇出到多个客户端——`_broadcast()` 遍历房间所有成员的 TCP writer。」


## Slide 10 · 异常演示（现场跑一个）

```bash
# 连上 9000 端口，不发 HELLO 直接发 PING
echo '{"v":1,"type":"PING","seq":1,"payload":{}}' | nc 127.0.0.1 9000

# 服务端秒回：
# {"type":"ERROR","code":"BAD_REQUEST",
#  "message":"HELLO is required before other messages"}
```

- 现场开终端跑
- 口述：「连握手都不走就想 PING？BAD_REQUEST 直接甩回去。但连接不关——给你机会补 HELLO。」


## Slide 11 · 总结

| 课程要求 | 我们做到的 |
|----------|-----------|
| C/S 架构 | Python 服务端 + Electron 双客户端（macOS + Windows） |
| 自定义协议 | AIAWD/1.0（4B 长度 + JSON，28 种消息） |
| 实时交互 | 广播机制，5 秒同步，毫秒级推送 |
| 服务端权威 | Flag 生成·校验·计分·排名 全在服务端 |
| 并发 | asyncio 协程 + 多房间隔离 |
| 异常处理 | 9 种错误码，67 次实战提交验证 |
| 日志 | JSONL 格式，Flag 自动脱敏 |
| 抓包 | 协议层拦截 → 标准 PCAP → Wireshark 分析 |
| 现场演示 | 视频录屏 + PPT 截图 + 现场终端 |


## Slide 12 · 谢谢 · Q&A

```
                        ⚔️

              AI-AWD Arena · v1.1.0

        github.com/cyclotr0nzxj/ai-awd

        欢迎提问 · 可以随时跑代码验证
```

- 底部放一排 AI 厂商 Logo（与封面呼应）
- 备好终端 + GitHub 页面
