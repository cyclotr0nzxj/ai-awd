# AIAWD/1.0 协议规格说明

> AI-AWD Arena 自定义应用层协议。服务端与客户端通过 TCP 长连接通信，使用二进制帧封装 JSON 消息体。

---

## 1. 传输层

| 项目 | 说明 |
|------|------|
| 传输协议 | TCP |
| 默认端口 | `9000` |
| 连接模型 | 长连接（单 TCP 连接承载全部消息） |
| 字符编码 | UTF-8 |
| 并发模型 | 服务端 `asyncio` 每连接一个协程，客户端 `EventEmitter` |

---

## 2. 帧格式

```
┌──────────────────┬──────────────────────────────┐
│  4 字节 (大端)    │      可变长度 (UTF-8 JSON)     │
│    Frame Length  │         Message Body          │
└──────────────────┴──────────────────────────────┘
```

- **长度前缀**：4 字节无符号整数，大端字节序（`>I`），表示 Body 的字节数
- **最大帧长**：`1,048,576` 字节（1 MB）
- **Body**：UTF-8 编码的 JSON 对象，不允许 JSON 数组或裸值
- **粘包/半包处理**：`FrameDecoder` 状态机累积字节流，完整一帧即解析，不足则等待，超出最大长度则协议错误

### 示例（Python 构造）

```python
import struct, json
body = json.dumps({"v":1,"type":"PING","seq":1,"payload":{}}).encode()
frame = struct.pack(">I", len(body)) + body
```

### 示例（Wireshark 观察）

在 Wireshark 中，每条 AIAWD 消息显示为一段 TCP payload：前 4 字节是可读的长度值，随后是明文的 JSON 文本。

---

## 3. 消息结构

每条消息均为一个 JSON 对象，包含以下字段：

| 字段 | 类型 | 必填 | 方向 | 含义 |
|------|------|------|------|------|
| `v` | int | 是 | 双向 | 协议版本号，当前固定为 `1` |
| `seq` | int \| null | 否 | 双向 | 消息序列号。客户端递增；服务端回传对应请求的 `seq`。配合 `client_id` 实现幂等去重 |
| `type` | string | 是 | 双向 | 消息类型标识符（见第 4 节） |
| `client_id` | string \| null | 否 | 双向 | 发送方客户端 ID。`HELLO` 之前为 null，`WELCOME` 后由服务端分配 |
| `room_id` | string \| null | 否 | 双向 | 房间 ID。房间作用域消息必填 |
| `role` | string \| null | 否 | 双向 | 发送方角色：`"player"` 或 `"spectator"` |
| `ts` | float \| null | 否 | 双向 | Unix 时间戳（秒）。缺省时由接收方补填当前时间 |
| `payload` | object | 是 | 双向 | 消息载荷，始终为 JSON 对象（不可为数组/null/标量） |

---

## 4. 消息类型总表

### 4.1 连接与握手

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `HELLO` | C→S | 客户端 TCP 连接建立后立即发送 | `WELCOME` |
| `WELCOME` | S→C | 服务端收到合法 `HELLO` | — |
| `PING` | C→S | 每 30 秒心跳 | `PONG` |
| `PONG` | S→C | 收到 `PING` | — |
| `BYE` | C→S | 客户端主动断开 | `BYE` (回执) |

**HELLO payload**：

| 字段 | 类型 | 含义 |
|------|------|------|
| `display_name` | string | 客户端显示名称 |
| `platform` | string | 操作系统（`darwin`/`win32`/`linux`） |
| `capabilities` | string[] | 能力列表，如 `["player","spectator"]` |

**WELCOME payload**：

| 字段 | 类型 | 含义 |
|------|------|------|
| `client_id` | string | 服务端分配的唯一客户端 ID，格式 `client_XXXX` |
| `server` | string | 服务端标识，固定 `"ai-awd-arena"` |

### 4.2 大厅浏览

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `LIST_ROOMS_REQ` | C→S | 客户端请求房间列表 | `LIST_ROOMS_RES` |
| `LIST_ROOMS_RES` | S→C | 服务端返回房间列表 | — |
| `LIST_TARGETS_REQ` | C→S | 客户端请求靶机模板列表 | `LIST_TARGETS_RES` |
| `LIST_TARGETS_RES` | S→C | 服务端返回靶机模板列表 | — |

