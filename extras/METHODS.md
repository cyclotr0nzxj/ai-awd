# AI-AWD Arena — 完整方法总览

> 课程作业：网络编程实验 — 自定义应用层协议的联网交互系统
>
> 本文件是你完成后续所有工作的**唯一操作手册**——按顺序读完、做完，report.pdf 的素材就齐了。

---

## 一、项目结构（当前）

```
项目根目录/
├── src/                    源代码（符号链 → server/ + client/）
├── README.md               编译与运行说明
├── protocol.md             协议设计文档
├── logs/                   日志（自动生成 + 你放入人工日志）
│   ├── server/events.jsonl     服务端事件日志
│   └── screenshots/            你的截图放这里（新建）
├── captures/               抓包文件
│   ├── aiawd_capture_*.pcap    标准 PCAP（Wireshark 可打开）
│   ├── aiawd_capture_*.jsonl   帧日志
│   └── capture.sh              一键 tcpdump 抓包（备用）
├── demo/                   演示素材 ← 你的截图和录屏放这里
│   ├── demo_script.md          现场演示操作脚本
│   ├── screenshots/            人工对战截图（新建）
│   └── video/                  录屏文件（新建）
├── server/                 服务端源码（src/ 符号链目标）
├── client/                 客户端源码（src/ 符号链目标）
└── extras/                 扩展资料（开发文档/测试/示例/靶机）
    ├── METHODS.md              本文件
    ├── docs/                   详细技术文档
    ├── examples/               Python 演示客户端
    ├── scripts/                启动/测试脚本
    ├── tests/                  测试套件
    └── targets/                Docker 靶机
```

---

## 二、事前准备（一次性）

```bash
# 1. 确认 Python 和 Node 可用
python3 --version   # 需要 3.11+
node --version      # 需要 18+

# 2. 安装客户端依赖
cd ai-awd/client
npm install
cd ../..

# 3. 确认 tcpdump 可用
which tcpdump

# 4. 创建截图和录屏存放目录
mkdir -p demo/screenshots demo/video logs/screenshots

# 5. 如果要用 Wireshark 分析（推荐），提前安装
# macOS: brew install --cask wireshark  或从 wireshark.org 下载
```

---

## 三、方法 A：自动 Demo 获取日志和抓包（1 条命令，5 分钟）

> 适用场景：快速生成日志 + pcap + 完整交互 transcript，无需人工操作，无需 tcpdump/Wireshark 权限。
>
> ⚠️ **不受 macOS SIP 限制**——在协议层直接截获帧，不依赖 BPF/tcpdump。

### 步骤

```bash
# 一条命令，同时完成：启动服务端 + 3 客户端模拟对战 + 生成 pcap + 生成日志
PYTHONPATH=server python3 extras/capture_demo.py
```

输出：
```
============================================================
 AIAWD/1.0 Capture Demo
 PCAP:  captures/aiawd_capture_<ts>.pcap
 JSONL: captures/aiawd_capture_<ts>.jsonl
============================================================

Server listening on 127.0.0.1:xxxxx
Alice, Bob, Carol connected.
Room created: room_001
Bob joined as player.  Carol joined as spectator.
Match started: match_001
ATTACK phase — Alice submits Bob's flag
Ranking updated — team_a leads.

============================================================
 Demo complete.
 PCAP:  captures/aiawd_capture_<ts>.pcap
 JSONL: captures/aiawd_capture_<ts>.jsonl
 Frames captured: 40+
============================================================
```

### 自动 Demo 产出的文件

| 产出 | 位置 | 说明 |
|------|------|------|
| 服务端日志 | `logs/server/events.jsonl` | 完整 JSONL 事件日志（SERVER_STARTED → … → RANKING_UPDATE） |
| PCAP 抓包文件 | `captures/aiawd_capture_*.pcap` | **标准 PCAP，Wireshark 可直接打开**，含全部帧 |
| JSONL 帧日志 | `captures/aiawd_capture_*.jsonl` | 每帧的 ts/dir/type/bytes 记录 |
| 终端 transcript | 终端输出 | Alice/Bob/Carol 完整收发记录 |

### 验证产出

