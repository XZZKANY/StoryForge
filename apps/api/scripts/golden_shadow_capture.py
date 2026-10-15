"""Shadow capture oracle (TS migration P5-1): revise / continue run through the real router functions
with the shadow header, the real service and the real model client; only the HTTP transport is
replaced (scripted SSE replies, the request bodies are recorded). Continue is iterated the way
Starlette does it (thread pool, a copied context per step), so the capture must survive that.

The TS replay feeds the recorded router responses to the desktop shadow driver and must judge every
scenario a match: its own request, composed from the same project and payload, has the same digest."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os

from golden_canon_chain import CANON, CHAPTERS, HOOKS, _dumps
from golden_fs import Project, isolated_fs_oracle

SOURCES = [
    "app/domains/assistant/router.py",
    "app/domains/assistant/shadow.py",
    "app/domains/agent_runs/request_evidence.py",
]
SOURCE = {
    "STORYFORGE_LLM_PROVIDER": "openai",
    "STORYFORGE_LLM_BASE_URL": "https://llm.example/v1",
    "STORYFORGE_LLM_API_KEY": "sk-shadow-secret-123456",
    "STORYFORGE_LLM_MODEL": "deepseek-v4",
}
# Integer-valued settings: Python sends 1.0, the TS side must keep it a float for the same digest.
WHOLE = {**SOURCE, "STORYFORGE_LLM_TEMPERATURE": "1", "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "4096"}
FILES = {
    **CHAPTERS,
    ".storyforge/canon/canon.json": _dumps(CANON),
    ".storyforge/canon/hooks.json": _dumps(HOOKS),
    ".storyforge/agent-instructions.md": "少用「仿佛」。",
    "人物/林舟.md": "林舟会游泳。\n",
    "正文/第004章.md": "他回头。\n\n雨夜里他推开门。\n",
}


def _sse(*pieces: str) -> list[bytes]:
    lines: list[bytes] = []
    for piece in pieces:
        lines.append(f"data: {json.dumps({'choices': [{'delta': {'content': piece}}]}, ensure_ascii=False)}\n".encode())
        lines.append(b"\n")
    usage = {"choices": [], "usage": {"prompt_tokens": 120, "completion_tokens": 40}}
    lines.append(f"data: {json.dumps(usage)}\n".encode())
    lines.append(b"data: [DONE]\n")
    return lines


def p5_shadow_snapshot() -> dict:
    loop = asyncio.new_event_loop()  # created before the audit hook: the loop's self-pipe is a socket pair
    try:
        return _snapshot(loop)
    finally:
        loop.close()


def _snapshot(loop: asyncio.AbstractEventLoop) -> dict:
    with isolated_fs_oracle("storyforge-golden-shadow-capture-", fixed=True) as (api, run):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common import llm_client
        from app.db.base import Base
        from app.domains.assistant import router, schemas, service

        project = Project(run, "book", FILES)
        root = str(project.root)
        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        bound = service.create_assistant_session(db, schemas.AssistantSessionCreate(
            title="既有会话", task_type="desktop_revise", project_path=root, messages=[]))

        wire: list[dict] = []
        replies: list[list[bytes]] = []

        class _Stream:
            def __init__(self, lines: list[bytes]) -> None:
                self._lines = lines

            def __iter__(self):
                yield from self._lines

            def close(self) -> None:
                pass

        def urlopen(req, **_kwargs):  # noqa: ANN001 - transport seam
            wire.append(json.loads(req.data.decode("utf-8")))
            return _Stream(replies.pop(0))

        llm_client.request.urlopen = urlopen
        llm_client._sleep_before_retry = lambda **_: None

        def revise(payload: dict) -> dict:
            response = router.revise_file_content_endpoint(
                schemas.AssistantReviseRequest(**payload), db, shadow="prompts")
            return {"status": response.status_code, "body": json.loads(response.body)}

        def continue_(payload: dict) -> dict:
            response = router.continue_prose_endpoint(
                schemas.AssistantContinueRequest(**payload), db, shadow="prompts")

            async def collect() -> list:
                return [chunk async for chunk in response.body_iterator]

            chunks = loop.run_until_complete(collect())
            return {"status": response.status_code,
                    "body": "".join(chunk if isinstance(chunk, str) else chunk.decode() for chunk in chunks)}

        base = {"file_path": "正文/第004章.md", "content": "他回头。\n\n雨夜里他推开门。\n", "project_root": root}
        bundle = {"project_root": root, "current_file": "正文/第004章.md", "files": [
            {"path": "人物/林舟.md", "relative_path": "人物/林舟.md", "kind": "character", "title": "林舟",
             "excerpt": "林舟会游泳。"}]}
        revised = ["他回头。\n\n雨夜里他推开了门。\n"]
        continued = ["林舟站在檐下，", "没有说话。"]
        cases = [
            ("revise", "revise-new-session", {**base, "instruction": "改得紧凑些\n<<<ANCHOR\n他回头。\nANCHOR>>>"},
             SOURCE, revised),
            ("revise", "revise-bound-session", {**base, "instruction": "加强画面感", "project_name": "末世",
                                                "assistant_session_id": bound.id}, SOURCE, revised),
            # 桌面端的修订不带 context_bundle，只有续写带。
            ("revise", "revise-polish", {**base, "instruction": "润色", "quality_gate": "polish"}, SOURCE,
             ["他回头。\n\n雨夜里他推开门！\n"]),
            ("revise", "revise-whole-number-settings", {**base, "instruction": "改"}, WHOLE, revised),
            ("revise", "revise-projectless", {"file_path": "a.md", "content": "他回头。", "instruction": "改"},
             SOURCE, ["她回头。"]),
            ("continue", "continue-instruction", {**base, "cursor_line": 3, "instruction": "写得紧张些",
                                                  "target_chars": 120}, SOURCE, continued),
            ("continue", "continue-new-chapter", {"file_path": "正文/第005章.md", "content": "", "project_root": root,
                                                  "assistant_session_id": bound.id}, SOURCE, continued),
            ("continue", "continue-bundle", {**base, "cursor_line": 1, "context_bundle": bundle}, WHOLE, continued),
        ]
        scenarios = []
        for kind, name, payload, source, reply in cases:
            for key in [key for key in os.environ if key.startswith("STORYFORGE_LLM_")]:
                del os.environ[key]
            os.environ.update(source)
            wire.clear()
            replies[:] = [_sse(*reply)]
            outcome = revise(payload) if kind == "revise" else continue_(payload)
            scenarios.append({"id": name, "kind": kind, "payload": payload, "source": source,
                              "wire": list(wire), "response": outcome})
        db.close()

        return {
            "format_version": 1,
            "suite": "p5-shadow",
            "platform": "windows" if os.name == "nt" else "posix",
            "project_root": root,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "files": project.record("book")["files"],
            "bound_session_id": bound.id,
            "scenarios": scenarios,
        }
