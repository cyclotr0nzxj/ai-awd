# AI-AWD Arena — 现场演示操作脚本

> 本文件供现场演示时逐步执行，覆盖课程要求的全部 5 项演示内容。
>
> **预计总耗时：8-10 分钟**（不含人工对战时长）

---

## 演示前准备清单

| 检查项 | 命令 / 方法 |
|--------|------------|
| Python 3.11+ 可用 | `python3 --version` |
| Node.js 可用（用 Electron 客户端时需要） | `node --version` |
| tcpdump 可用 | `which tcpdump` |
| Wireshark 已安装 | `open -a Wireshark` 或菜单检查 |
| 仓库已克隆 | `ls ai-awd/server/aiawd_server/main.py` |
| 两个客户端就绪 | 你和队友各一台电脑，或同一台开两个 Electron 窗口 |

---

## 演示流程（5 个环节）

### 环节 1：启动服务端和两个客户端

**操作步骤：**

```bash
# —— 终端 1：启动服务端 ——
cd ai-awd
PYTHONPATH=server python3 -m aiawd_server.main --host 0.0.0.0 --port 9000 --http-port 9001

# 预期输出：
# AI-AWD Arena TCP server listening on 0.0.0.0:9000
# AI-AWD Arena HTTP API listening on 0.0.0.0:9001
```

```bash
# —— 你和队友：各自启动客户端 ——
cd ai-awd/client
npx electron .
```

**口述要点**：
> "服务端基于 Python asyncio 实现，监听 TCP 9000 端口。两个客户端是基于 Electron 的桌面应用，通过 AIAWD/1.0 自定义协议连接服务端。"

---

### 环节 2：两个客户端完成一次实时交互

**操作步骤：**

1. **两个客户端分别在连接页填入服务端地址**（同机器填 `127.0.0.1:9000`，跨机器填服务器 IP），输入名字，点"连接服务器"

2. **房主（Alice）操作**：
   - 在大厅页点击"创建房间"
   - 房间名随意填（如 "演示赛"）
   - 选择地图（推荐 "Web 新手训练靶机"）
   - 格式选"快速"（30s 准备 / 600s 防守 / 1200s 攻击）
   - 点击"创建房间"

3. **队友（Bob）操作**：
   - 在大厅页房间列表中找到刚创建的房间
   - 点击"参赛"

4. **双方各自在房间页点"准备"**（可以先不填 API Key，用 mock-agent 即可）

5. **房主点击"开始大乱斗"** — 系统自动推进阶段

6. **在攻击阶段**：排行榜会实时刷新（因为 mock-agent 会自动攻击提交 Flag）。注意观察得分弹出、攻击路线动画。

**口述要点**：
> "现在我们看到两个客户端通过服务端实现了实时交互：房主创建房间后服务端立即广播 ROOM_UPDATE，队友加入后双方都能看到对方的准备状态。比赛开始后 PHASE_SYNC 每 5 秒同步阶段，RANKING_UPDATE 在每次 Flag 提交后刷新排名。服务端是所有状态的唯一权威来源。"

---

### 环节 3：展示服务端日志记录的关键事件

**操作步骤：**

```bash
# —— 新开终端 ——
cd ai-awd

# 方式 A：实时 tail
tail -f logs/server/events.jsonl

# 方式 B：打印最近 20 条 pretty-print
tail -20 logs/server/events.jsonl | while read line; do echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"; done
```

**口述要点（对着日志逐条解释）**：
> "这条是 SERVER_STARTED — 服务端启动。CLIENT_CONNECTED — Alice 连接，服务端分配了 client_0001。ROOM_CREATED — Alice 创建了房间 room_001。ROOM_JOINED — Bob 加入。MATCH_STARTED — 房主开始比赛，服务端生成 Flag。FLAG_SUBMITTED — Alice 的 Agent 提交了一个 Flag。EVENT FLAG_CAPTURED — 广播给所有人。所有日志都是 JSONL 格式，带时间戳，Flag 自动脱敏。"

---

### 环节 4：展示协议文档中的一条消息

**操作步骤：**

打开 `protocol.md`，翻到第三章的示例消息：

```json
{
  "v": 1,
  "seq": 1,
  "type": "HELLO",
  "client_id": null,
  "room_id": null,
  "role": null,
  "ts": 1716500000.123,
  "payload": {
    "display_name": "Alice",
    "platform": "darwin",
    "capabilities": ["player", "spectator"]
  }
}
```

