# AIAWD/1.0 协议设计文档

> AI-AWD Arena 自定义应用层协议。服务端与客户端通过 TCP 长连接通信，使用二进制帧封装 JSON 消息体。
>
> 符合课程要求中关于"自定义协议格式"的全部说明项：消息格式、消息类型、字段含义、状态变化规则、错误处理方式。
>
> 完整规格详见 `extras/docs/AIAWD协议规格说明.md`，抓包分析指南详见 `extras/docs/抓包分析指南.md`。

---

## 一、协议概述

| 项目 | 说明 |
|------|------|
| **协议名称** | AIAWD/1.0 |
| **传输层** | TCP |
| **默认端口** | 9000 |
| **连接模型** | 长连接（单 TCP 连接承载全部消息） |
| **编码** | UTF-8 |
| **并发模型** | 服务端 `asyncio`（每连接一个协程），客户端 `EventEmitter` |

---

## 二、消息格式

### 2.1 帧结构

```
┌──────────────────┬──────────────────────────────┐
│  4 字节 (大端)    │      可变长度 (UTF-8 JSON)     │
│    Frame Length  │         Message Body          │
└──────────────────┴──────────────────────────────┘
```

- **长度前缀**：4 字节无符号整数，大端字节序（`>I`），表示 Body 的字节数
- **最大帧长**：1,048,576 字节（1 MB）
- **Body**：UTF-8 编码的 JSON 对象（不允许数组或裸值）
- **粘包/半包处理**：`FrameDecoder` 状态机累积字节流，完整一帧解析，不足等待，超长报协议错误

### 2.2 构造示例

```python
# Python
import struct, json
body = json.dumps({"v":1,"type":"PING","seq":1,"payload":{}}).encode()
frame = struct.pack(">I", len(body)) + body
```

```javascript
// Node.js
const body = Buffer.from(JSON.stringify({ v:1, type:"PING", seq:1, payload:{} }), "utf8");
const header = Buffer.alloc(4);
header.writeUInt32BE(body.length, 0);
const frame = Buffer.concat([header, body]);
```

---

## 三、消息结构（字段含义）

每条消息为 JSON 对象，包含以下字段：

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| `v` | int | 是 | 协议版本号，固定 `1` |
| `type` | string | 是 | 消息类型标识符（见下方消息类型表） |
| `seq` | int \| null | 否 | 消息序列号。客户端递增；配合 `client_id` 实现幂等去重 |
| `client_id` | string \| null | 否 | 客户端 ID。HELLO 前为 null，WELCOME 后由服务端分配 |
| `room_id` | string \| null | 否 | 房间 ID。房间作用域消息必填 |
| `role` | string \| null | 否 | 角色：`"player"` 或 `"spectator"` |
| `ts` | float \| null | 否 | Unix 时间戳（秒），缺省时接收方补填 |
| `payload` | object | 是 | 消息载荷，始终为 JSON 对象 |

### 示例消息

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

---

## 四、消息类型

### 4.1 连接与握手
| 类型 | 方向 | 说明 |
|------|------|------|
| `HELLO` | C→S | 连接后立即发送，携带 display_name、platform、capabilities |
| `WELCOME` | S→C | 分配 client_id |
| `PING` | C→S | 每 30s 心跳 |
| `PONG` | S→C | 心跳响应 |
| `BYE` | 双向 | 主动断开 |

### 4.2 大厅浏览
| 类型 | 方向 | 说明 |
|------|------|------|
| `LIST_ROOMS_REQ/RES` | C→S / S→C | 查询房间列表 |
| `LIST_TARGETS_REQ/RES` | C→S / S→C | 查询靶机模板列表 |

### 4.3 房间管理
| 类型 | 方向 | 说明 |
|------|------|------|
| `CREATE_ROOM_REQ/RES` | C→S / S→C | 创建房间（含房间名、最大人数、靶机模板、阶段时长） |
| `JOIN_ROOM_REQ/RES` | C→S / S→C | 加入房间（player 或 spectator） |
| `ROOM_UPDATE` | S→**所有** | 成员加入/离开/状态变化时广播 |

