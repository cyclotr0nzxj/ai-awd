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
            )
        }

    def list_targets(self) -> list[dict[str, Any]]:
        return [template.public_snapshot() for template in self.templates.values()]

    def has(self, template_id: str) -> bool:
        return template_id in self.templates

    def get(self, template_id: str) -> TargetTemplate:
        return self.templates[template_id]