**口述要点（逐字段解释）**：
> "这是我们自定义协议 AIAWD/1.0 的一条 HELLO 消息，逐字段说明：`v` 是协议版本号，当前固定为 1。`type` 是消息类型标识符 HELLO，表示客户端连接后第一条握手消息。`seq` 是序列号，客户端递增用于幂等去重。`client_id` 此时为 null，因为服务端还没分配。`payload` 里携带 display_name、platform、capabilities——Alice 在 macOS 上连接、支持 player 和 spectator 两种角色。"

---

### 环节 5：使用抓包文件解释一次通信过程

**前提**：你在打比赛时已经用 `tcpdump` 抓了包。

**操作步骤：**

```bash
# 1. 打开 Wireshark
open -a Wireshark captures/aiawd_match_*.pcap

# 2. 或命令行快速演示
tcpdump -r captures/aiawd_match_*.pcap -X -c 5 | head -80
```

**Wireshark 操作：**

1. Filter 输入 `tcp.port == 9000`
2. 右键任意包 → Follow → TCP Stream
3. 在弹窗中展示完整的文本对话

**口述要点（指着一帧解释）**：
> "这是抓包文件中的一条 HELLO 帧。前 4 个字节 `00 00 00 5E` 是大端序的长度值，等于 94，表示后面的 JSON body 是 94 字节。从第 5 字节开始就是明文 UTF-8 JSON，可读性很强。所有 AIAWD 消息都以这种格式封装——4 字节二进制头加 JSON body，兼顾了帧定界的精确性和内容可读性。"

**进一步展示广播扇出**：
> "再看这条 RANKING_UPDATE 消息。在 Wireshark 中可以看到，同一条 payload 被服务端同时写入了 Alice、Bob 的 TCP stream——这就是广播机制。服务端通过 `_broadcast()` 函数遍历房间内所有成员的 session writer，保证了所有人看到的状态一致。"

---

## 异常演示（加分环节，2 分钟）

如果时间允许，可以额外展示异常处理：

```bash
# 演示 1：非法消息 — 连上后不发 HELLO 直接发 PING
echo '{"v":1,"type":"PING","seq":1,"payload":{}}' | nc 127.0.0.1 9000

# 预期响应：
# {"type":"ERROR","payload":{"code":"BAD_REQUEST","message":"HELLO is required before other messages"}}
```

**口述要点**：
> "服务端检测到客户端跳过了 HELLO 握手直接发送 PING，返回 ERROR BAD_REQUEST 并清晰说明原因。连接不会被关闭——客户端可以补发 HELLO 恢复正常通信。"

```bash
# 演示 2：客户端断开
# 关闭一个 Electron 窗口，观察另一个客户端的 ROOM_UPDATE
```

**口述要点**：
> "当客户端 TCP 断开，服务端标记 DISCONNECTED 并立即广播 ROOM_UPDATE，所有其他客户端实时看到该成员离线。"

---

## 截图/录屏清单

| 序号 | 内容 | 用途 | 时机 |
|------|------|------|------|
| ① | 服务端启动终端 | 证明服务端运行 | 环节 1 |
| ② | 两个客户端连接成功 | 证明 C/S 连接 | 环节 1 |
| ③ | 房间页面（双方已准备） | 证明实时状态同步 | 环节 2 |
| ④ | 大乱斗页面（攻击动画 + 排行榜） | 证明实时交互 | 环节 2 |
| ⑤ | 结算页面（排行榜） | 证明完整流程 | 环节 2 |
| ⑥ | 终端日志输出 | 证明日志记录 | 环节 3 |
| ⑦ | protocol.md 文档截图 | 证明协议设计 | 环节 4 |
| ⑧ | Wireshark Follow TCP Stream | 证明抓包分析 | 环节 5 |
| ⑨ | Wireshark 单帧 HEX+JSON 对照 | 证明帧格式分析 | 环节 5 |
| ⑩ | 异常处理终端输出 | 证明异常处理 | 加分环节 |

> 建议用 macOS 自带的 `Cmd+Shift+4` 截图，或用 QuickTime Player → File → New Screen Recording 录屏。

---

## 故障应对

| 问题 | 应对 |
|------|------|
| 服务端端口被占用 | `lsof -i :9000` 找到进程 kill 掉，或换 `--port 9090` |
| Electron 启动白屏 | `cd client && npm install` |
| tcpdump 权限不足 | 前面加 `sudo` |
| 队友连不上 | 检查防火墙、确认服务端监听 `0.0.0.0`、用 `curl http://IP:9001/health` 测试 |
| Wireshark 没抓到 AIAWD | 检查 filter 是否正确、确认 tcpdump 在服务端启动前开始 |
