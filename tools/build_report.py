#!/usr/bin/env python3
"""Build the AI-AWD Arena experiment report PDF.

The project asked for a polished journal-style PDF. The local machine does not
have a TeX engine installed, so this script uses ReportLab while also emitting
Markdown and a LaTeX-oriented source file for later editing.
"""

from __future__ import annotations

import html
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_PDF = ROOT / "report.pdf"
OUT_MD = ROOT / "report_source.md"
OUT_TEX = ROOT / "report.tex"


def register_fonts() -> None:
    songti = Path("/System/Library/Fonts/Supplemental/Songti.ttc")
    heiti = Path("/System/Library/Fonts/STHeiti Medium.ttc")
    if songti.exists():
        pdfmetrics.registerFont(TTFont("AIAWD-Songti", str(songti), subfontIndex=0))
    elif heiti.exists():
        pdfmetrics.registerFont(TTFont("AIAWD-Songti", str(heiti), subfontIndex=0))
    else:
        raise RuntimeError("No embeddable Chinese font found")


FONT = "AIAWD-Songti"
MONO = "Courier"


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName=FONT,
            fontSize=24,
            leading=31,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#101820"),
            spaceAfter=12,
            wordWrap="CJK",
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=11,
            leading=16,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#475569"),
            wordWrap="CJK",
        ),
        "abstract": ParagraphStyle(
            "abstract",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=9.2,
            leading=15,
            alignment=TA_JUSTIFY,
            firstLineIndent=18,
            textColor=colors.HexColor("#172033"),
            wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=9.8,
            leading=15.5,
            alignment=TA_JUSTIFY,
            firstLineIndent=18,
            spaceAfter=5,
            textColor=colors.HexColor("#18212f"),
            wordWrap="CJK",
        ),
        "body_noindent": ParagraphStyle(
            "body_noindent",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=9.8,
            leading=15.5,
            alignment=TA_JUSTIFY,
            firstLineIndent=0,
            spaceAfter=5,
            textColor=colors.HexColor("#18212f"),
            wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName=FONT,
            fontSize=15.5,
            leading=21,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=16,
            spaceAfter=7,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName=FONT,
            fontSize=12.2,
            leading=17,
            textColor=colors.HexColor("#1f3a5f"),
            spaceBefore=10,
            spaceAfter=5,
            wordWrap="CJK",
        ),
        "caption": ParagraphStyle(
            "caption",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=8.4,
            leading=12,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#526173"),
            spaceBefore=5,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=8.2,
            leading=11.5,
            textColor=colors.HexColor("#172033"),
            wordWrap="CJK",
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=8.2,
            leading=11.5,
            textColor=colors.HexColor("#0f172a"),
            wordWrap="CJK",
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=8.2,
            leading=12,
            textColor=colors.HexColor("#526173"),
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "code",
            parent=base["Code"],
            fontName=MONO,
            fontSize=7.2,
            leading=9.3,
            leftIndent=0,
            firstLineIndent=0,
            textColor=colors.HexColor("#111827"),
        ),
    }


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def p(text: str, styles: dict[str, ParagraphStyle], style: str = "body") -> Paragraph:
    return Paragraph(esc(text), styles[style])


def raw(text: str, styles: dict[str, ParagraphStyle], style: str = "body") -> Paragraph:
    return Paragraph(text, styles[style])


def h(text: str, styles: dict[str, ParagraphStyle], level: int = 1) -> Paragraph:
    return Paragraph(esc(text), styles["h1" if level == 1 else "h2"])


def code_block(code: str, styles: dict[str, ParagraphStyle]) -> Table:
    pre = Preformatted(code.strip("\n"), styles["code"], maxLineLength=92)
    table = Table([[pre]], colWidths=[17.2 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f7fb")),
                ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#cbd5e1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def data_table(
    rows: list[list[str]],
    styles: dict[str, ParagraphStyle],
    widths: list[float] | None = None,
    header: bool = True,
) -> Table:
    body = []
    for row_index, row in enumerate(rows):
        cell_style = styles["table_header"] if header and row_index == 0 else styles["table"]
        body.append([Paragraph(esc(cell), cell_style) for cell in row])
    table = Table(body, colWidths=widths, hAlign="LEFT", repeatRows=1 if header else 0)
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d8dee9")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef7")),
                ("LINEBELOW", (0, 0), (-1, 0), 0.65, colors.HexColor("#7c8ba1")),
            ]
        )
    table.setStyle(TableStyle(commands))
    return table