### 4.3 房间管理

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `CREATE_ROOM_REQ` | C→S | 客户端创建房间 | `CREATE_ROOM_RES` |
| `CREATE_ROOM_RES` | S→C | 房间创建成功 | — |
| `JOIN_ROOM_REQ` | C→S | 客户端加入房间（player/spectator） | `JOIN_ROOM_RES` |
| `JOIN_ROOM_RES` | S→C | 加入成功 | — |
| `ROOM_UPDATE` | S→所有 | 任何成员加入/离开/状态变化时广播 | — |

**CREATE_ROOM_REQ payload**：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `room_name` | string | `room_XXX` | 房间名称 |
| `max_players` | int | 2 | 最大参赛人数 |
| `target_template_id` | string | `real_ctf_web_awd_02` | 靶机模板 ID |
| `display_name` | string | — | 创建者在房间内的显示名称 |
| `agent_runtime` | string | `mock-agent` | Agent 运行时 |
| `model_display_name` | string | `mock-model` | 模型显示名称 |
| `api_provider` | string | — | API 厂商 |
| `allow_spectators` | bool | true | 是否允许观战 |
| `phase_seconds` | object | `{prepare:60, defense:300, attack:600}` | 各阶段时长（秒） |

### 4.4 比赛控制

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `START_MATCH_REQ` | C→S | 房主开始比赛（仅 LOBBY 阶段） | `START_MATCH_RES` + 广播 |
| `START_MATCH_RES` | S→C | 比赛开始确认 | — |
| `MATCH_CONFIG` | S→C(单播) | 比赛开始时发给每位玩家 | — |
| `PHASE_SYNC` | S→所有 | 阶段切换时 + 每 5 秒同步 | — |
| `RANKING_UPDATE` | S→所有 | Flag 提交后排名变化时 | — |

**MATCH_CONFIG payload**（每位玩家不同，含私密 Flag）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `match_id` | string | 比赛 ID |
| `team_id` | string | 队伍 ID（`team_a`, `team_b`...） |
| `flag` | string | **私有** — 本方靶机 Flag，格式 `FLAG{room_XXX_team_Y_<random>}` |
| `target_template_id` | string | 靶机模板 ID |
| `local_target` | object | 本方靶机地址（`host`, `port`, `base_url`） |
| `opponents` | array | 对手列表（`team_id`, `base_url`） |
| `allowed_targets` | string[] | 允许攻击的 URL 列表 |
| `target_manifest` | object | 靶机模板元数据（镜像、健康检查等） |
| `target_runtime` | object | 靶机运行时快照（compose 命令、环境变量等） |

### 4.5 Flag 提交

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `SUBMIT_FLAG_REQ` | C→S | 客户端提交 Flag（仅 ATTACK 阶段） | `SUBMIT_FLAG_RES` |
| `SUBMIT_FLAG_RES` | S→C | Flag 校验结果 | — |

**SUBMIT_FLAG_REQ payload**：

| 字段 | 类型 | 含义 |
|------|------|------|
| `match_id` | string | 比赛 ID |
| `claimed_target_team_id` | string | 声称的目标队伍 ID |
| `flag` | string | Flag 明文 |
| `source` | string | 来源标识（`electron-ui` / `electron-agent` / `demo`） |

### 4.6 准备状态

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `TARGET_READY` | C→S | 客户端靶机就绪（仅 player） | `TARGET_READY_ACK` + `ROOM_UPDATE` |
| `TARGET_READY_ACK` | S→C | 确认靶机就绪 | — |
| `AGENT_READY` | C→S | 客户端 Agent 就绪（仅 player） | `AGENT_READY_ACK` + `ROOM_UPDATE` |
| `AGENT_READY_ACK` | S→C | 确认 Agent 就绪 | — |

### 4.7 Agent 活动

| 类型 | 方向 | 触发时机 | 响应 |
|------|------|----------|------|
| `AGENT_ACTIVITY` | C→S | Agent 每步操作后上报 | `AGENT_ACTIVITY_ACK` + 广播 `EVENT` |
| `AGENT_ACTIVITY_ACK` | S→C | 确认收到活动上报 | — |

