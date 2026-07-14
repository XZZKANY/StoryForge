from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler


class _BookGenerationChatHandler(BaseHTTPRequestHandler):
    """模拟 OpenAI 兼容 Chat Completions，用于验证真实协议边界（生成 + Judge）。"""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        self.__class__.requests.append({"headers": dict(self.headers), "payload": payload})
        system_prompt = payload["messages"][0]["content"] if payload["messages"] else ""
        user_prompt = payload["messages"][-1]["content"]
        if "结构化一致性评审员" in system_prompt:
            response_content = "[]"
        else:
            # 按 prompt 中的「N–M 字」区间生成足量正文，确保通过字数硬门禁。
            target_chars = 800
            match = re.search(r"（(\d+)[–\-](\d+)\s*字）", user_prompt)
            if match:
                target_chars = (int(match.group(1)) + int(match.group(2))) // 2
            head = f"真实章节正文：{user_prompt[:32]}。沈砚完成调查并留下证据。"
            filler = "她沿着走廊核对每一处线索，把证据逐条登记入册。" * 200
            prose = (head + filler)[:target_chars]
            response_content = (
                prose
                + "\n【STORY_STATE_CHANGES】\n"
                + json.dumps(
                    [
                        {
                            "change_type": "character.status",
                            "entity_kind": "character",
                            "entity_id": "沈砚",
                            "canonical_name": "沈砚",
                            "surface_forms": ["沈砚"],
                            "payload": {"status": "沈砚完成调查并留下证据。"},
                        }
                    ],
                    ensure_ascii=False,
                )
                + "\n【/STORY_STATE_CHANGES】"
            )
        body = json.dumps(
            {
                "choices": [{"message": {"content": response_content}}],
                "usage": {"prompt_tokens": 101, "completion_tokens": 222, "total_tokens": 323},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def _local_provider_base_url(port: int) -> str:
    return "http" + f"://127.0.0.1:{port}/v1"


def _draft_requests() -> list[dict[str, object]]:
    return [
        item
        for item in _BookGenerationChatHandler.requests
        if _request_system_prompt(item) not in {"结构化一致性评审员", "故事状态 grounding 审查员"}
    ]


def _request_system_prompt(item: dict[str, object]) -> str:
    payload = item["payload"]
    assert isinstance(payload, dict)
    messages = payload["messages"]
    assert isinstance(messages, list)
    first_message = messages[0]
    assert isinstance(first_message, dict)
    content = str(first_message["content"])
    if "结构化一致性评审员" in content:
        return "结构化一致性评审员"
    if "故事状态 grounding 审查员" in content:
        return "故事状态 grounding 审查员"
    return "writer"
