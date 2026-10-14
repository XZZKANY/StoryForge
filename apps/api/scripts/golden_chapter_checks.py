"""Chapter check history oracle (P4-2c): the real `query_chapter_check_history` on in-memory sqlite.

Sessions, runs (bound to a session the way a completed run is) and chapter brief / check / candidate
artifacts are recorded through the real services; every query goes through the route's request model
(422 on rejection) and response model (datetime serialization, redacting serializer). Domain errors keep
their status and message. Check / candidate payloads reference earlier briefs and texts by placeholder
({"$brief": label} is that brief's check-source hash, {"$sha": text} the text's sha256), resolved the same
way by the TS replay. Owned paths become $ROOT / $ELSEWHERE; created_at keeps only its shape.
"""

from __future__ import annotations

import hashlib
import json
import os

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, isolated_fs_oracle

SECRET = "sk-oracle-secret-123456"
# Configured only after the artifacts were written: the response model's serializer still redacts it.
LATER = "钥匙口令七七七七"
SOURCES = [
    "app/domains/agent_runs/events/chapter_checks.py",
    "app/domains/agent_runs/schemas.py",
    "app/domains/agent_runs/router.py",
    "app/domains/assistant/session_scope.py",
]
BRIEF = {"brief_id": "brief-1", "revision": 1, "target_path": "正文/第003章.md", "goal": "入城",
         "target_chars_min": 2000, "target_chars_max": 3000.0}


def check(brief: str, text: str, **extra) -> dict:
    return {"protocol_version": 1, "brief_sha256": {"$brief": brief}, "content_sha256": {"$sha": text},
            "status": "fail", **extra}


def candidate(brief: dict, brief_label: str, text: str, **extra) -> dict:
    return {"read_only": True, "content": text, "target_path": brief.get("target_path"),
            "brief_id": brief.get("brief_id"), "brief_sha256": {"$brief": brief_label},
            "content_sha256": {"$sha": text}, **extra}


