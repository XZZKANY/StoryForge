"""Agent shadow oracle (TS migration P5-1b): the desktop's SSE route runs real agent turns on a synthetic
project and an in-memory database, only the HTTP transport replaced (scripted replies). Each scenario first
builds history with earlier turns, then dumps the database exactly as it stands before the next message is
sent, runs that message and keeps the rows the comparison reads: the run and its model request evidence
(only the first is compared).

The TS replay rebuilds the "before" database, imports it into a scratch database and runs the engine on it;
its first model request evidence must have the same digest as the one Python wrote."""

from __future__ import annotations

import asyncio
import datetime as real_datetime
import email.message
import hashlib
import io
import json
import os
from types import SimpleNamespace
from urllib import error
from uuid import UUID

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_agent_run import FILES, FIXED_NOW, SOURCE, as_stream, completion, tool_args
from golden_fs import Project, encoded, isolated_fs_oracle, snapshot
from golden_llm_harness import FakeBody

SOURCES = [
    "app/domains/ide/router.py",
    "app/domains/agent_runs/runtime.py",
    "app/domains/agent_runs/request_evidence.py",
    "app/domains/agent_runs/loop/conversation_runtime.py",
]
TABLES = ["assistant_sessions", "assistant_messages", "assistant_tool_calls", "agent_runs", "agent_run_events",
          "agent_artifacts", "subagent_runs"]
REVISE = ("c1", "file_revise", tool_args(path="正文/第001章.md", instruction="把开门写得更有力"))
REVISED = completion("第一章 风起\n\n林舟一脚踹开了门。\n")
ANSWER = completion("好的，接着说。")


def turn(text, run_id, replies, *, session=None, profile="ask"):
    body = {"user_message": text, "run_id": run_id, "permission_profile": profile,
            "args": {"project_path": "$ROOT", "file_path": "$ROOT/正文/第001章.md"}}
    if session is not None:
        body["assistant_session_id"] = session
    return {"body": body, "replies": replies}


BRIEF = completion(json.dumps({
    "target_path": "正文/第003章.md", "chapter_ordinal": 3, "chapter_title": "入城", "goal": "沈禾带林舟入城",
    "pov": None, "setting": None, "required_beats": [], "forbidden_items": [], "continuity_constraints": [],
    "target_chars_min": 1600, "target_chars_max": 2600}, ensure_ascii=False))


def chapter_write(text, run_id):
    """The "draft the next chapter" button: a new conversation, a relative target that does not exist yet and the
    request bundle the desktop builds (its first request reads the chapter sources through the host reader)."""

    bundle = {"project_root": "$ROOT",
              "files": [{"path": "$ROOT/人物/主角.md", "relative_path": "人物/主角.md", "kind": "character",
                         "title": "主角.md", "excerpt": "# 林舟 左臂有旧伤。"}],
              # The desktop's own key order (emptyCounts), not alphabetical: Python sorts it into the prompt.
              "summary": {"counts": {"outline": 0, "character": 1, "setting": 0, "timeline": 0, "foreshadowing": 0,
                                     "knowledge": 0, "draft": 2, "quality": 0, "export": 0, "other": 0},
                          "hasStoryStructure": True},
              "budget": {"file_count": 1, "char_count": 12, "max_files": 12, "max_excerpt_chars": 4000,
                         "truncated": False}}
    body = {"user_message": text, "run_id": run_id, "intent": "chapter.write", "permission_profile": "ask",
            "args": {"project_path": "$ROOT", "instruction": text, "project_name": "book",
                     "assistant_session_id": None, "context_bundle": bundle, "file_path": "正文/第003章.md",
                     "agent_role_hints": [], "agent_role_mentions": []}}
    return {"body": body, "replies": [BRIEF]}