```bash
# 检查日志
wc -l logs/server/events.jsonl                  # 应该有 20+ 行

# 检查抓包
ls -lh captures/aiawd_capture_*.pcap             # 应该 > 2KB
open -a Wireshark captures/aiawd_capture_*.pcap   # 图形化分析

# 命令行快速验证
wc -l captures/aiawd_capture_*.jsonl             # 帧数（40+）
head -5 captures/aiawd_capture_*.jsonl            # 看前几条帧
```

---

## 四、方法 B：人工实战获取日志和抓包（你和队友真实对战）

> 适用场景：获取真实截图和录屏用于现场演示和实验报告。
>
> ⚠️ **这是现场演示素材的唯一来源，auto demo 不能替代。**

### 4.1 开战前准备

**需要两台电脑**（或在同一台电脑上开两个 Electron 窗口）。

如果同一台电脑开两个窗口：
- 两个客户端窗口分别填不同的名字（如 "Alice"、"Bob"）
- 都连 `127.0.0.1:9000`

如果两台电脑：
- 服务端所在电脑记下局域网 IP（服务端启动时会显示）
- 另一台电脑客户端填这个 IP

### 4.2 完整操作流程（约 15 分钟）

```bash
# ===== 服务端那台电脑 — 启动服务端 =====
bash extras/scripts/start-server.sh --lan
# 记下显示的局域网 IP: 192.168.x.x

# ===== 你和队友各自启动客户端 =====
cd ai-awd/client
npx electron .
```

**然后按以下顺序操作并截图/录屏：**

| 步骤 | 操作 | 截图/录屏时机 |
|------|------|--------------|
| 1 | 两个客户端分别填服务端地址、名字，点「连接服务器」 | 📸 两窗口并列截图 |
| 2 | 房主在大厅页点「创建房间」— 选 "Web 新手训练靶机" — 格式选 "快速" — 创建 | 📸 创建房间弹窗 |
| 3 | 队友在大厅页找到房间，点「参赛」 | 📸 大厅页（房间列表） |
| 4 | 两人在房间页都点「准备」（Agent 选 mock-agent） | 📸 房间页（双方 ready） |
| 5 | 房主点「开始大乱斗」 | 🎥 从这里开始录屏 |
| 6 | 观察阶段自动推进：准备 → 加固 → 攻防 | 🎥 录屏中 |
| 7 | 攻击阶段：观察攻击动画、得分弹出、排行榜刷新 | 🎥 录屏中 + 📸 大乱斗页截图 |
| 8 | 等比赛自然结束（或等 2-3 分钟后手动结束） | 📸 结算页截图 |
| 9 | 展示日志 | 📸 `tail -20 logs/server/events.jsonl` |

### 4.3 人工实战产出的文件

| 产出 | 位置 | 如何获取 |
|------|------|---------|
| 服务端日志 | `logs/server/events.jsonl` | 自动生成，比赛结束后就有了 |
| 截图 | `demo/screenshots/` | 系统截图工具（macOS: Cmd+Shift+4） |
| 录屏 | `demo/video/` | QuickTime Player → File → New Screen Recording |

---

## 五、现有素材清单

### 5.1 人工实战截图 — macOS（`demo/screenshots/实战截图mac/`）

| 文件 | 内容 | 对应报告章节 |
|------|------|-------------|
| `connect_mac.png` | 连接页 | 第 8 章 |
| `server_mac.png` | 服务端启动 | 第 8 章 |
| `lobby_mac.png` | 大厅页 | 第 8 章 |
| `room_create.png` | 创建房间 | 第 8 章 |
| `room_mac.png` | 房间页（准备状态） | 第 8 章 |
| `start_mac.png` | 开始大乱斗 | 第 8 章 |
| `result1.png` / `result2.png` | 结算页排名 | 第 8 章 |

### 5.2 人工实战截图 — Windows（`demo/screenshots/实战截图win/`）

| 文件 | 内容 | 对应报告章节 |
|------|------|-------------|
| `connect_win.png` | 连接页 | 第 8 章 |
| `lobby_win.png` | 大厅页 | 第 8 章 |
| `create_win.png` | 创建房间 | 第 8 章 |
| `room_win.png` | 房间页 | 第 8 章 |
| `ready_win.png` | 准备就绪 | 第 8 章 |
| `battle_win.png` | 大乱斗攻击阶段 | 第 8 章 |

### 5.3 自动 Demo（`demo/screenshots/autodemo/`）