def operations() -> list[dict]:
    b2 = {**BRIEF, "brief_id": "brief-2", "target_path": "正文/第004章.md"}
    b3 = {**BRIEF, "brief_id": "brief-3", "target_path": "正文/第005章.md"}
    b5 = {**BRIEF, "brief_id": "brief-5", "target_path": "正文/第006章.md"}
    b6 = {k: v for k, v in BRIEF.items() if k != "brief_id"} | {"target_path": "正文/第007章.md"}
    b7 = {**BRIEF, "brief_id": "brief-7"}
    art = lambda run, label, kind, payload, confirm=False: {  # noqa: E731
        "op": "artifact", "run": run, "as": label, "kind": kind, "payload": payload, "requires_confirmation": confirm}
    q = lambda **body: {"op": "query", "body": body}  # noqa: E731
    return [
        {"op": "session", "project": "book"}, {"op": "session", "project": "book"},
        {"op": "session", "project": None}, {"op": "session", "project": "elsewhere"},
        *[{"op": "start", "run": run, "session": session} for run, session in
          (("r1", 1), ("r2", 1), ("r3", 1), ("r4", 2), ("r5", 1), ("r6", 1), ("r7", 1), ("r8", 1),
           ("r9", 1))],
        # r1: a failed check then a repaired one, each with its own read-only candidate.
        art("r1", "B1", "chapter_brief", BRIEF),
        art("r1", "C1", "chapter_check", check("B1", "正文一", token=SECRET)),
        art("r1", "K1", "chapter_candidate", candidate(BRIEF, "B1", "正文一", note=f"带 {SECRET}")),
        art("r1", "C2", "chapter_check", check("B1", "正文二", status="pass")),
        art("r1", "K2", "chapter_candidate", candidate(BRIEF, "B1", "正文二")),
        # r2: the check's brief hash belongs to another run's brief.
        art("r2", "B2", "chapter_brief", b2),
        art("r2", "C3", "chapter_check", check("B1", "正文三")),
        art("r2", "K3", "chapter_candidate", candidate(b2, "B2", "正文三")),
        # r3: two candidates after one check.
        art("r3", "B3", "chapter_brief", b3),
        art("r3", "C4", "chapter_check", check("B3", "正文四")),
        art("r3", "K4a", "chapter_candidate", candidate(b3, "B3", "正文四")),
        art("r3", "K4b", "chapter_candidate", candidate(b3, "B3", "正文四")),
        # r5: candidates that are not bound (needs confirmation, carries a diff, forged hash), one whose
        # missing brief_id equals the brief's missing brief_id, a check without candidates and a brief
        # recorded after its check.
        art("r5", "B5", "chapter_brief", b5),
        art("r5", "C5", "chapter_check", check("B5", "正文五")),
        art("r5", "K5", "chapter_candidate", candidate(b5, "B5", "正文五"), True),
        art("r5", "C6", "chapter_check", check("B5", "正文六")),
        art("r5", "K6", "chapter_candidate", candidate(b5, "B5", "正文六", before="旧")),
        art("r5", "C7", "chapter_check", check("B5", "原文")),
        art("r5", "K7", "chapter_candidate", {**candidate(b5, "B5", "篡改"), "content_sha256": {"$sha": "原文"}}),
        art("r5", "B6", "chapter_brief", b6),
        art("r5", "C8", "chapter_check", check("B6", "正文八")),
        art("r5", "K8", "chapter_candidate", candidate(b6, "B6", "正文八") | {"brief_id": None}),
        art("r5", "C9", "chapter_check", {**check("B5", "正文九"), "brief_sha256": "0" * 64}),
        art("r5", "C10", "chapter_check", check("B6", "正文十")),
        art("r5", "B7", "chapter_brief", b7),
        art("r5", "C11", "chapter_check", check("B7", "正文十一")),
        # r6: a brief with the same hash recorded only after the check does not belong to it.
        art("r6", "C13", "chapter_check", check("B1", "正文十三")),
        art("r6", "B8", "chapter_brief", BRIEF),
        # r7 / r8 interleave: another run's check between r7's check and its candidate is no boundary.
        art("r7", "B9", "chapter_brief", {**BRIEF, "brief_id": "brief-9"}),
        art("r7", "C14", "chapter_check", check("B9", "正文十四")),
        art("r8", "C15", "chapter_check", check("B9", "正文十五")),
        art("r7", "K14", "chapter_candidate", candidate({**BRIEF, "brief_id": "brief-9"}, "B9", "正文十四")),
        # r9: a candidate that is not read-only, one with another brief id, and a check carrying a key
        # configured only later.
        art("r9", "B10", "chapter_brief", {**BRIEF, "brief_id": "brief-10"}),
        art("r9", "C16", "chapter_check", check("B10", "正文十六")),
        art("r9", "K16", "chapter_candidate",
            candidate({**BRIEF, "brief_id": "brief-10"}, "B10", "正文十六", read_only=False)),
        art("r9", "C17", "chapter_check", check("B10", "正文十七")),
        art("r9", "K17", "chapter_candidate", candidate({**BRIEF, "brief_id": "brief-x"}, "B10", "正文十七")),
        art("r9", "C18", "chapter_check", check("B10", "正文十八", note=f"带 {LATER}")),
        # r4 belongs to another conversation.
        art("r4", "C12", "chapter_check", check("B1", "别的会话")),
        art("r4", "K12", "chapter_candidate", candidate(BRIEF, "B1", "别的会话")),
        {"op": "set_secret", "value": LATER},
        q(project_root="book", assistant_session_id=1),
        q(project_root="book", assistant_session_id=1, limit=3),
        q(project_root="book", assistant_session_id=1, limit=16),
        q(project_root="book", assistant_session_id=1, limit=17),
        q(project_root="book", assistant_session_id=2, limit=50),
        q(project_root="elsewhere", assistant_session_id=1),
        q(project_root="book", assistant_session_id=3),
        q(project_root="book", assistant_session_id=4),
        q(project_root="book", assistant_session_id=99),
        q(project_root="book", assistant_session_id=1, limit=0),
        q(project_root="book", assistant_session_id=1, limit=51),
        q(project_root="book", assistant_session_id=1, limit="5"),
        q(project_root="book", assistant_session_id="1"),
        q(project_root="book", assistant_session_id=True),
        q(project_root="book", assistant_session_id=0),
        q(project_root="book", assistant_session_id=1, extra=1),
        q(project_root="", assistant_session_id=1),
        q(assistant_session_id=1),
    ]