def scenarios():
    read = turn("读一下第一章再说", "run-a1", [
        completion("", [("c1", "fs_read", tool_args(path="正文/第001章.md"))]), completion("读完了，开头很紧。")])
    revise = turn("改一下第一章开门那句", "run-b1", [completion("", [REVISE]), REVISED, completion("改好了，等你确认。")])
    return [
        {"id": "after-a-read", "history": [read], "target": turn("接着说说伏笔", "run-a2", [ANSWER], session=1)},
        {"id": "with-a-pending-patch", "history": [revise],
         "target": turn("先不改了，聊聊第二章", "run-b2", [ANSWER], session=1)},
        {"id": "new-session-beside-history", "history": [read], "target": turn("换个话题", "run-c2", [ANSWER])},
        {"id": "read-only-profile", "history": [read],
         # Two requests in the target run: only the first is compared.
         "target": turn("只看不改", "run-d2", [completion("", [("c2", "fs_read", tool_args(path="人物/主角.md"))]),
                                              ANSWER], session=1, profile="read")},
        # The fixed pipeline: its first request is the Chapter Brief, after the chapter sources were read.
        {"id": "chapter-write-new-file", "history": [read], "target": chapter_write("起草第3章", "run-e2")},
    ]


def pin_timestamps(connection) -> None:
    """CURRENT_TIMESTAMP values, pinned by id so the dumps are reproducible (no prompt reads them)."""

    for table in TABLES:
        connection.exec_driver_sql(
            f"UPDATE {table} SET created_at = '2026-07-02 10:' || printf('%02d', id % 60) || ':00', "
            "updated_at = '2026-07-02 11:' || printf('%02d', id % 60) || ':30'")