| 文件 | 内容 |
|------|------|
| `capture_jsonl1.png` / `capture_jsonl2.png` | 帧日志 |
| `events1.png` / `events2.png` | 服务端事件日志 |
| `pcap1.png` / `pcap2.png` | pcap 验证 |

### 5.4 抓包分析（`demo/screenshots/抓包分析/`）

| 文件 | 内容 | 对应报告章节 |
|------|------|-------------|
| `wireshark-stream.png` | Follow TCP Stream 全览 | 第 7 章 — ⑧ |
| `wireshark-frame.png` | 单帧 HEX+JSON 对照 | 第 7 章 — ⑨ |

### 5.5 实战日志（`demo/screenshots/实战日志/`）

| 文件 | 内容 | 对应报告章节 |
|------|------|-------------|
| `events1_real.png` | 服务端事件日志（异常处理记录） | 第 6 章、第 8 章 |
| `events2_real.png` | 服务端事件日志（攻陷+拒绝详情） | 第 6 章、第 8 章 |

### 5.6 录屏（`demo/video/battle_demo.mov`）

完整对战录屏（约 489MB），覆盖连接 → 创建 → 加入 → 准备 → 战斗 → 结算全流程，用于现场演示环节 2「实时交互」播放。

---

## 六、demo/ 目录结构（实际）

```
demo/
├── demo_script.md              现场演示操作脚本
├── README.md                   目录说明
├── screenshots/
│   ├── 实战截图mac/             macOS 客户端截图（8 张）
│   ├── 实战截图win/             Windows 客户端截图（6 张）
│   ├── autodemo/               自动 Demo 输出截图（6 张）
│   ├── 抓包分析/               Wireshark 截图（2 张）
│   └── 实战日志/               服务端日志截图（2 张）
└── video/
    └── battle_demo.mov          完整对战录屏（489MB）
```

---

## 七、现场演示方案

> 策略：**录屏单独放 + 截图整合进 PPT + 口述解说**，避免现场网络/环境翻车。

### 演示流程

| 环节 | 时间 | 内容 | 方式 |
|------|------|------|------|
| 1 | 1 min | 启动服务端 + 两个客户端 | PPT 放服务端终端截图 + macOS/Windows 连接截图 |
| 2 | 2 min | 实时交互过程 | **播放 `demo/video/battle_demo.mov`**（创建房间→战斗→结算） |
| 3 | 1 min | 服务端日志展示 | PPT 放 `实战日志/events1_real.png` + `events2_real.png`，标注关键事件 |
| 4 | 1 min | 协议文档中的消息 | PPT 放 `protocol.md` 中 HELLO 消息截图，逐字段标注 |
| 5 | 2 min | 抓包分析 | PPT 放 `抓包分析/wireshark-stream.png` + `wireshark-frame.png`，标注帧结构 |

### 口述逐字稿

**环节 1**：「我们的系统采用 C/S 架构。服务端基于 Python asyncio 实现，监听 TCP 9000 端口。两个客户端是基于 Electron 的桌面应用，通过 AIAWD/1.0 自定义协议连接服务端。左边是 macOS，右边是 Windows，展示了跨平台能力。」

**环节 2**：「请看录屏——房主创建房间后，服务端立即广播 ROOM_UPDATE。队友加入后，双方都能实时看到对方的准备状态。比赛开始后，PHASE_SYNC 每 5 秒同步阶段，RANKING_UPDATE 在每次 Flag 提交后实时刷新排名。注意这里 Alice 攻陷了 Bob 的靶机，得分+100，排名立即变化。服务端是所有状态的唯一权威来源。」

**环节 3**：「这是服务端 JSONL 格式事件日志。可以看到完整的生命周期：SERVER_STARTED → CLIENT_CONNECTED → ROOM_CREATED → ROOM_JOINED → MATCH_STARTED → FLAG_SUBMITTED。特别注意这里——67 次 Flag 提交中，INVALID_PHASE 19 次、INVALID_FLAG 32 次、SELF_FLAG 2 次、DUPLICATE_FLAG 13 次，只有 1 次 OK。充分展示了系统异常处理能力。」

**环节 4**：「这是我们自定义协议 AIAWD/1.0 的消息结构。每条消息都是 JSON 对象。以 HELLO 为例：v=1 表示协议版本，type=HELLO 表示握手，payload 携带 display_name、platform、capabilities。seq 配合 client_id 实现幂等去重。共定义了 28 种消息类型，覆盖握手、心跳、房间管理、比赛控制、Flag 提交全流程。」