### 4.4 比赛控制
| 类型 | 方向 | 说明 |
|------|------|------|
| `START_MATCH_REQ/RES` | C→S / S→C | 房主开始比赛（≥2 名 player） |
| `MATCH_CONFIG` | S→C（**单播**） | 比赛配置，含私有 Flag、对手地址、允许目标列表 |
| `PHASE_SYNC` | S→**所有** | 阶段切换 + 每 5s 定时同步 |
| `RANKING_UPDATE` | S→**所有** | Flag 提交后排名刷新 |

### 4.5 Flag 提交
| 类型 | 方向 | 说明 |
|------|------|------|
| `SUBMIT_FLAG_REQ/RES` | C→S / S→C | 提交 Flag（仅 ATTACK 阶段有效） |

### 4.6 准备与活动
| 类型 | 方向 | 说明 |
|------|------|------|
| `TARGET_READY` / `AGENT_READY` | C→S | 标记靶机/Agent 就绪 |
| `AGENT_ACTIVITY` | C→S | Agent 操作步骤上报，广播为 EVENT |

### 4.7 事件与错误
| 类型 | 方向 | 说明 |
|------|------|------|
| `EVENT` | S→**所有** | 事件广播（FLAG_CAPTURED / FLAG_REJECTED / AGENT_ACTIVITY 等） |
| `ERROR` | S→C | 错误响应（携带 code + message） |

---

## 五、状态变化规则（阶段状态机）

```
  ┌─────────┐
  │  LOBBY  │  创建/加入/离开房间
  └────┬────┘
       │ START_MATCH_REQ（仅房主，≥2 名 player）
       ▼
  ┌──────────┐
  │ PREPARE  │  安装启动 Docker 靶机、配置 Agent
  └────┬─────┘
       │ 阶段超时 → 自动切换
       ▼
  ┌──────────┐
  │ DEFENSE  │  Agent 防守循环（扫描自身靶机）
  └────┬─────┘
       │ 阶段超时 → 自动切换
       ▼
  ┌──────────┐
  │  ATTACK  │  Agent 攻击循环 + SUBMIT_FLAG_REQ 生效
  └────┬─────┘
       │ 阶段超时 → 自动切换
       ▼
  ┌──────────┐
  │ FINISHED │  最终排名广播，禁止任何操作
  └──────────┘
```

各阶段允许的操作矩阵：

| 操作 | LOBBY | PREPARE | DEFENSE | ATTACK | FINISHED |
|------|:-----:|:-------:|:-------:|:------:|:--------:|
| CREATE_ROOM / JOIN_ROOM / START_MATCH | ✅ | ❌ | ❌ | ❌ | ❌ |
| TARGET_READY / AGENT_READY | ❌ | ✅ | ✅ | ✅ | ❌ |
| SUBMIT_FLAG_REQ | ❌ | ❌ | ❌ | ✅ | ❌ |
| PING | ✅ | ✅ | ✅ | ✅ | ✅ |

**服务端权威**：阶段切换由服务端 `_run_phase_schedule()` 自动驱动，客户端被动接收 `PHASE_SYNC` 广播。客户端不能自行决定或修改阶段状态。

---

## 六、错误处理方式

### 6.1 错误消息格式

```json
{
  "v": 1,
  "type": "ERROR",
  "seq": 1,
  "client_id": "client_0001",
  "room_id": "room_001",
  "ts": 1716500000.0,
  "payload": {
    "code": "BAD_REQUEST",
    "message": "HELLO is required before other messages"
  }
}
```

### 6.2 错误码表