def p4_chapter_checks_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-chapter-checks-") as (api, run_dir):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from pydantic import ValidationError
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common.exceptions import DomainError
        from app.db.base import Base
        from app.domains.agent_runs import service_lifecycle
        from app.domains.agent_runs.adapters.chapter_check_protocol import check_source
        from app.domains.agent_runs.events.chapter_checks import query_chapter_check_history
        from app.domains.agent_runs.models import AgentArtifact, AgentRun
        from app.domains.agent_runs.schemas import ChapterCheckHistoryQuery, ChapterCheckHistoryRead
        from app.domains.agent_runs.service_store import record_agent_artifact
        from app.domains.assistant.models import AssistantSession

        book = Project(run_dir, "book", {"正文/第001章.md": "第一章。\n"})
        roots = {"book": str(book.root), "elsewhere": str(run_dir / "elsewhere")}
        owned = ((book.root, "$ROOT"), (run_dir / "elsewhere", "$ELSEWHERE"))

        def mask(value, key=None):
            if isinstance(value, str):
                if key == "created_at":
                    return "".join("0" if ch.isdigit() else ch for ch in value)
                for path, label in owned:
                    value = value.replace(str(path), label).replace(path.as_posix(), label)
                return value
            if isinstance(value, dict):
                return {name: mask(item, name) for name, item in value.items()}
            if isinstance(value, list):
                return [mask(item) for item in value]
            return value

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        labels: dict[str, int] = {}

        def resolve(value):
            if isinstance(value, dict):
                if set(value) == {"$brief"}:
                    return check_source("", db.get(AgentArtifact, labels[value["$brief"]]).payload)["brief_sha256"]
                if set(value) == {"$sha"}:
                    return hashlib.sha256(value["$sha"].encode()).hexdigest()
                return {key: resolve(item) for key, item in value.items()}
            return value

        records = []
        for op in operations():
            record: dict = {"op": op}
            kind = op["op"]
            if kind == "session":
                db.add(AssistantSession(title=f"会话 {len(records)}", task_type="ide_agent_orchestration",
                                        project_path=None if op["project"] is None else roots[op["project"]]))
                db.commit()
            elif kind == "start":
                out = service_lifecycle.start_agent_user_message_run(
                    db, agent_session_id=op["run"], message={"user_message": "写章", "run_id": op["run"]})
                # A completed run carries its conversation: set the column the way completion does.
                out.run.assistant_session_id = op["session"]
                db.add(out.run)
                db.commit()
            elif kind == "artifact":
                run = db.query(AgentRun).filter(AgentRun.public_id == op["run"]).one()
                labels[op["as"]] = record_agent_artifact(db, run, kind=op["kind"], payload=resolve(op["payload"]),
                                                         requires_confirmation=op["requires_confirmation"]).id
            elif kind == "set_secret":
                os.environ["STORYFORGE_LLM_API_KEY"] = op["value"]
            elif kind == "query":
                body = {key: roots.get(value, value) if key == "project_root" else value
                        for key, value in op["body"].items()}
                try:
                    request = ChapterCheckHistoryQuery(**body)
                    result = query_chapter_check_history(db, request.project_root, request.assistant_session_id,
                                                         limit=request.limit)
                    record["result"] = mask(ChapterCheckHistoryRead.model_validate(result).model_dump(mode="json"))
                except ValidationError:
                    db.rollback()
                    record["error"] = {"status": 422}
                except DomainError as exc:
                    db.rollback()
                    record["error"] = {"status": exc.status_code, "message": str(exc)}
            records.append(record)
        return {
            "format_version": 1,
            "suite": "p4-chapter-checks",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "records_json": json.dumps(records, ensure_ascii=False),
        }
