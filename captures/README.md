# 抓包文件

此目录存放 AIAWD/1.0 协议抓包文件（.pcap 格式），供 Wireshark 分析使用。

## 使用方法

```bash
# 一键抓包（自动检测 loopback 网卡）
bash captures/capture.sh

# 局域网抓包
bash captures/capture.sh --lan

# 指定网卡和端口
bash captures/capture.sh -i en0 -p 9000

# 用 Wireshark 打开
open captures/aiawd_match_*.pcap

# 命令行快速预览
tcpdump -r captures/aiawd_match_*.pcap -A | grep '"type"' | head -20
```

## 分析指南

详见 `docs/抓包分析指南.md`。
