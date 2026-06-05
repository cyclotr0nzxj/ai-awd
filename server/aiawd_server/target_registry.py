from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class TargetTemplate:
    template_id: str
    name: str
    description: str
    version: str
    category: str
    difficulty: str
    runtime: str
    manifest: dict[str, Any]

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "category": self.category,
            "difficulty": self.difficulty,
            "runtime": self.runtime,
            "manifest": self.manifest_snapshot(),
        }

    def manifest_snapshot(self) -> dict[str, Any]:
        return deepcopy(self.manifest)


class TargetRegistry:
    def __init__(self) -> None:
        self.templates = {
            "real_ctf_web_awd_01": TargetTemplate(
                template_id="real_ctf_web_awd_01",
                name="Web AWD 演示靶机",
                description="用于 MVP 房间配置的专业 Web-AWD 风格 Docker Compose 靶机模板。",
                version="0.1.0",
                category="web",
                difficulty="professional",
                runtime="docker-compose",
                manifest={
                    "id": "real_ctf_web_awd_01",
                    "name": "Web AWD 演示靶机",
                    "version": "0.1.0",
                    "category": "web",
                    "difficulty": "professional",
                    "runtime": "docker-compose",
                    "description": "用于 MVP 房间配置的专业 Web-AWD 风格 Docker Compose 靶机模板。",
                    "ports": {
                        "http": {
                            "default": 18081,
                            "env": "AIAWD_HTTP_PORT",
                        }
                    },
                    "flag": {
                        "mode": "server_generated",
                        "inject": {
                            "method": "env",
                            "env": "AIAWD_FLAG",
                        },
                        "visible_to_agent": False,
                    },
                    "healthcheck": {
                        "type": "http",
                        "path": "/health",
                        "timeout_sec": 10,
                    },
                    "commands": {
                        "install": "docker compose build",
                        "start": "docker compose up -d",
                        "stop": "docker compose down",
                        "reset": "docker compose down -v && docker compose up -d",
                    },
                    "compose": {
                        "file": "targets/real_ctf_web_awd_01/docker-compose.yml",
                        "project_prefix": "aiawd",
                        "services": ["web", "db"],
                    },
                    "logs": [
                        {"service": "web"},
                        {"service": "db"},
                    ],
                    "security": {
                        "network": "aiawd_match_network",
                        "no_public_targets": True,
                        "allowed_scope": "room_only",
                    },
                },
            ),
            "pwn_awd_echo_01": TargetTemplate(
                template_id="pwn_awd_echo_01",
                name="PWN 二进制漏洞利用靶机",
                description="模拟二进制溢出漏洞利用的 AWD 靶机，通过 TCP 协议交互，需要构造特定溢出载荷获取 flag。",
                version="0.1.0",
                category="pwn",
                difficulty="intermediate",
                runtime="docker-compose",
                manifest={
                    "id": "pwn_awd_echo_01",
                    "name": "PWN 二进制漏洞利用靶机",
                    "version": "0.1.0",
                    "category": "pwn",
                    "difficulty": "intermediate",
                    "runtime": "docker-compose",
                    "description": "模拟二进制溢出漏洞利用的 AWD 靶机，通过 TCP 协议交互，需要构造特定溢出载荷获取 flag。",
                    "ports": {
                        "tcp": {
                            "default": 31337,
                            "env": "AIAWD_HTTP_PORT",
                        }
                    },
                    "flag": {
                        "mode": "server_generated",
                        "inject": {
                            "method": "env",
                            "env": "AIAWD_FLAG",
                        },
                        "visible_to_agent": False,
                    },
                    "healthcheck": {
                        "type": "tcp",
                        "send": "HEALTH",
                        "expect": "OK",
                        "timeout_sec": 10,
                    },
                    "commands": {
                        "install": "docker compose build",
                        "start": "docker compose up -d",
                        "stop": "docker compose down",
                        "reset": "docker compose down -v && docker compose up -d",
                    },
                    "compose": {
                        "file": "targets/pwn_awd_echo_01/docker-compose.yml",
                        "project_prefix": "aiawd",
                        "services": ["pwn"],
                    },
                    "logs": [
                        {"service": "pwn"},
                    ],
                    "security": {
                        "network": "aiawd_match_network",
                        "no_public_targets": True,
                        "allowed_scope": "room_only",
                    },
                },
            ),
            "crypto_awd_oracle_01": TargetTemplate(
                template_id="crypto_awd_oracle_01",
                name="Crypto 解密预言机靶机",
                description="模拟密码学 Oracle 攻击的 AWD 靶机，通过 TCP 协议交互，需要逆向 XOR 密钥获取 flag。",
                version="0.1.0",
                category="crypto",
                difficulty="intermediate",
                runtime="docker-compose",
                manifest={
                    "id": "crypto_awd_oracle_01",
                    "name": "Crypto 解密预言机靶机",
                    "version": "0.1.0",
                    "category": "crypto",
                    "difficulty": "intermediate",
                    "runtime": "docker-compose",
                    "description": "模拟密码学 Oracle 攻击的 AWD 靶机，通过 TCP 协议交互，需要逆向 XOR 密钥获取 flag。",
                    "ports": {
                        "tcp": {
                            "default": 4444,
                            "env": "AIAWD_HTTP_PORT",
                        }
                    },
                    "flag": {
                        "mode": "server_generated",
                        "inject": {
                            "method": "env",
                            "env": "AIAWD_FLAG",
                        },
                        "visible_to_agent": False,
                    },
                    "healthcheck": {
                        "type": "tcp",
                        "send": "HEALTH",
                        "expect": "OK",
                        "timeout_sec": 10,
                    },
                    "commands": {
                        "install": "docker compose build",
                        "start": "docker compose up -d",
                        "stop": "docker compose down",
                        "reset": "docker compose down -v && docker compose up -d",
                    },
                    "compose": {
                        "file": "targets/crypto_awd_oracle_01/docker-compose.yml",
                        "project_prefix": "aiawd",
                        "services": ["oracle"],
                    },
                    "logs": [
                        {"service": "oracle"},
                    ],
                    "security": {
                        "network": "aiawd_match_network",
                        "no_public_targets": True,
                        "allowed_scope": "room_only",
                    },
                },
            ),
        }

    def list_targets(self) -> list[dict[str, Any]]:
        return [template.public_snapshot() for template in self.templates.values()]

    def has(self, template_id: str) -> bool:
        return template_id in self.templates

    def get(self, template_id: str) -> TargetTemplate:
        return self.templates[template_id]