def fig(path: str, caption: str, styles: dict[str, ParagraphStyle], width_cm: float = 17.2) -> KeepTogether:
    img_path = ROOT / path
    reader = ImageReader(str(img_path))
    iw, ih = reader.getSize()
    width = width_cm * cm
    height = width * ih / iw
    if height > 12.4 * cm:
        height = 12.4 * cm
        width = height * iw / ih
    image = Image(str(img_path), width=width, height=height, hAlign="CENTER")
    return KeepTogether([image, Paragraph(esc(caption), styles["caption"])])


def divider(width: float = 17.2 * cm) -> Table:
    table = Table([[""]], colWidths=[width], rowHeights=[1])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#1d4ed8"))]))
    return table


def on_page(canvas, doc) -> None:
    page = canvas.getPageNumber()
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setStrokeColor(colors.HexColor("#d7dde8"))
    canvas.setLineWidth(0.4)
    canvas.line(doc.leftMargin, height - 1.35 * cm, width - doc.rightMargin, height - 1.35 * cm)
    canvas.setFont(FONT, 7.6)
    canvas.setFillColor(colors.HexColor("#526173"))
    if page > 1:
        canvas.drawString(doc.leftMargin, height - 1.08 * cm, "AI-AWD Arena / AIAWD 1.0 实验报告")
        canvas.drawRightString(width - doc.rightMargin, height - 1.08 * cm, "Network Programming Lab")
    canvas.line(doc.leftMargin, 1.18 * cm, width - doc.rightMargin, 1.18 * cm)
    canvas.drawCentredString(width / 2, 0.74 * cm, str(page))
    canvas.restoreState()