**环节 5**：「这是 Wireshark 抓包分析。每帧前 4 字节是大端长度前缀，后续是 UTF-8 JSON 明文。Follow TCP Stream 能看到完整交互序列。特别注意广播扇出——同一条 RANKING_UPDATE 被服务端同时写入多个客户端的 TCP stream，保证所有人看到的状态一致。」

---

## 八、实验报告（report.pdf）框架

> ⚠️ 在写报告之前，请先确保上述「方法 B」已执行完毕，截图和录屏素材齐全。

### 第 1 章：系统总体架构（约 2 页）

**需要包含**：
- 架构图（画一个方框图：服务端居中，左边 Electron 客户端，右边 Python Demo 客户端，底部 Wireshark）
- 技术栈表格：Python asyncio / Electron / Node.js / Docker / tcpdump / Wireshark
- 项目目录结构（从 README 尾部复制）

**素材准备**：无特殊要求，文字为主。

### 第 2 章：客户端/服务端分工（约 2 页）

**需要包含**：
- 服务端职责清单：房间管理 / 阶段调度 / Flag 生成与 SHA-256 校验 / 计分仲裁 / 广播
- 客户端职责清单：连接服务端 / UI 展示 / Agent 执行 / Flag 提交上报 / 靶机生命周期管理
- 服务端权威原则说明：「客户端只执行不决策，服务端仲裁所有结果」

**素材准备**：`src/server/aiawd_server/` 目录下模块列表，`src/client/` 下 JavaScript 文件列表。

### 第 3 章：自定义协议设计（约 4-5 页，核心章节）

**需要包含**：
- **3.1 消息格式**：4B 长度头 + JSON body 的帧结构图；Python 和 Node.js 构造代码示例；最大帧长 1MB
- **3.2 消息类型**：28 种消息的分类表（握手/心跳/浏览/房间/比赛/计分/准备/活动/事件/错误）
- **3.3 字段含义**：逐字段表（v / type / seq / client_id / room_id / role / ts / payload），附一条 HELLO 消息实例
- **3.4 状态变化规则**：LOBBY → PREPARE → DEFENSE → ATTACK → FINISHED 阶段图 + 各阶段允许操作矩阵
- **3.5 错误处理方式**：9 种错误码表 + 错误消息格式示例 + 幂等性说明

**素材准备**：直接引用 `protocol.md` 内容。本仓库的 protocol.md 已经写好了所有 5 个子章节，直接复制粘贴即可。

### 第 4 章：服务端状态维护方式（约 2 页）

**需要包含**：
- 核心数据结构：`Room` / `RoomMember` / `Match` / `Session` / `FlagRecord` / `Submission`（引用 `models.py`）
- 阶段调度器：`_run_phase_schedule()` 的工作流程（asyncio.create_task → sleep → set_phase → broadcast）
- 广播机制：`_broadcast()` 遍历房间内所有成员 session writer
- 计分逻辑：`submit_flag()` 的校验流程（哈希比对 → 自攻检查 → 重复检查 → 计分 → 广播排名）

**素材准备**：可贴相关代码片段（5-10 行即可），不需要贴整个文件。

### 第 5 章：并发处理方式（约 1-2 页）

**需要包含**：
- `asyncio.start_server` 的每连接协程模型
- `_handle_client()` 中的 `try/except` 连接生命周期管理
- 多房间并行：每个房间有独立的 `MatchEngine` 实例和 `_phase_tasks`
- 独立阶段调度：`asyncio.create_task(_run_phase_schedule(room_id))`

**素材准备**：`tcp_gateway.py` 中 `_handle_client()` 和 `_run_phase_schedule()` 的关键代码段。

### 第 6 章：异常情况处理（约 2-3 页）

**需要包含**：
- **6.1 协议层异常**：非法 JSON → BAD_REQUEST、HELLO 缺失 → BAD_REQUEST、超长帧 → 拒绝 + 不关闭连接
- **6.2 业务层异常**：阶段错误 → INVALID_PHASE、权限不足 → INVALID_ROLE、无效 Flag → INVALID_FLAG、房间满 → ROOM_FULL
- **6.3 连接层异常**：TCP 断开 → 标记 DISCONNECTED + 广播 ROOM_UPDATE；心跳超时 60s → 客户端主动断开；IncompleteReadError/BrokenPipeError → 静默关闭
- **6.4 调度器崩溃**：`PHASE_SCHEDULER_ERROR` → 强制切 FINISHED + 广播错误事件
- **6.5 幂等性**：`(client_id, seq)` → response 缓存