### 4.8 事件与错误

| 类型 | 方向 | 触发时机 |
|------|------|----------|
| `EVENT` | S→所有 | 服务端事件广播（Flag 攻陷/拒绝、Agent 活动等） |
| `ERROR` | S→C | 请求处理失败时的错误响应 |

---

## 5. 阶段状态机

```
  ┌─────────┐
  │  LOBBY  │  房间创建/加入/离开
  └────┬────┘
       │ START_MATCH_REQ（仅房主，≥2 名 player）
       ▼
  ┌──────────┐
  │ PREPARE  │  客户端安装启动 Docker 靶机、配置 Agent
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

### 各阶段允许的操作

| 操作 | LOBBY | PREPARE | DEFENSE | ATTACK | FINISHED |
|------|:-----:|:-------:|:-------:|:------:|:--------:|
| `CREATE_ROOM_REQ` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `JOIN_ROOM_REQ` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `START_MATCH_REQ` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `TARGET_READY` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `AGENT_READY` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `SUBMIT_FLAG_REQ` | ❌ | ❌ | ❌ | ✅ | ❌ |
| `AGENT_ACTIVITY` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `PING` | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 6. 错误处理

### 6.1 错误消息格式

```json
{
  "v": 1,
  "type": "ERROR",
  "seq": <请求的 seq>,
  "client_id": "<client_id>",
  "room_id": "<room_id>",
  "ts": 1234567890.0,
  "payload": {
    "code": "<错误码>",
    "message": "<人类可读的中文描述>"
  }
}
```

### 6.2 错误码表

| 错误码 | HTTP 类比 | 触发条件 |
|--------|-----------|----------|
| `BAD_REQUEST` | 400 | 消息格式非法（非法 JSON、缺少 `type`、字段类型错误、payload 非对象）；不支持的消息类型；未知靶机模板；非房主开始比赛；参赛人数不足；`max_players < 1` |
| `INVALID_ROLE` | 403 | 非 player 执行 player 专属操作（如开始比赛、提交 Flag、标记就绪） |
| `INVALID_PHASE` | 409 | 在错误阶段执行操作（如 LOBBY 以外加入房间、非 ATTACK 阶段提交 Flag） |
| `ROOM_NOT_FOUND` | 404 | 指定的 `room_id` 不存在 |
| `ROOM_FULL` | 409 | 房间玩家已满 |
| `INVALID_FLAG` | 422 | 提交的 Flag 不在服务端已知 Flag 集合中 |
| `SELF_FLAG` | 422 | 提交了自己的 Flag |
| `DUPLICATE_FLAG` | 409 | 该 Flag 已被其他玩家提交过（全局一次性） |
| `PHASE_SCHEDULER_ERROR` | 500 | 阶段调度器内部异常（自动切换 FINISHED 并广播） |

### 6.3 连接异常处理

| 场景 | 服务端行为 | 客户端行为 |
|------|-----------|-----------|
| 客户端 TCP 断开 | 标记 `MemberStatus.DISCONNECTED`，广播 `ROOM_UPDATE`；清除 session writer | `AiawdClient` 发出 `disconnect` 事件 |
| 心跳超时（60s 无数据） | —（服务端被动等待） | 客户端 `_heartbeatTimer` 触发 `timeout` 事件，主动断开 |
| 协议帧错误（超长/非法长度/非法 JSON） | 发送 `ERROR(BAD_REQUEST)`，不关闭连接 | 抛出 `ProtocolError` |
| HELLO 之前发送其他消息 | 发送 `ERROR(BAD_REQUEST, "HELLO is required")` | — |
| `asyncio.IncompleteReadError` / `ConnectionResetError` / `BrokenPipeError` | 静默关闭连接，清理 session | — |
| 阶段调度器崩溃 | 强制切换 FINISHED + 广播 EVENT(ERROR) + 广播 PHASE_SYNC | 收到 FINISHED 后停止 Agent |

### 6.4 幂等性

- 服务端维护 `(client_id, seq)` → `response` 缓存
- 相同 `client_id + seq` 的请求直接返回缓存的响应（不重复执行）
- 客户端按顺序递增 `seq`
- 客户端断线时清除该 client 的所有缓存条目

---

## 7. 心跳机制

```
客户端 (AiawdClient)              服务端 (TCPGateway)
      │                                  │
      │──── PING (每 30s) ──────────────→│
      │←─── PONG ────────────────────────│
      │                                  │
      │  (60s 内无任何消息 → timeout)     │
      │  主动断开连接                     │  (被动等待，无服务端超时断线)