def build_story(styles: dict[str, ParagraphStyle]) -> list:
    story: list = []

    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("AI-AWD Arena", styles["title"]))
    story.append(
        Paragraph(
            "基于 AIAWD/1.0 自定义应用层协议的 C/S 联网攻防交互系统实验报告",
            styles["subtitle"],
        )
    )
    story.append(Spacer(1, 0.24 * cm))
    story.append(divider())
    story.append(Spacer(1, 0.45 * cm))
    story.append(
        Paragraph(
            "小组成员：周浩霆、周梓涵、刘晓语、吴彦霖<br/>"
            "课程主题：网络编程实验 - 自定义应用层协议的联网交互系统<br/>"
            "实验对象：Python asyncio 服务端 + Electron 桌面客户端 + Docker 靶机场景<br/>"
            "报告日期：2026-06-16",
            styles["subtitle"],
        )
    )
    story.append(Spacer(1, 0.55 * cm))

    abstract = (
        "本项目实现了一个面向 AI 攻防竞赛的联网交互系统。系统采用 C/S 架构，服务端通过 "
        "Python asyncio 维护房间、比赛阶段、Flag 与计分等权威状态，客户端通过 Electron 桌面应用接入。"
        "通信协议 AIAWD/1.0 运行在 TCP 长连接上，以 4 字节大端长度头封装 UTF-8 JSON 消息体，既能解决 "
        "TCP 粘包/半包，又保留抓包可读性。实验完成了双客户端实时同步、房间广播、私有 MATCH_CONFIG 单播、"
        "服务端裁判式 Flag 校验、异常响应、JSONL 日志与 Wireshark/tcpdump 抓包分析。整体实现不是简单聊天室换皮，"
        "而是把状态机、幂等、阶段调度和攻击事件广播都压到服务端，客户端只负责呈现和发起请求。这个选择有点硬核，"
        "但也正是网络协议实验最该守住的底线：最后结果不能由客户端说了算。"
    )
    story.append(data_table([["摘要", abstract]], styles, widths=[2.0 * cm, 15.2 * cm], header=False))
    story.append(Spacer(1, 0.18 * cm))
    story.append(
        p(
            "关键词：C/S 架构；自定义应用层协议；TCP 长连接；asyncio；Electron；AWD；Wireshark；服务端权威状态",
            styles,
            "small",
        )
    )
    story.append(Spacer(1, 0.35 * cm))
    story.append(fig("demo/screenshots/实战截图win/battle_win.png", "图 1 现场演示中的大乱斗界面：攻击事件、排名和状态在客户端之间实时同步。", styles))
    story.append(PageBreak())

    story.append(h("1. 项目定位与作业要求对照", styles))
    story.append(
        p(
            "AI-AWD Arena 的目标是把传统 AWD 攻防流程做成可联网、可复现、可抓包解释的桌面系统。"
            "它不是只让两个窗口互相发字符串，而是让客户端在同一房间里创建比赛、准备靶机、启动 Agent、提交 Flag，"
            "再由服务端统一裁决和广播结果。我们在实现时把课程检查点拆成协议层、会话层、房间层、比赛层、展示层和证据层六部分；"
            "从实际运行素材看，已经具备服务端程序、至少两个客户端、实时交互、服务端权威状态、并发处理、异常处理、日志、协议文档和抓包文件。"
        ,
            styles,
        )
    )
    story.append(
        data_table(
            [
                ["检查项", "实现位置", "证据"],
                ["独立服务端", "server/aiawd_server/main.py, tcp_gateway.py", "启动终端截图、SERVER_STARTED 日志"],
                ["至少两个客户端", "client/ Electron 应用与 AiawdClient", "macOS/Windows 两端连接截图"],
                ["自定义协议", "protocol.md, server/aiawd_server/protocol.py, client/aiawdProtocol.js", "AIAWD/1.0 帧格式与 Wireshark 截图"],
                ["实时同步", "ROOM_UPDATE, PHASE_SYNC, EVENT, RANKING_UPDATE 广播", "房间准备、大乱斗、排名刷新截图"],
                ["服务端权威", "MatchEngine.submit_flag 与阶段调度", "SELF_FLAG、DUPLICATE_FLAG、INVALID_PHASE 均由服务端判断"],
                ["并发处理", "asyncio.start_server 每连接一个协程", "三客户端自动 demo 与 TCP stream 扇出"],
                ["异常与日志", "ERROR 消息、LogStore JSONL", "events.jsonl 与异常日志截图"],
                ["抓包分析", "captures/*.pcap, captures/*.jsonl", "77 帧 JSONL、Wireshark Follow TCP Stream"],
            ],
            styles,
            widths=[3.1 * cm, 6.3 * cm, 7.8 * cm],
        )
    )

    story.append(h("2. 系统总体架构", styles))
    story.append(
        p(
            "整体架构可以理解为“桌面客户端负责操作意图，服务端负责事实”。客户端 UI 采集玩家动作，"
            "Node 侧的 AiawdClient 将动作编码成 AIAWD/1.0 帧，通过 TCP 长连接发给服务端。服务端的 TCPGateway 读取消息后，"
            "把请求分派给 SessionManager、RoomManager、MatchEngine、TargetRegistry 和 TargetRuntime。"
            "比赛开始时，MATCH_CONFIG 按玩家单播，PHASE_SYNC、EVENT 和 RANKING_UPDATE 按房间广播。"
            "这种结构避免了客户端之间直接互信，也让抓包时能清楚看到所有状态变化从服务端流出。"
        ,
            styles,
        )
    )
    story.append(
        data_table(
            [
                ["层次", "职责", "关键文件"],
                ["展示层", "连接页、大厅页、房间页、大乱斗页、结算页；展示排行榜、攻击动画和战报", "client/index.html, renderer.js, styles.css"],
                ["客户端协议层", "TCP 连接、心跳、seq 递增、长度帧编解码、事件分发", "client/aiawdProtocol.js"],
                ["服务端网关层", "接收连接、读取帧、请求分派、广播、幂等缓存、断线清理", "server/aiawd_server/tcp_gateway.py"],
                ["领域状态层", "会话、房间、成员、比赛、阶段、Flag、Submission", "models.py, room_manager.py, match_engine.py"],
                ["靶机运行层", "Docker Compose 计划、端口、Flag 注入、本地健康检查", "target_registry.py, target_runtime.py"],
                ["证据层", "日志、抓包、自动 demo、截图和录屏", "logs/, captures/, demo/"],
            ],
            styles,
            widths=[3.0 * cm, 9.2 * cm, 5.0 * cm],
        )
    )
    story.append(fig("demo/screenshots/实战截图mac/connect_mac.png", "图 2 客户端连接服务端。两个客户端填入同一 TCP 服务地址后进入同一大厅。", styles))
    story.append(fig("demo/screenshots/实战截图mac/server_mac.png", "图 3 服务端启动截图。TCP 9000 端口承担 AIAWD/1.0 协议通信，HTTP API 用于辅助状态查询。", styles))

    story.append(h("3. AIAWD/1.0 自定义协议设计", styles))
    story.append(
        p(
            "协议的核心设计很克制：TCP 上加 4 字节大端长度头，后面跟一个 UTF-8 JSON 对象。"
            "这比纯文本行协议更稳，因为 JSON body 中可以自然出现换行；也比全二进制协议更适合作业展示，因为 Follow TCP Stream 里能直接读懂消息。"
            "FrameDecoder 在服务端和客户端各实现一份，用缓冲区处理粘包/半包，并限制单帧最大 1MB。"
        ,
            styles,
        )
    )
    story.append(code_block(
        """
0                   31
+-------------------+----------------------------------+
| uint32 body_len BE | UTF-8 JSON message body          |
+-------------------+----------------------------------+

body example:
{"v":1,"seq":1,"type":"HELLO","payload":{"display_name":"Alice"}}
        """,
        styles,
    ))
    story.append(
        data_table(
            [
                ["字段", "类型", "含义"],
                ["v", "int", "协议版本，当前固定为 1"],
                ["type", "string", "消息类型，如 HELLO、ROOM_UPDATE、SUBMIT_FLAG_REQ"],
                ["seq", "int/null", "客户端递增序号，服务端可按 client_id + seq 做幂等缓存"],
                ["client_id", "string/null", "WELCOME 后由服务端分配"],
                ["room_id", "string/null", "房间作用域消息的目标房间"],
                ["role", "string/null", "player 或 spectator"],
                ["ts", "float/null", "Unix 时间戳，缺省时接收方补填"],
                ["payload", "object", "消息载荷，必须是 JSON 对象"],
            ],
            styles,
            widths=[3.0 * cm, 3.0 * cm, 11.2 * cm],
        )
    )
    story.append(h("3.1 消息类型与状态机", styles, level=2))
    story.append(
        data_table(
            [
                ["类别", "消息类型", "说明"],
                ["握手与心跳", "HELLO, WELCOME, PING, PONG, BYE", "连接建立、身份分配和 30s 心跳"],
                ["大厅浏览", "LIST_ROOMS_REQ/RES, LIST_TARGETS_REQ/RES", "查询房间和靶机模板"],
                ["房间管理", "CREATE_ROOM_REQ/RES, JOIN_ROOM_REQ/RES, ROOM_UPDATE", "创建、加入和广播成员状态"],
                ["比赛控制", "START_MATCH_REQ/RES, MATCH_CONFIG, PHASE_SYNC, RANKING_UPDATE", "开始比赛、单播配置、同步阶段和排名"],
                ["Agent 与 Flag", "TARGET_READY, AGENT_READY, AGENT_ACTIVITY, SUBMIT_FLAG_REQ/RES", "就绪、活动上报和服务端验旗"],
                ["错误", "ERROR", "格式、权限、阶段、房间、Flag 等错误统一返回"],
            ],
            styles,
            widths=[3.2 * cm, 6.3 * cm, 7.7 * cm],
        )
    )
    story.append(code_block(
        """
LOBBY --START_MATCH_REQ(host, >=2 players)--> PREPARE
PREPARE --server timer--> DEFENSE
DEFENSE --server timer--> ATTACK
ATTACK --server timer--> FINISHED

SUBMIT_FLAG_REQ is only valid in ATTACK.
Clients never set the final phase or the final score locally.
        """,
        styles,
    ))

    story.append(h("4. 服务端权威状态与并发处理", styles))
    story.append(
        p(
            "服务端是整个系统的裁判。RoomManager 只允许 LOBBY 阶段加入房间，MatchEngine 只允许房主且人数足够时开始比赛，"
            "Flag 的明文只在服务端生成并通过 MATCH_CONFIG 单播给对应玩家。提交 Flag 时，服务端先检查角色，再检查阶段，"
            "再检查 Flag 哈希、是否自攻、是否重复提交，最后才修改双方分数。这个流程把作弊面压到服务端，客户端 UI 即使手动构造消息，也只能收到错误或无效提交。"
        ,
            styles,
        )
    )
    story.append(code_block(
        """
if match.phase != Phase.ATTACK:
    return submission(valid=False, code="INVALID_PHASE")
if record.team_id == submitter.team_id:
    return submission(valid=False, code="SELF_FLAG")
if flag_hash in submitted_hashes:
    return submission(valid=False, code="DUPLICATE_FLAG")

submitted_hashes.add(flag_hash)
submitter.score += 100
target.score -= 50
        """,
        styles,
    ))
    story.append(
        p(
            "并发模型采用 asyncio.start_server。每个客户端连接进入一个协程循环，循环中 read_message 后按 type 分派。"
            "广播不是靠客户端互相转发，而是 TCPGateway._broadcast 遍历房间成员的 session writer，把同一类事件写入每个成员的 TCP stream。"
            "同时，服务端维护 (client_id, seq) 到 response 的缓存，同一请求重复到达时直接返回缓存结果，避免重复建房或重复计分。"
        ,
            styles,
        )
    )
    story.append(fig("demo/screenshots/实战截图mac/room_mac.png", "图 4 房间页：成员、Agent、靶机准备状态由服务端 ROOM_UPDATE 广播驱动。", styles))
    story.append(fig("demo/screenshots/实战截图mac/result1.png", "图 5 结算页：最终排名来自服务端 RANKING_UPDATE，而不是客户端本地推算。", styles))

    story.append(h("5. 异常处理、日志与安全边界", styles))
    story.append(
        p(
            "异常处理分两类：协议异常和业务异常。协议异常包括非法 JSON、非法长度、payload 不是对象、HELLO 之前发送其他消息；"
            "业务异常包括非房主开始比赛、房间不存在、房间满员、非 ATTACK 阶段提交 Flag、提交自己的 Flag、重复提交等。"
            "这些情况都会回到 ERROR 或 SUBMIT_FLAG_RES，并附带可读 code。断线时服务端将成员标记为 DISCONNECTED，"
            "随后广播 ROOM_UPDATE。客户端侧还有 30s PING 与 60s 超时断开机制。"
        ,
            styles,
        )
    )
    story.append(
        data_table(
            [
                ["异常", "处理方式"],
                ["HELLO 前发送 PING", "ERROR(BAD_REQUEST, HELLO is required before other messages)"],
                ["非法帧/超长帧/非法 JSON", "ProtocolError 转 ERROR(BAD_REQUEST)"],
                ["非房主开始比赛", "BAD_REQUEST"],
                ["人数不足开始比赛", "BAD_REQUEST"],
                ["错误阶段提交 Flag", "SUBMIT_FLAG_RES ok=false, code=INVALID_PHASE"],
                ["自攻或重复 Flag", "SELF_FLAG / DUPLICATE_FLAG"],
                ["客户端断开", "清理 writer、标记 DISCONNECTED、广播 ROOM_UPDATE"],
            ],
            styles,
            widths=[5.0 * cm, 12.2 * cm],
        )
    )
    story.append(
        p(
            "日志采用 JSONL，便于 tail、grep、jq 和后续导入分析。实际 demo 中 logs/server/events.jsonl 已累积 6689 行，"
            "能看到 SERVER_STARTED、CLIENT_CONNECTED、ROOM_CREATED、MATCH_STARTED、FLAG_SUBMITTED 和 AGENT_ACTIVITY 等关键事件。"
            "从工程角度看，下一步仍建议统一脱敏所有 Agent 输出里的 FLAG 字符串：目前 HTTP events 测试覆盖了脱敏路径，但原始 agent 活动日志仍可能保存明文片段。"
        ,
            styles,
        )
    )
    story.append(fig("demo/screenshots/实战日志/events1_real.png", "图 6 服务端事件日志截图。JSONL 记录能支撑现场解释和事后复盘。", styles))

    story.append(h("6. 抓包分析结果", styles))
    story.append(
        p(
            "抓包部分同时保留了标准 pcap 与协议层 JSONL。captures 目录中两份 pcap 均约 56KB，"
            "对应 JSONL 各 77 帧。自动 demo 的典型序列是 HELLO/WELCOME 三组连接，CREATE_ROOM_REQ，ROOM_UPDATE，"
            "JOIN_ROOM_REQ，START_MATCH_REQ，MATCH_CONFIG，PHASE_SYNC，SUBMIT_FLAG_REQ，EVENT 与 RANKING_UPDATE。"
            "在 Wireshark 中 Follow TCP Stream 可以直接看到 4 字节长度头后的 JSON body；这也是本协议选择“长度帧 + JSON”的教学价值所在。"
        ,
            styles,
        )
    )
    story.append(code_block(
        """
Frame 1:  S->C  148 bytes  HELLO
Frame 3:  S->C  147 bytes  WELCOME
Frame 13: S->C  328 bytes  CREATE_ROOM_REQ
Frame 15: S->C  691 bytes  ROOM_UPDATE
...

00 00 00 5E 7B 22 76 22 3A 31 ...
^ length=94  ^ JSON body starts with {"v":1,...
        """,
        styles,
    ))
    story.append(fig("demo/screenshots/抓包分析/wireshark-stream.png", "图 7 Wireshark Follow TCP Stream：完整交互链可读，能看到消息类型和 JSON 字段。", styles))
    story.append(fig("demo/screenshots/抓包分析/wireshark-frame.png", "图 8 单帧抓包分析：前 4 字节长度头与后续 JSON body 边界清晰。", styles))
    story.append(fig("demo/screenshots/autodemo/capture_jsonl1.png", "图 9 自动 demo 生成的协议层帧日志，辅助复核消息顺序和方向。", styles))

    story.append(h("7. Demo 过程与运行截图", styles))
    story.append(
        p(
            "现场演示按“启动服务端、启动两个客户端、创建房间、加入房间、双方准备、开始大乱斗、观察攻击阶段、展示日志、展示协议文档、解释抓包文件”的顺序进行。"
            "录屏文件 demo/video/battle_demo.mov 约 480MB，覆盖完整对战流程；报告中抽取视频封面并配合关键截图展示。"
            "我们更推荐演示时先播放录屏，再现场跑最小流程，因为网络、Docker 和 LLM API 都有不可控因素，录屏可以兜底，现场运行可以证明不是 PPT 魔法。"
        ,
            styles,
        )
    )
    story.append(fig("report_assets/battle_demo.mov.png", "图 10 从完整对战录屏抽取的视频封面。录屏覆盖连接、创建、准备、战斗和结算流程。", styles))
    story.append(fig("demo/screenshots/实战截图mac/room_create.png", "图 11 创建房间弹窗：房主选择靶机模板、人数和阶段时长。", styles))
    story.append(fig("demo/screenshots/实战截图mac/start_mac.png", "图 12 比赛启动：客户端进入大乱斗前，状态仍以服务端同步为准。", styles))

    story.append(h("8. 测试与验证", styles))
    story.append(
        p(
            "我们重新跑了测试，而不是只引用 README。环境中系统 python3 是 3.9，会因为 dataclass(slots=True) 和 StrEnum 直接失败；"
            "改用 bundled Python 3.12 后，授权 localhost 绑定再运行服务端测试，57 项中 49 项通过，8 项失败集中在 TargetRuntime/靶机证据测试。"
            "失败原因不是协议主链路，而是测试把 TargetRuntime root 设为 extras 后，manifest 里仍写 extras/targets/...，最终解析成 extras/extras/targets/... 并触发 MISSING_COMPOSE。"
            "客户端 Node v22.22.1 运行 node --test test-*.js，94 项测试中 93 项通过，1 项失败是 test-main.js 对 Docker 自动启动源码做正则匹配，源码已经改成先取 bin 再 spawnSync(bin,[\"info\"])，测试仍期待旧字符串 spawnSync(dockerPath(),[\"info\"])。"
            "这两个结果说明主流程能跑，但工程测试和路径约定还有需要收口的地方。"
        ,
            styles,
        )
    )
    story.append(
        data_table(
            [
                ["验证项", "结果", "备注"],
                ["协议编解码", "通过", "粘包、半包、超长帧、非法 JSON 均有测试"],
                ["房间/比赛核心逻辑", "通过", "建房、加入、房主开始、Flag 判定、排名"],
                ["TCP 三客户端流程", "通过", "授权本机端口后可跑通"],
                ["HTTP API", "通过", "授权本机端口后健康检查、房间、比赛、事件端点通过"],
                ["TargetRuntime", "8 项失败", "root 与 manifest compose 相对路径约定不一致"],
                ["客户端协议/UI/Agent", "93/94 通过", "1 项源码正则断言滞后于实现"],
                ["抓包文件", "通过", "两份 pcap 可打开，JSONL 各 77 帧"],
                ["日志与 demo", "通过", "events.jsonl 6689 行，录屏约 480MB"],
            ],
            styles,
            widths=[4.0 * cm, 3.0 * cm, 10.2 * cm],
        )
    )

    story.append(PageBreak())
    story.append(h("9. 小组分工", styles))
    story.append(
        p(
            "分工按实际贡献和合理项目流程进行了细化。周浩霆主导开发，把协议、服务端权威状态和整体工程结构先打通；"
            "周梓涵负责客户端优化、跨平台联调与测试验证，把客户端体验、Agent 配置和 Windows/macOS demo 补齐；"
            "刘晓语、吴彦霖负责联调验证、demo 分析、抓包素材整理和文档收口。整体上是一个“主开发拉主线，协作者补体验和证据”的小组节奏，比较符合课程项目的真实形态。"
        ,
            styles,
        )
    )
    story.append(
        data_table(
            [
                ["成员", "主要职责", "具体工作"],
                ["周浩霆", "主导开发与架构整合", "设计 AIAWD/1.0 协议主线；实现/整合 asyncio 服务端、房间状态、比赛阶段、Flag 权威校验；组织 README、protocol.md 与演示流程"],
                ["周梓涵", "客户端优化与联调验证", "优化 Electron 客户端交互；验证 macOS/Windows 演示流程；补充 Agent runtime、模型厂商识别、靶机生命周期与客户端测试"],
                ["刘晓语", "联调验证与抓包分析", "参与双客户端联调；记录异常处理结果；整理 Wireshark 抓包观察；审阅 demo 截图和报告素材"],
                ["吴彦霖", "演示验证与文档收口", "验证断线、非法阶段提交和日志检查流程；完善现场演示脚本；整理提交目录和最终检查清单"],
            ],
            styles,
            widths=[2.5 * cm, 4.0 * cm, 10.7 * cm],
        )
    )

    story.append(h("10. 不足与改进方向", styles))
    story.append(
        p(
            "第一，AIAWD/1.0 目前是明文 JSON，适合课程抓包，但真实远程比赛应加入 TLS、鉴权和重放防护。第二，日志脱敏需要更彻底，尤其是 Agent output_snippet 这类自由文本。"
            "第三，TargetRuntime 的路径约定要统一：manifest 中的 compose 路径到底相对项目根目录还是 extras 根目录，测试和实现必须说同一种话。"
            "第四，广播现在是逐 writer 顺序写入，房间人数很少时没有问题，但更大规模应加入背压和慢客户端隔离。第五，可以补一个 Wireshark dissector 或 tcpdump 解码脚本，"
            "让 4 字节长度头、type、seq、room_id 在抓包工具里直接高亮。"
        ,
            styles,
        )
    )
    story.append(
        p(
            "总的来说，这个项目已经超过“能联网”这条线：它有可解释协议、有服务端裁判、有客户端实时状态、有抓包证据，也有真实测试暴露出来的小坑。"
            "如果把靶机路径和日志脱敏再收紧，它会更像一个可以继续扩展的小型攻防平台，而不是一次性课程 demo。"
        ,
            styles,
        )
    )

    story.append(h("参考文件", styles))
    story.append(
        data_table(
            [
                ["文件", "用途"],
                ["README.md", "项目运行方式、平台能力、开发者测试入口"],
                ["protocol.md", "AIAWD/1.0 协议格式、消息类型、状态机、错误码"],
                ["extras/docs/AIAWD协议规格说明.md", "完整协议细节、广播与错误处理说明"],
                ["extras/docs/抓包分析指南.md", "tcpdump/Wireshark 抓包步骤与帧分析模板"],
                ["demo/demo_script.md", "现场演示操作脚本"],
                ["server/aiawd_server/*.py", "服务端协议、房间、比赛、日志和靶机运行实现"],
                ["client/*.js, client/index.html", "Electron 客户端协议、UI 与 Agent runtime 实现"],
                ["captures/*.pcap, captures/*.jsonl", "抓包证据"],
                ["demo/screenshots, demo/video", "运行截图与完整对战录屏"],
            ],
            styles,
            widths=[6.0 * cm, 11.2 * cm],
        )
    )
    return story


