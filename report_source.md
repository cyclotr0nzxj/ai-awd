# AI-AWD Arena 实验报告生成说明

PDF 版由 `tools/build_report.py` 生成。小组成员：周浩霆、周梓涵、刘晓语、吴彦霖。

核心结论：本项目实现了基于 TCP 长连接的 AIAWD/1.0 自定义应用层协议，服务端维护房间、比赛阶段、Flag 与排名权威状态，客户端通过 Electron 实时展示和发起操作。报告证据来自 `protocol.md`、服务端/客户端源码、`captures/` 抓包文件、`logs/` JSONL 日志、`demo/screenshots/` 截图和 `demo/video/battle_demo.mov` 录屏。

完整正文、表格和图片编排在生成脚本中维护，最终交付以 `report.pdf` 为准。

生成命令：

```bash
/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tools/build_report.py
```