```

- PING 间隔：30 秒
- 超时判定：客户端 60 秒内未收到任何消息即断开（由 `_heartbeatTimer` 驱动）
- 收到任意消息（包括广播）均重置超时计时器

---

## 8. 广播机制

服务端通过 `_broadcast()` 向房间内所有成员（包括 player 和 spectator）发送消息。广播消息类型：

| 广播类型 | 触发时机 | 接收方 |
|----------|----------|--------|
| `ROOM_UPDATE` | 成员加入/离开/状态变化/准备状态变化 | 所有房间成员 |
| `PHASE_SYNC` | 阶段切换时 + 每 5 秒定时同步 | 所有房间成员 |
| `RANKING_UPDATE` | Flag 提交后排名变化 | 所有房间成员 |
| `EVENT` | Flag 攻陷/拒绝、Agent 活动 | 所有房间成员 |

**注意**：`MATCH_CONFIG` 是**单播**（per-client），每位玩家收到的 config 包含自己独有的 Flag 和对手地址，其他成员不可见。

---

## 9. 关键交互时序

### 9.1 完整比赛生命周期

```
 Alice (房主)            Server              Bob (玩家)           Carol (观战)
      │                     │                     │                     │
      │──HELLO─────────────→│←────HELLO───────────│←────HELLO───────────│
      │←─WELCOME────────────│─────WELCOME────────→│─────WELCOME────────→│
      │                     │                     │                     │
      │──CREATE_ROOM_REQ───→│                     │                     │
      │←─CREATE_ROOM_RES────│                     │                     │
      │                     │──ROOM_UPDATE───────→│                     │
      │                     │──ROOM_UPDATE───────→│                     │ (Carol 尚未加入房间)
      │                     │                     │                     │
      │                     │←─JOIN_ROOM_REQ──────│                     │
      │←─ROOM_UPDATE────────│──JOIN_ROOM_RES─────→│                     │
      │                     │──ROOM_UPDATE───────→│                     │
      │                     │                     │                     │
      │                     │                     │←─JOIN_ROOM_REQ(spec)│
      │←─ROOM_UPDATE────────│──ROOM_UPDATE───────→│                     │
      │                     │──JOIN_ROOM_RES─────→│                     │ (Carol)
      │                     │──ROOM_UPDATE───────→│                     │
      │                     │                     │                     │
      │──START_MATCH_REQ───→│                     │                     │
      │←─START_MATCH_RES────│                     │                     │
      │←─MATCH_CONFIG(A)────│──MATCH_CONFIG(B)───→│                     │
      │←─PHASE_SYNC(PREP)───│──PHASE_SYNC(PREP)──→│──PHASE_SYNC(PREP)──→│
      │                     │                     │                     │
      │  ... 阶段自动推进 ...│                     │                     │
      │                     │                     │                     │
      │←─PHASE_SYNC(ATTACK)─│──PHASE_SYNC(ATTACK)→│──PHASE_SYNC(ATTACK)→│
      │──SUBMIT_FLAG_REQ───→│                     │                     │
      │←─SUBMIT_FLAG_RES────│                     │                     │
      │←─EVENT(FLAG_CAPTUR)─│──EVENT(FLAG_CAPTUR)→│──EVENT(FLAG_CAPTUR)→│
      │←─RANKING_UPDATE─────│──RANKING_UPDATE────→│──RANKING_UPDATE────→│
      │                     │                     │                     │
      │  ... 比赛结束 ...    │                     │                     │
      │←─PHASE_SYNC(FINISH)─│──PHASE_SYNC(FINISH)→│──PHASE_SYNC(FINISH)→│
      │←─RANKING_UPDATE─────│──RANKING_UPDATE────→│──RANKING_UPDATE────→│