**素材准备**：`tcp_gateway.py` 和 `match_engine.py` 中的错误处理分支代码。

### 第 7 章：抓包分析结果（约 3-4 页，核心章节）

**需要包含**：
- **7.1 抓包方法**：使用的命令（tcpdump -i lo0 -w captures/xxx.pcap 'tcp port 9000'）
- **7.2 Wireshark Follow TCP Stream 分析**：附图 ⑧，标注 HELLO → WELCOME → CREATE_ROOM → JOIN → START → PHASE_SYNC → SUBMIT → RANKING 的完整帧序列
- **7.3 单帧结构分析**：附图 ⑨，标注前 4 字节长度头（0x000000XX）和后继 UTF-8 JSON body，给出字段对照表
- **7.4 广播扇出分析**：附图 ⑩，对比 3 个 TCP stream 中同一条 RANKING_UPDATE 消息，说明 _broadcast() 的工作方式
- **7.5 结论**：协议帧定界精确（长度前缀），内容完全明文可读（UTF-8 JSON），单播/广播机制清晰可辨

**素材准备**：需要先完成方法 B 的 Wireshark 操作（见第五章），截好 3 张图。

### 第 8 章：测试过程与运行截图（约 3-4 页）

**需要包含**：
- **8.1 自动化测试**：Python 54 个测试通过 + Node 80 个测试通过的终端截图（运行 `bash extras/scripts/demo.sh --tcp-only` 截最后输出）
- **8.2 人工测试流程**：按方法 B 的步骤 1-10，每步配上对应的截图（①-⑥）
- **8.3 日志验证**：截图 ⑦ — 终端日志输出，标注关键事件
- **8.4 Wireshark 验证**：截图 ⑧⑨⑩ — 抓包分析三张图

**素材准备**：需要先运行自动化测试截图 + 完成方法 B 的 10 张截图。

### 第 9 章：项目不足与改进方向（约 1 页）

**建议写**：
- 当前协议为明文 JSON 传输，无 TLS 加密——生产环境应加 TLS
- 靶机依赖 Docker Desktop，对部分学生环境不够友好——可改为纯 Python HTTP server
- 自动 Demo 客户端的 Agent 是 mock（echo），未接入真实 LLM——后续可对接 API
- 缺少自动化性能/压力测试——未测量高并发下的延迟和吞吐
- 可扩展：Agent SDK、自定义靶机 marketplace、Web 管理面板

---

## 九、操作速查卡

```bash
# ── 自动 Demo（1 条命令，日志+pcap 同时生成）──
PYTHONPATH=server python3 extras/capture_demo.py

# ── 人工实战（15min）──
bash extras/scripts/start-server.sh --lan          # 服务端
cd client && npx electron .                        # 你+队友各开一个
# → 连接→创建→加入→准备→开始→战斗→结束

# ── Wireshark 分析 ──
open -a Wireshark captures/aiawd_capture_*.pcap
# Filter: tcp.port == 9000 → 右键 Follow TCP Stream

# ── 自动化测试（验证代码完整性）──
bash extras/scripts/demo.sh --tcp-only
```

---

## 十、提交前最终检查清单

| # | 项目 | 位置 | 状态 |
|---|------|------|------|
| 1 | 源代码 | `src/` | ✅ |
| 2 | README | `README.md` | ✅ |
| 3 | 协议文档 | `protocol.md` | ✅ |
| 4 | 服务端日志 | `logs/server/events.jsonl` | 运行 capture_demo.py 或人工对战后生成 |
| 5 | 抓包文件 | `captures/aiawd_capture_*.pcap` | 运行 capture_demo.py 自动生成 |
| 6 | 截图（10 张） | `demo/screenshots/` | 人工对战 + Wireshark 截取 |
| 7 | 录屏（1 段） | `demo/video/battle_demo.mov` | QuickTime 录制 |
| 8 | 实验报告 | `report.pdf` | 按第八章框架撰写 |
| 9 | 演示脚本 | `demo/demo_script.md` | ✅ |
