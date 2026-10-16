"""Real IDE command-registry oracle: the HTTP envelope (redaction passes, status codes and messages)
for every registered command, run against synthetic projects with a configured synthetic secret."""

from __future__ import annotations

import datetime as real_datetime
import hashlib
import json
import os
from types import SimpleNamespace

from golden_fs import Project, isolated_fs_oracle
from golden_plans import CANON, CHAPTERS, HOOKS, PLAN, PLAN_CHAPTERS, _dumps

SOURCES = [
    "app/domains/ide/command_registry.py",
    "app/domains/ide/schemas.py",
    "app/common/redaction.py",
]
SECRET = "sf-synthetic-secret-123456"
FIXED_NOW = (2026, 10, 12, 4, 30, 15, 123000)
BREAKDOWN_BOOK = {
    "参考/长篇.txt": "\n".join(f"第{i}章 标题{i}\n第{i}章正文。" for i in range(1, 6)),
}


def p1_commands_snapshot() -> dict:
    with isolated_fs_oracle("commands-oracle-") as (api, run):
        from app.common import config
        from app.common.exceptions import DomainError
        from app.domains.agent_runs import observatory
        from app.domains.ide import book_breakdown, book_breakdown_control, command_registry

        config.get_settings = lambda: SimpleNamespace(storyforge_api_key=SECRET)

        class FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(*FIXED_NOW, tzinfo=tz)

        observatory.datetime = FixedDatetime
        book_breakdown.uuid = SimpleNamespace(uuid4=lambda: SimpleNamespace(hex="c0ffeec0ffeec0ffeec0ffeec0ffee00"))

        def hydrate(value, root):
            if isinstance(value, str):
                return value.replace("$ROOT", str(root))
            if isinstance(value, dict):
                return {key: hydrate(item, root) for key, item in value.items()}
            if isinstance(value, list):
                return [hydrate(item, root) for item in value]
            return value

        def command(p: Project, command_id: str, args: dict | None, *, model: list | None = None, db=None):
            calls = []

            def execute():
                if model is not None:
                    def fake(source, *, system_prompt, user_prompt):
                        calls.append({"system": system_prompt, "user": user_prompt})
                        return model[len(calls) - 1]
                    book_breakdown._call_llm = fake
                    command_registry.resolved_llm_env = lambda: {"STORYFORGE_LLM_PROVIDER": "openai",
                                                                 "STORYFORGE_LLM_MODEL": "fake-model"}
                    command_registry.missing_llm_env = lambda source: []
                else:
                    command_registry.resolved_llm_env = lambda: {}
                    command_registry.missing_llm_env = lambda source: ["STORYFORGE_LLM_API_KEY"]
                try:
                    result = command_registry.execute_ide_command_by_id(
                        command_id, None if args is None else hydrate(args, p.root), db)
                    recorded = {"result": result.model_dump(mode="json"), "calls": calls}
                    if db is not None:
                        recorded["db"] = db_rows(db)
                    return recorded
                except DomainError as error:
                    return {"error": {"status": error.status_code, "message": str(error)}}
                except Exception as error:  # noqa: BLE001 - the HTTP layer turns these into 500
                    return {"error": {"status": 500, "message": str(error)}}

            p.call("command", {"command_id": command_id, "args": args, "model": model}, execute)

        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.db.base import Base
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
        from app.domains.assistant.models import AssistantSession  # noqa: F401 - registers the FK target

        def db_rows(db):
            """The rows the production route leaves behind (the HTTP route passes its DB session)."""

            def rows(model, columns):
                return [{column: getattr(row, column) for column in columns}
                        for row in db.query(model).order_by(model.id).all()]

            return {
                "runs": rows(AgentRun, ("id", "public_id", "session_id", "assistant_session_id", "goal", "scope",
                                        "permission_profile", "budget", "status", "root_plan", "current_step")),
                "events": rows(AgentRunEvent, ("id", "run_id", "event_type", "actor", "message", "payload",
                                               "sequence")),
                "artifacts": rows(AgentArtifact, ("id", "run_id", "kind", "payload", "requires_confirmation")),
            }

        secret_args = {"api_key": "sk-live-abcdefghijklmnopqrstuv", "note": f"带上 {SECRET} 的备注",
                       "nested": [{"token": "x"}, f"Bearer {SECRET}"], "plain": 1.5, "flag": True}

        p = Project(run, "book", {**CHAPTERS, ".storyforge/canon/canon.json": _dumps(CANON),
                                  ".storyforge/canon/hooks.json": _dumps(HOOKS), **BREAKDOWN_BOOK})
        command(p, "nope", {})
        command(p, "audit.open", None)
        command(p, "audit.open", secret_args)
        for args in ({}, {"project_root": "  "}, {"project_root": 5}):
            command(p, "canon.refresh", args)
        command(p, "canon.refresh", {"project_root": " $ROOT ", "glob": " 正文/*.md ", "refresh": False, **secret_args})
        command(p, "canon.refresh", {"project_root": "$ROOT", "refresh": "no"})
        command(p, "canon.refresh", {"project_root": "$ROOT/缺失的目录"})
        command(p, "canon.refresh", {"project_root": "$ROOT", "glob": "第001章.md"})
        command(p, "canon.refresh", {"project_root": "$ROOT"})
        p.mutate(".storyforge/canon/canon.json", _dumps({**CANON, "entities": [
            *CANON["entities"], {"id": "char_gu", "canonical_name": "顾迟"}]}).encode())
        command(p, "canon.refresh", {"project_root": "$ROOT", "refresh": False})
        command(p, "canon.refresh", {"project_root": "$ROOT", "refresh": None})
        command(p, "canon.refresh", {"project_root": "$ROOT", "refresh": False})
        command(p, "observatory.scan", {"project_root": "$ROOT/缺失的目录"})
        command(p, "observatory.scan", {})
        command(p, "observatory.scan", {"project_root": "$ROOT", "glob": "  "})
        command(p, "book.breakdown.status", {"project_root": "$ROOT"})
        for target in (2, 13, "8", True, None, 3.5):
            command(p, "book.breakdown", {"project_root": "$ROOT", "target_count": target})
        command(p, "book.breakdown", {})
        command(p, "book.breakdown", {"project_root": "$ROOT", "target_count": 3, "analysis_id": " run-1 "})
        command(p, "book.breakdown.status", {"project_root": "$ROOT"})
        good = {"content": json.dumps({"story_structure": "结构", "craft_methods": {"summary": "手法"}}, ensure_ascii=False)}
        command(p, "book.breakdown", {"project_root": "$ROOT"}, model=[good])
        command(p, "book.breakdown", {"project_root": "$ROOT/缺失的目录"})
        command(p, "book.breakdown.status", {"project_root": "$ROOT/缺失的目录"})
        for args in ({}, {"analysis_id": " "}, {"analysis_id": " unknown "}):
            command(p, "book.breakdown.cancel", args)
        book_breakdown_control.prepare_breakdown_cancellation("pending")
        p.calls.append({"fn": "prepare_cancellation", "args": {"analysis_id": "pending"}, "writes": {}})
        command(p, "book.breakdown.cancel", {"analysis_id": " pending "})
        command(p, "book.breakdown.cancel", {"analysis_id": "pending"})
        book_breakdown_control.release_breakdown_cancellation("pending")
        p.calls.append({"fn": "release_cancellation", "args": {"analysis_id": "pending"}, "writes": {}})
        command(p, "book.context", {"project_root": "$ROOT", "current_file": "$ROOT/正文/第002章.md"})
        command(p, "book.context", {})

        empty = Project(run, "empty", {"图片.png": b"\x89PNG"})
        command(empty, "book.breakdown", {"project_root": "$ROOT"})
        command(empty, "book.breakdown.status", {"project_root": "$ROOT"})

        # The production route passes its DB session: every breakdown is also recorded as an agent run.
        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        recorded = Project(run, "recorded", dict(BREAKDOWN_BOOK))
        command(recorded, "book.breakdown", {"project_root": "$ROOT", "target_count": 3}, db=db)
        command(recorded, "book.breakdown", {"project_root": "$ROOT", "analysis_id": "run-1"}, model=[good], db=db)
        command(recorded, "book.breakdown", {"project_root": "$ROOT", "analysis_id": " run-1 "}, db=db)
        bad = {"content": "不是 JSON"}
        command(recorded, "book.breakdown", {"project_root": "$ROOT", "analysis_id": "run-2"}, model=[bad, bad], db=db)
        db.close()

        plan = Project(run, "plan", {**PLAN_CHAPTERS, ".storyforge/serial-plan.json": _dumps(PLAN)})
        for command_id in ("plan.mark_written", "plan.unmark_written"):
            command(plan, command_id, {})
            command(plan, command_id, {"project_root": "$ROOT"})
            command(plan, command_id, {"project_root": "$ROOT", "file_path": "  "})
        command(plan, "plan.mark_written", {"project_root": "$ROOT", "file_path": " 正文/第002章.md "})
        command(plan, "plan.mark_written", {"project_root": "$ROOT", "file_path": "大纲.md"})
        plan.remove("正文/第004章.md")
        command(plan, "plan.unmark_written", {"project_root": "$ROOT", "file_path": "正文/第004章.md"})
        command(plan, "plan.unmark_written", {"project_root": "$ROOT", "file_path": "正文/第001章.md"})

        return {
            "format_version": 1,
            "suite": "p1-commands",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book" if os.name == "nt" else "/tmp/synthetic-book",
            "secrets": [SECRET],
            "fixed_now": FIXED_NOW,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [p.record("book"), empty.record("empty"), plan.record("plan"), recorded.record("recorded")],
        }