| 错误码 | 含义 | 触发条件 |
|--------|------|----------|
| `BAD_REQUEST` | 请求格式非法 | 非法 JSON、缺少 type、不支持的消息类型、非房主开始比赛、人数不足 |
| `INVALID_ROLE` | 权限不足 | 非 player 执行 player 专属操作 |
| `INVALID_PHASE` | 阶段错误 | 在错误阶段执行操作（如非 ATTACK 提交 Flag） |
| `ROOM_NOT_FOUND` | 房间不存在 | room_id 无效 |
| `ROOM_FULL` | 房间已满 | 玩家数量已达上限 |
| `INVALID_FLAG` | Flag 无效 | 提交的 Flag 不在已知集合中 |
| `SELF_FLAG` | 自攻 | 提交自己的 Flag |
| `DUPLICATE_FLAG` | 重复提交 | Flag 已被其他玩家提交（全局一次性） |
| `PHASE_SCHEDULER_ERROR` | 调度器异常 | 阶段调度器内部崩溃 → 强制切 FINISHED |

### 6.3 连接异常

| 场景 | 处理 |
|------|------|
| 客户端 TCP 断开 | 标记 DISCONNECTED，广播 ROOM_UPDATE |
| 心跳超时 60s | 客户端主动断开 |
| 协议帧错误 | ERROR(BAD_REQUEST)，不关闭连接 |
| asyncio 异常 (IncompleteRead / ConnectionReset / BrokenPipe) | 静默关闭，清理 session |

### 6.4 幂等性

服务端维护 `(client_id, seq) → response` 缓存，相同请求直接返回缓存结果（不重复执行）。客户端断线时清除该客户端全部缓存。

---

## 七、抓包分析

使用 **tcpdump + Wireshark** 分析 AIAWD/1.0 协议的完整交互过程。

### 快速抓包

```bash
# 一键抓包脚本
bash captures/capture.sh

# 或手动 tcpdump
sudo tcpdump -i lo0 -w captures/aiawd_match.pcap -s 0 'tcp port 9000'
```

### Wireshark 分析要点

1. **帧结构**：每条消息的前 4 字节为大端长度头，随后是 UTF-8 JSON
2. **明文可读**：所有 JSON 明文传输，Follow TCP Stream 可看到完整对话
3. **广播扇出**：同一 RANKING_UPDATE 消息写入房间内所有成员的 TCP stream
4. **单播标志**：MATCH_CONFIG 每个客户端内容不同（含私有 Flag）

### 详细指南

见 `extras/docs/抓包分析指南.md` — 包含完整的 Wireshark 操作流程、帧格式逐字节分析、交互时序标注、及实验报告素材清单。

---

## 八、附录：消息类型速查

| 类型 | 方向 | 类别 | | 类型 | 方向 | 类别 |
|------|------|------|---|------|------|------|
| `HELLO` | C→S | 握手 | | `WELCOME` | S→C | 握手 |
| `PING` | C→S | 心跳 | | `PONG` | S→C | 心跳 |
| `BYE` | 双向 | 断开 | | `ERROR` | S→C | 错误 |
| `LIST_ROOMS_REQ` | C→S | 浏览 | | `LIST_ROOMS_RES` | S→C | 浏览 |
| `LIST_TARGETS_REQ` | C→S | 浏览 | | `LIST_TARGETS_RES` | S→C | 浏览 |
| `CREATE_ROOM_REQ` | C→S | 房间 | | `CREATE_ROOM_RES` | S→C | 房间 |
| `JOIN_ROOM_REQ` | C→S | 房间 | | `JOIN_ROOM_RES` | S→C | 房间 |
| `ROOM_UPDATE` | S→所有 | 广播 | | `START_MATCH_REQ` | C→S | 比赛 |
| `START_MATCH_RES` | S→C | 比赛 | | `MATCH_CONFIG` | S→C | 比赛 |
| `PHASE_SYNC` | S→所有 | 广播 | | `RANKING_UPDATE` | S→所有 | 广播 |
| `SUBMIT_FLAG_REQ` | C→S | 计分 | | `SUBMIT_FLAG_RES` | S→C | 计分 |
| `TARGET_READY` | C→S | 准备 | | `AGENT_READY` | C→S | 准备 |
| `AGENT_ACTIVITY` | C→S | 活动 | | `EVENT` | S→所有 | 广播 |