```

### 9.2 错误处理时序

```
 Client                   Server
    │                        │
    │──非 JSON 数据──────────→│
    │←─ERROR(BAD_REQUEST)────│
    │   "Invalid JSON body"  │
    │                        │
    │──HELLO────────────────→│
    │←─WELCOME───────────────│
    │                        │
    │──SUBMIT_FLAG_REQ──────→│  (未加入房间)
    │←─ERROR(ROOM_NOT_FOUND)─│
    │                        │
    │──JOIN_ROOM_REQ────────→│
    │←─JOIN_ROOM_RES─────────│
    │   ... 比赛开始 ...      │
    │                        │
    │──SUBMIT_FLAG_REQ──────→│  (DEFENSE 阶段)
    │←─SUBMIT_FLAG_RES───────│
    │   {ok:false, code:     │
    │    "INVALID_PHASE"}    │
    │                        │
    │ (TCP 断开)             │
    │                        │──ROOM_UPDATE────────→ 其他客户端
    │                        │  (status:DISCONNECTED)
```

---

## 10. Flag 安全设计

| 措施 | 说明 |
|------|------|
| 服务端生成 | Flag 由 `MatchEngine.start_match()` 使用 `secrets.token_hex(8)` 生成 |
| SHA-256 存储 | 服务端仅存储 Flag 的 SHA-256 哈希用于比对，不存储明文 |
| 单播下发 | 每位玩家仅收到自己的 Flag（通过 `MATCH_CONFIG` 单播） |
| 全局一次性 | 每个 Flag 被成功提交一次后即标记已用，拒绝重复提交 |
| 禁止自攻 | 提交自己队伍的 Flag 返回 `SELF_FLAG` 错误 |
| UI 脱敏 | 所有 `FLAG{...}` 在 UI/日志/截图中显示为 `FLAG{已隐藏}` |
| 日志脱敏 | `log_store.py` 不记录 Flag 明文；HTTP API 递归脱敏 `flag`/`flag_plaintext`/`AIAWD_FLAG` 字段 |

---

## 11. 抓包分析指引

见 [抓包分析指南](./抓包分析指南.md)。使用 tcpdump + Wireshark 可清晰观察：

1. 4 字节大端长度前缀 → 每帧起始位置
2. UTF-8 JSON 明文 body → 所有消息内容可读
3. 完整的房间生命周期（HELLO→CREATE→JOIN→START→MATCH_CONFIG→PHASE_SYNC→SUBMIT→RANKING）
4. 服务端广播的扇出模式（同一消息发往多个客户端）

---

## 附录 A：消息类型速查

| 类型 | 方向 | 类别 |
|------|------|------|
| `HELLO` | C→S | 握手 |
| `WELCOME` | S→C | 握手 |
| `PING` | C→S | 心跳 |
| `PONG` | S→C | 心跳 |
| `BYE` | 双向 | 断开 |
| `LIST_ROOMS_REQ` | C→S | 浏览 |
| `LIST_ROOMS_RES` | S→C | 浏览 |
| `LIST_TARGETS_REQ` | C→S | 浏览 |
| `LIST_TARGETS_RES` | S→C | 浏览 |
| `CREATE_ROOM_REQ` | C→S | 房间 |
| `CREATE_ROOM_RES` | S→C | 房间 |
| `JOIN_ROOM_REQ` | C→S | 房间 |
| `JOIN_ROOM_RES` | S→C | 房间 |
| `ROOM_UPDATE` | S→所有 | 广播 |
| `START_MATCH_REQ` | C→S | 比赛 |
| `START_MATCH_RES` | S→C | 比赛 |
| `MATCH_CONFIG` | S→C | 比赛 |
| `PHASE_SYNC` | S→所有 | 广播 |
| `SUBMIT_FLAG_REQ` | C→S | 计分 |
| `SUBMIT_FLAG_RES` | S→C | 计分 |
| `RANKING_UPDATE` | S→所有 | 广播 |
| `TARGET_READY` | C→S | 准备 |
| `TARGET_READY_ACK` | S→C | 准备 |
| `AGENT_READY` | C→S | 准备 |
| `AGENT_READY_ACK` | S→C | 准备 |
| `AGENT_ACTIVITY` | C→S | 活动 |
| `AGENT_ACTIVITY_ACK` | S→C | 活动 |
| `EVENT` | S→所有 | 广播 |
| `ERROR` | S→C | 错误 |