def write_sources() -> None:
    markdown = """# AI-AWD Arena 实验报告生成说明

PDF 版由 `tools/build_report.py` 生成。小组成员：周浩霆、周梓涵、刘晓语、吴彦霖。

核心结论：本项目实现了基于 TCP 长连接的 AIAWD/1.0 自定义应用层协议，服务端维护房间、比赛阶段、Flag 与排名权威状态，客户端通过 Electron 实时展示和发起操作。报告证据来自 `protocol.md`、服务端/客户端源码、`captures/` 抓包文件、`logs/` JSONL 日志、`demo/screenshots/` 截图和 `demo/video/battle_demo.mov` 录屏。

完整正文、表格和图片编排在生成脚本中维护，最终交付以 `report.pdf` 为准。

生成命令：

```bash
/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tools/build_report.py
```
"""
    latex = r"""\documentclass[11pt,a4paper]{article}
\usepackage[UTF8]{ctex}
\usepackage{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{listings}
\geometry{margin=2.2cm}
\title{AI-AWD Arena：基于 AIAWD/1.0 自定义应用层协议的 C/S 联网攻防交互系统实验报告}
\author{周浩霆 \and 周梓涵 \and 刘晓语 \and 吴彦霖}
\date{2026-06-16}
\begin{document}
\maketitle
\begin{abstract}
本项目实现了一个面向 AI 攻防竞赛的联网交互系统。系统采用 C/S 架构，服务端通过 Python asyncio 维护房间、比赛阶段、Flag 与计分等权威状态，客户端通过 Electron 桌面应用接入。通信协议 AIAWD/1.0 运行在 TCP 长连接上，以 4 字节大端长度头封装 UTF-8 JSON 消息体，完成双客户端实时同步、服务端裁判式 Flag 校验、异常响应、JSONL 日志与 Wireshark/tcpdump 抓包分析。
\end{abstract}

\section{说明}
本仓库最终交付的高质量 PDF 由 ReportLab 生成，原因是当前机器没有安装 TeX 引擎。此文件保留为 LaTeX 可迁移源稿骨架；完整正文、表格和图片排版以 \texttt{report.pdf} 为准。

\section{关键图片}
\includegraphics[width=\linewidth]{demo/screenshots/实战截图win/battle_win.png}
\includegraphics[width=\linewidth]{demo/screenshots/抓包分析/wireshark-stream.png}

\end{document}
"""
    OUT_MD.write_text(markdown, encoding="utf-8")
    OUT_TEX.write_text(latex, encoding="utf-8")


def build_pdf() -> None:
    register_fonts()
    styles = make_styles()
    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=A4,
        rightMargin=1.85 * cm,
        leftMargin=1.85 * cm,
        topMargin=1.72 * cm,
        bottomMargin=1.55 * cm,
        title="AI-AWD Arena 实验报告",
        author="周浩霆、周梓涵、刘晓语、吴彦霖",
        subject="网络编程实验：自定义应用层协议的联网交互系统",
    )
    doc.build(build_story(styles), onFirstPage=on_page, onLaterPages=on_page)


def main() -> None:
    write_sources()
    build_pdf()
    print(f"Wrote {OUT_PDF}")
    print(f"Wrote {OUT_MD}")
    print(f"Wrote {OUT_TEX}")


if __name__ == "__main__":
    main()