def insert_statement(connection, table: str, row_id: int) -> str:
    """One row as a literal INSERT (sqlite `quote`), replayed on top of the "before" database."""

    columns = [row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")]
    values = connection.exec_driver_sql(
        f"SELECT {', '.join(f'quote({column})' for column in columns)} FROM {table} WHERE id = ?", (row_id,)).one()
    return f'INSERT INTO "{table}" ({", ".join(columns)}) VALUES({", ".join(values)});'


def dump(engine) -> list[str]:
    with engine.begin() as connection:
        pin_timestamps(connection)
    raw = engine.raw_connection()
    try:
        # create_all emits indexes in set order (hash seeded per process): sorted, before COMMIT.
        dumped = list(raw.driver_connection.iterdump())
    finally:
        raw.close()
    indexes = sorted(s for s in dumped if s.startswith(("CREATE INDEX", "CREATE UNIQUE INDEX")))
    rest = [s for s in dumped if s not in indexes]
    assert rest[-1] == "COMMIT;"
    return [*rest[:-1], *indexes, rest[-1]]


def p5_agent_shadow_snapshot() -> dict:
    loop = asyncio.new_event_loop()  # created before the audit hook: the loop's self-pipe is a socket pair
    try:
        return _snapshot(loop)
    finally:
        loop.close()


def _snapshot(loop: asyncio.AbstractEventLoop) -> dict:
    with isolated_fs_oracle("storyforge-golden-agent-shadow-", fixed=True) as (api, run):
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common import llm_client as lc
        from app.common import llm_control
        from app.db.base import Base
        from app.domains.agent_runs import request_evidence, review_report, text_stream
        from app.domains.agent_runs.adapters import chapter_writing_contracts, chapter_writing_pipeline
        from app.domains.agent_runs.fs import knowledge_proposals as proposals_module
        from app.domains.agent_runs.loop import run_control
        from app.domains.agent_runs.patches import runtime_tools as patch_runtime_tools
        from app.domains.agent_runs.tools import project_canon_runtime, prose_continue_runtime
        from app.domains.ide.router import AgentUserMessageStreamRequest, stream_agent_user_message_endpoint
        from app.platform.ai_sdk.providers import openai_compatible

        class FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(*FIXED_NOW, tzinfo=tz)

        proposals_module.datetime = FixedDatetime
        clock = {"now": 100.0}
        virtual = SimpleNamespace(monotonic=lambda: clock["now"], time=lambda: clock["now"],
                                  sleep=lambda seconds: clock.__setitem__("now", clock["now"] + seconds))
        lc.random = lambda: 0.375
        for module in (lc, openai_compatible, run_control, llm_control):
            module.time = virtual
        state: dict = {}

        def fake_urlopen(req, timeout=None):
            clock["now"] += 0.25
            body = json.loads(req.data.decode("utf-8"))
            reply = state["replies"].pop(0)
            if body.get("stream") is True and reply["status"] < 400:
                reply = as_stream(reply)
            raw = reply["body"].encode()
            if reply["status"] >= 400:
                raise error.HTTPError(req.full_url, reply["status"], "error", email.message.Message(), io.BytesIO(raw))
            return FakeBody(raw, None, None, None)

        lc.request.urlopen = fake_urlopen

        def counters():
            attempts, streams, proposals, hexes = (iter(range(1, 1000)) for _ in range(4))
            request_evidence.uuid4 = lambda: f"attempt-{next(attempts)}"
            text_stream.uuid4 = lambda: f"stream-{next(streams)}"
            proposals_module.uuid4 = lambda: UUID(f"00000000-0000-4000-8000-{next(proposals):012x}")
            fake_uuid = SimpleNamespace(uuid4=lambda: SimpleNamespace(hex=f"{next(hexes):032x}"))
            for module in (patch_runtime_tools, project_canon_runtime, prose_continue_runtime, review_report,
                           chapter_writing_contracts, chapter_writing_pipeline):
                module.uuid = fake_uuid

        def send(db, root, spec) -> dict:
            body = json.loads(json.dumps(spec["body"], ensure_ascii=False).replace("$ROOT", root.replace("\\", "\\\\")))
            state["replies"] = list(spec["replies"])
            request = AgentUserMessageStreamRequest.model_validate(body)

            async def collect():
                response = await stream_agent_user_message_endpoint(body["run_id"], request, db, host_generation=None)
                return [chunk async for chunk in response.body_iterator]

            chunks = loop.run_until_complete(collect())
            last = json.loads(chunks[-1][len("data: "):-2])
            return {"body": body, "terminal": last["type"], "unused_replies": len(state["replies"])}

        for key in [key for key in os.environ if key.startswith("STORYFORGE_LLM_")]:
            del os.environ[key]
        os.environ.update(SOURCE)
        records = []
        for spec in scenarios():
            project = Project(run, spec["id"], FILES)
            root = str(project.root)
            engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
            Base.metadata.create_all(engine)
            db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
            clock["now"] = 100.0
            counters()
            history = [send(db, root, earlier) for earlier in spec["history"]]
            db.expire_all()
            before = dump(engine)
            # The project as it stands before the message: earlier turns may have written `.storyforge/`.
            tree = {path: encoded(raw) for path, raw in sorted(snapshot(project.root).items())}
            target = send(db, root, spec["target"])
            db.close()
            dump(engine)
            with engine.connect() as connection:
                evidence = connection.execute(text(
                    "SELECT r.id, a.id, json_extract(a.payload, '$.request_digest'), "
                    "json_extract(a.payload, '$.step') FROM agent_artifacts a "
                    "JOIN agent_runs r ON a.run_id = r.id WHERE r.public_id = :run "
                    "AND a.kind = 'model_request_evidence' ORDER BY a.id"),
                    {"run": target["body"]["run_id"]}).all()
                digest, step = evidence[0][2], evidence[0][3]
                rows = [insert_statement(connection, "agent_runs", evidence[0][0]),
                        *(insert_statement(connection, "agent_artifacts", row[1]) for row in evidence)]
            records.append({"id": spec["id"], "project_root": root, "files": tree, "history": history,
                            "before_sql": before,
                            "target": target, "python_rows": rows, "python_digest": digest, "python_step": step})

        return {
            "format_version": 1,
            "suite": "p5-agent-shadow",
            "platform": "windows" if os.name == "nt" else "posix",
            "source": SOURCE,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "scenarios": records,
        }
