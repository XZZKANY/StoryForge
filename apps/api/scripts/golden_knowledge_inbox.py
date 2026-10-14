"""Knowledge Inbox oracle (P4-2b): the real inbox services (query / refresh / revise / resolve / materialize)
on in-memory sqlite and two synthetic projects, driven by one operation script.

Requests go through the routes' request models (422 on rejection) and results through their response models
(the inbox with exclude_none), ValueError is the routes' 409 and FsToolError escapes as a 500. Every operation
records its result or error, the event / artifact rows it appended and the files it wrote. Owned roots become
$ROOT / $OTHER and the two project fingerprints $FINGERPRINT / $OTHER_FINGERPRINT, so the TS replay compares
against its own synthetic roots. Proposal ids come from a deterministic UUID counter and a fixed clock.
"""

from __future__ import annotations

import datetime as real_datetime
import hashlib
import json
import os
from uuid import UUID

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, encoded, isolated_fs_oracle, snapshot, tree_diff

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/events/knowledge_inbox.py",
    "app/domains/agent_runs/events/knowledge_materialization.py",
    "app/domains/agent_runs/schemas.py",
    "app/domains/agent_runs/router.py",
]
FIXED_NOW = (2026, 10, 14, 1, 2, 3, 0)
ID1 = "pk_11111111-1111-4111-8111-111111111111"
ID2 = "pk_22222222-2222-4222-8222-222222222222"
ID9 = "pk_99999999-9999-4999-8999-999999999999"
BASE = {"kind": "world_rule", "confidence": "author_declared", "reason": "作者说的"}
CREATE = {**BASE, "target_path": "设定/新规.md", "operation": "create", "title": "新规", "claim": "新规断言。",
          "sources": [{"type": "project_file", "path": "设定/钟楼.md"}, {"type": "author_statement"}]}
EXTEND = {**BASE, "target_path": "设定/世界观.md", "operation": "extend", "title": "灵力规则",
          "claim": "灵力不能跨界使用，违者反噬三日。", "related_knowledge_ids": [ID1],
          "sources": [{"type": "external_reference", "locator": "https://x", "title": "资料", "summary": "摘要"}]}
CONFLICT = {**BASE, "target_path": "设定/世界观.md", "operation": "conflict", "title": "灵力新说",
            "claim": "灵力可以跨界。", "related_knowledge_ids": [ID1], "sources": [{"type": "author_statement"}]}
SUPERSEDE = {**CONFLICT, "operation": "supersede", "title": "灵力新规", "claim": "灵力可以跨界一次。",
             "sources": [{"type": "author_statement", "path": None, "locator": None}]}
RETIRE = {**BASE, "target_path": "人物/主角.md", "operation": "retire", "title": "钟楼", "claim": "钟楼已拆。",
          "related_knowledge_ids": [ID2], "sources": [{"type": "author_statement"}]}
DISPUTE = {**RETIRE, "operation": "dispute", "title": "钟楼存疑", "claim": "钟楼也许从未响过。"}
# A conflict whose second related id is no longer on disk: the inbox drops it from the conflicts.
CONFLICT2 = {**CONFLICT, "target_path": "人物/主角.md", "title": "钟楼另说", "claim": "钟楼没有钟。",
             "related_knowledge_ids": [ID2, ID9]}
LEGACY_ITEM = {
    "proposal_id": "kpp_legacy", "knowledge_id": "pk_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "author_confirmation_event_id": "ake_legacy", "target_path": "设定/旧档.md", "operation": "create",
    "title": "旧档", "claim": "旧档断言。", "kind": "world_rule", "confidence": "inferred",
    "sources": [{"type": "author_statement", "path": None, "extra": 1}], "related_knowledge_ids": [],
    "reason": "旧", "claim_fingerprint": "$LEGACY_CLAIM", "legacy_note": "x",
}
# Older payload shapes kept in history: extra keys and None values, a non-object item, a group without
# items or revision, a group whose items are not a list, and (in the other project) a non-object source.
LEGACY = {"schema_version": 1, "proposal_group_id": "kpg_legacy", "revision": 1, "project_fingerprint": "$FINGERPRINT",
          "created_at": "2026-10-01T00:00:00Z", "proposals": [LEGACY_ITEM, "not-an-object"]}
LEGACY_EMPTY = {"proposal_group_id": "kpg_empty", "project_fingerprint": "$FINGERPRINT",
                "created_at": "2026-10-01T00:00:00Z", "proposals": []}
LEGACY_BROKEN = {"proposal_group_id": "kpg_broken", "project_fingerprint": "$FINGERPRINT", "proposals": "x"}
JUNK = {**LEGACY, "proposal_group_id": "kpg_junk", "project_fingerprint": "$OTHER_FINGERPRINT",
        "proposals": [{**LEGACY_ITEM, "proposal_id": "kpp_junk", "target_path": "设定/杂.md",
                       "sources": [{"type": "author_statement"}, "junk"]}]}


def operations() -> list[dict]:
    a = lambda index: {"artifact": "A", "proposal": index}  # noqa: E731
    return [
        {"op": "start", "run": "run-a", "session": "sess-a"},
        {"op": "start", "run": "run-b", "session": "sess-b"},
        {"op": "propose", "run": "run-a", "project": "book", "as": "A", "payload": {"proposals": [CREATE, EXTEND, CONFLICT]}},
        {"op": "propose", "run": "run-b", "project": "other", "as": "B", "payload": {"proposals": [{**CREATE, "sources": [{"type": "author_statement"}]}]}},
        {"op": "propose", "run": "run-b", "project": "book", "as": "C", "payload": {"proposals": [RETIRE, DISPUTE, CONFLICT2]}},
        {"op": "artifact", "run": "run-b", "as": "R", "kind": "review_report", "payload": {"issues": []}},
        {"op": "artifact", "run": "run-a", "as": "L", "kind": "knowledge_proposal", "payload": LEGACY},
        {"op": "artifact", "run": "run-a", "as": "L2", "kind": "knowledge_proposal", "payload": LEGACY_EMPTY},
        {"op": "artifact", "run": "run-a", "as": "L3", "kind": "knowledge_proposal", "payload": LEGACY_BROKEN},
        {"op": "query", "project": "book"},
        {"op": "query", "project": "other"},
        {"op": "query", "project": "missing"},
        # Materialize, the identity checks of an accept, then the author applies the patch and accepts.
        {"op": "materialize", "project": "book", **a(0), "revision": 1},
        {"op": "materialize", "project": "book", **a(0), "revision": 1},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted",
         "patch_identity": "knowledge-patch-wrong", "author_confirmation_event_id": "ake_wrong"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted", "patch": "last"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted", "patch": "last",
         "author_confirmation_event_id": "ake_wrong"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted",
         "patch_identity": "knowledge-patch-x"},
        {"op": "apply_patch"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted", "patch": "last"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "accepted", "patch": "last"},
        {"op": "resolve", "project": "book", **a(0), "revision": 1, "resolution": "rejected"},
        {"op": "materialize", "project": "book", **a(0), "revision": 1},
        {"op": "materialize", "project": "book", **a(2), "revision": 1},
        {"op": "materialize", "project": "book", **a(1), "revision": 1},
        # The latest patch is A[1]'s: accepting A[2] with it fails; A[1]'s own patch is not on disk yet
        # (the entry on disk still carries the old claim fingerprint).
        {"op": "resolve", "project": "book", **a(2), "revision": 1, "resolution": "accepted", "patch": "last"},
        {"op": "resolve", "project": "book", **a(1), "revision": 1, "resolution": "accepted", "patch": "last"},
        {"op": "materialize", "project": "book", "artifact": "L", "proposal": 0, "revision": 1},
        {"op": "artifact", "run": "run-a", "as": "L4", "kind": "knowledge_proposal",
         "payload": {**LEGACY, "proposal_group_id": "kpg_forged", "proposals": [{**LEGACY_ITEM, "proposal_id": "kpp_forged",
                                                                                "claim_fingerprint": "sha256:" + "a" * 64}]}},
        {"op": "materialize", "project": "book", "artifact": "L4", "proposal": 0, "revision": 1},
        # Evidence drift on the accepted proposal's project file source; a second refresh adds nothing.
        {"op": "author_write", "project": "book", "path": "设定/钟楼.md", "content": "钟楼在城南。\n"},
        {"op": "refresh", "project": "book"},
        {"op": "refresh", "project": "book"},
        # Revise: wrong count, stale revision, request rejections, then a real revision.
        {"op": "revise", "project": "book", "artifact": "A", "revision": 1, "proposals": [EXTEND]},
        {"op": "revise", "project": "book", "artifact": "A", "revision": 2, "proposals": [CREATE, EXTEND, CONFLICT]},
        {"op": "revise", "project": "book", "artifact": "A", "revision": 1,
         "proposals": [CREATE, {k: v for k, v in EXTEND.items() if k != "title"}, CONFLICT]},
        {"op": "revise", "project": "book", "artifact": "A", "revision": 1, "proposals": [CREATE, {**EXTEND, "title": 3}, CONFLICT]},
        {"op": "revise", "project": "book", "artifact": "A", "revision": 1,
         "proposals": [CREATE, {**EXTEND, "claim": "灵力不能跨界使用，违者反噬七日。", "extra": 1}, SUPERSEDE], "as": "A2"},
        {"op": "query", "project": "book"},
        {"op": "materialize", "project": "book", **a(1), "revision": 1},
        {"op": "revise", "project": "book", "artifact": "A", "revision": 1, "proposals": [CREATE, EXTEND, CONFLICT]},
        {"op": "materialize", "project": "book", "artifact": "A2", "proposal": 1, "revision": 2},
        {"op": "materialize", "project": "book", "artifact": "A2", "proposal": 0, "revision": 2},
        {"op": "resolve", "project": "book", "artifact": "A2", "proposal": 1, "revision": 2, "resolution": "rejected"},
        # An accepted proposal whose evidence is still current: refresh leaves it alone.
        {"op": "materialize", "project": "book", "artifact": "A2", "proposal": 2, "revision": 2},
        {"op": "apply_patch"},
        {"op": "resolve", "project": "book", "artifact": "A2", "proposal": 2, "revision": 2, "resolution": "accepted",
         "patch": "last"},
        {"op": "refresh", "project": "book"},
        {"op": "materialize", "project": "book", "artifact": "C", "proposal": 0, "revision": 1},
        {"op": "materialize", "project": "book", "artifact": "C", "proposal": 1, "revision": 1},
        {"op": "revise", "project": "book", "artifact": "A2", "revision": 2, "proposals": [EXTEND, SUPERSEDE]},
        # Lookup and ownership failures, a revise whose rebuild fails, request rejections.
        {"op": "materialize", "project": "book", "artifact": 999, "proposal_id": "kpp_x", "revision": 1},
        {"op": "materialize", "project": "book", "artifact": "R", "proposal_id": "kpp_x", "revision": 1},
        {"op": "materialize", "project": "book", "artifact": "B", "proposal": 0, "revision": 1},
        {"op": "materialize", "project": "book", "artifact": "C", "proposal_id": "kpp_missing", "revision": 1},
        {"op": "resolve", "project": "book", "artifact": "C", "proposal": 0, "revision": 1, "resolution": "maybe"},
        {"op": "revise", "project": "book", "artifact": "C", "revision": 1,
         "proposals": [{**RETIRE, "related_knowledge_ids": []}, DISPUTE, CONFLICT2]},
        # Only invalidation events carry item lists; a rejection with one changes nothing.
        {"op": "raw_event", "run": "run-b", "event_type": "knowledge_proposal_rejected",
         "payload": {"artifact": "C", "proposal_ids_of": [2]}},
        # An invalidation without item ids retires the whole group (older history).
        {"op": "raw_event", "run": "run-b", "event_type": "knowledge_proposal_invalidated", "payload": {"artifact": "B"}},
        {"op": "query", "project": "other"},
        {"op": "materialize", "project": "other", "artifact": "B", "proposal": 0, "revision": 1},
        {"op": "query", "project": "book"},
        {"op": "artifact", "run": "run-b", "as": "J", "kind": "knowledge_proposal", "payload": JUNK},
        {"op": "materialize", "project": "other", "artifact": "J", "proposal": 0, "revision": 1},
    ]


def p4_knowledge_inbox_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-knowledge-inbox-") as (api, run_dir):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from pydantic import ValidationError
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.db.base import Base
        from app.domains.agent_runs import service_lifecycle
        from app.domains.agent_runs.events import knowledge_inbox as inbox
        from app.domains.agent_runs.events import knowledge_materialization as materialization
        from app.domains.agent_runs.fs import knowledge_entries as ke
        from app.domains.agent_runs.fs import knowledge_proposals as proposals_module
        from app.domains.agent_runs.fs_safety import FsToolError
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
        from app.domains.agent_runs.schemas import (
            KnowledgeProposalInboxRead,
            KnowledgeProposalMaterializeRequest,
            KnowledgeProposalPatchRead,
            KnowledgeProposalResolveRequest,
            KnowledgeProposalReviseRequest,
        )
        from app.domains.agent_runs.service_store import record_agent_artifact, record_agent_event
        from app.domains.assistant.models import AssistantSession  # noqa: F401 - registers the FK target

        counter = {"value": 0}

        def fake_uuid():
            counter["value"] += 1
            return UUID(f"00000000-0000-4000-8000-{counter['value']:012x}")

        class FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(*FIXED_NOW, tzinfo=tz)

        proposals_module.uuid4 = fake_uuid
        proposals_module.datetime = FixedDatetime

        def entry(id_, title, claim, *, kind="world_rule", sources=None):
            return ke.KnowledgeEntry(
                id=id_, status="active", kind=kind, evidence_state="current", title=title, claim=claim,
                sources=tuple(sources or (ke.KnowledgeSource(type="author_statement", agent_event_id="ake_1"),)),
                claim_fingerprint=ke.knowledge_claim_fingerprint(title, claim), created_at="2026-10-01T00:00:00Z",
                updated_at="2026-10-02T00:00:00Z")

        tower = "钟楼在城北。\n"
        book_files = {
            "设定/世界观.md": "世界观草稿。\n\n" + ke.render_knowledge_entry(entry(ID1, "灵力规则", "灵力不能跨界使用，违者反噬。")),
            "设定/钟楼.md": tower,
            "人物/主角.md": ke.render_knowledge_entry(entry(ID2, "钟楼", "钟楼只在子时响。", kind="timeline_fact", sources=(
                ke.KnowledgeSource(type="project_file", path="设定/钟楼.md",
                                   content_sha256="sha256:" + hashlib.sha256(tower.encode()).hexdigest()),))),
        }
        other_files = {"设定/别处.md": "别处。\n"}
        projects = {"book": Project(run_dir, "book", book_files), "other": Project(run_dir, "other", other_files)}
        roots = {name: str(project.root) for name, project in projects.items()}
        roots["missing"] = str(run_dir / "missing")
        book_fingerprint = proposals_module.project_fingerprint(roots["book"])
        other_fingerprint = proposals_module.project_fingerprint(roots["other"])
        fingerprints = {book_fingerprint: "$FINGERPRINT", other_fingerprint: "$OTHER_FINGERPRINT"}

        owned = ((projects["other"].root, "$OTHER"), (projects["book"].root, "$ROOT"), (run_dir / "missing", "$MISSING"))

        def mask(value):
            if isinstance(value, str):
                for path, label in owned:
                    value = value.replace(str(path), label).replace(path.as_posix(), label)
                for fingerprint, label in fingerprints.items():
                    value = value.replace(fingerprint, label)
                return value
            if isinstance(value, dict):
                return {key: mask(item) for key, item in value.items()}
            if isinstance(value, list):
                return [mask(item) for item in value]
            return value

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        labels: dict[str, int] = {}
        seen = {"events": 0, "artifacts": 0}
        last_patch: dict = {}

        def run_row(public_id):
            row = db.query(AgentRun).filter(AgentRun.public_id == public_id).one()
            db.refresh(row)
            return row

        def artifact_id(op):
            return labels[op["artifact"]] if isinstance(op["artifact"], str) else op["artifact"]

        def proposal_id(op):
            if "proposal_id" in op:
                return op["proposal_id"]
            payload = db.get(AgentArtifact, artifact_id(op)).payload
            return payload["proposals"][op["proposal"]]["proposal_id"]

        def new_rows(model, key, columns):
            db.expire_all()
            rows = db.query(model).filter(model.id > seen[key]).order_by(model.id).all()
            if rows:
                seen[key] = rows[-1].id
            return [{column: getattr(row, column) for column in columns} for row in rows]

        def write(project, path, raw: bytes):
            before = snapshot(projects[project].root)
            target = projects[project].root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            return tree_diff(before, snapshot(projects[project].root))

        records = []
        for op in operations():
            record: dict = {"op": op}
            kind = op["op"]
            root = roots.get(op.get("project", ""), "")
            try:
                if kind == "start":
                    service_lifecycle.start_agent_user_message_run(
                        db, agent_session_id=op["session"], message={"user_message": "整理设定", "run_id": op["run"]})
                elif kind == "propose":
                    group = proposals_module.build_knowledge_proposal_group(root, op["payload"])
                    row = record_agent_artifact(db, run_row(op["run"]), kind=proposals_module.KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
                                                payload=group, requires_confirmation=False)
                    labels[op["as"]] = row.id
                elif kind == "artifact":
                    payload = json.loads(json.dumps(op["payload"]).replace("$OTHER_FINGERPRINT", other_fingerprint)
                                         .replace("$FINGERPRINT", book_fingerprint)
                                         .replace("$LEGACY_CLAIM", ke.knowledge_claim_fingerprint("旧档", "旧档断言。")))
                    labels[op["as"]] = record_agent_artifact(db, run_row(op["run"]), kind=op["kind"], payload=payload).id
                elif kind == "raw_event":
                    target = labels[op["payload"]["artifact"]]
                    payload = {"artifact_id": target}
                    if "proposal_ids_of" in op["payload"]:
                        items = db.get(AgentArtifact, target).payload["proposals"]
                        payload["proposal_ids"] = [items[index]["proposal_id"] for index in op["payload"]["proposal_ids_of"]]
                    record_agent_event(db, run_row(op["run"]), event_type=op["event_type"], actor="author", payload=payload)
                elif kind == "query":
                    record["result"] = KnowledgeProposalInboxRead.model_validate(
                        inbox.query_knowledge_proposal_inbox(db, root)).model_dump(mode="json", exclude_none=True)
                elif kind == "refresh":
                    record["result"] = KnowledgeProposalInboxRead.model_validate(
                        inbox.refresh_knowledge_evidence(db, root)).model_dump(mode="json", exclude_none=True)
                elif kind == "revise":
                    request = KnowledgeProposalReviseRequest(project_root=root, artifact_id=artifact_id(op),
                                                             revision=op["revision"], proposals=op["proposals"])
                    result = inbox.revise_knowledge_proposal_group(
                        db, project_root=request.project_root, artifact_id=request.artifact_id, revision=request.revision,
                        proposals=[item.model_dump(exclude_none=True) for item in request.proposals])
                    record["result"] = KnowledgeProposalInboxRead.model_validate(result).model_dump(
                        mode="json", exclude_none=True)
                    if "as" in op:
                        labels[op["as"]] = db.query(AgentArtifact).order_by(AgentArtifact.id.desc()).first().id
                elif kind == "resolve":
                    patch_identity = op.get("patch_identity")
                    confirmation = op.get("author_confirmation_event_id")
                    if op.get("patch") == "last":
                        patch_identity = last_patch["id"]
                        confirmation = op.get("author_confirmation_event_id", last_patch["author_confirmation_event_id"])
                    request = KnowledgeProposalResolveRequest(
                        project_root=root, artifact_id=artifact_id(op), revision=op["revision"],
                        proposal_id=proposal_id(op), resolution=op["resolution"], patch_identity=patch_identity,
                        author_confirmation_event_id=confirmation)
                    record["result"] = KnowledgeProposalInboxRead.model_validate(inbox.resolve_knowledge_proposal(
                        db, project_root=request.project_root, artifact_id=request.artifact_id, revision=request.revision,
                        proposal_id=request.proposal_id, resolution=request.resolution,
                        patch_identity=request.patch_identity,
                        author_confirmation_event_id=request.author_confirmation_event_id,
                    )).model_dump(mode="json", exclude_none=True)
                elif kind == "materialize":
                    request = KnowledgeProposalMaterializeRequest(project_root=root, artifact_id=artifact_id(op),
                                                                  revision=op["revision"], proposal_id=proposal_id(op))
                    patch = materialization.materialize_knowledge_proposal(
                        db, project_root=request.project_root, artifact_id=request.artifact_id, revision=request.revision,
                        proposal_id=request.proposal_id)
                    record["result"] = KnowledgeProposalPatchRead.model_validate(patch).model_dump(mode="json")
                    last_patch = patch
                elif kind == "apply_patch":
                    record["writes"] = write("book", last_patch["relative_path"], last_patch["after"].encode())
                elif kind == "author_write":
                    record["writes"] = write(op["project"], op["path"], op["content"].encode())
            except ValidationError:
                db.rollback()
                record["error"] = {"status": 422}
            except ValueError as exc:
                db.rollback()
                record["error"] = {"status": 409, "message": str(exc)}
            except FsToolError as exc:
                db.rollback()
                record["error"] = {"status": 500, "type": type(exc).__name__, "message": str(exc)}
            record["events"] = new_rows(AgentRunEvent, "events", ("id", "run_id", "event_type", "actor", "message",
                                                                  "payload", "sequence"))
            record["artifacts"] = new_rows(AgentArtifact, "artifacts", ("id", "run_id", "kind", "payload",
                                                                        "requires_confirmation"))
            records.append(mask(record))
        return {
            "format_version": 1,
            "suite": "p4-knowledge-inbox",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "fixed_now": list(FIXED_NOW),
            "projects": {
                "book": {name: encoded(text.encode()) for name, text in book_files.items()},
                "other": {name: encoded(text.encode()) for name, text in other_files.items()},
            },
            "records_json": json.dumps(records, ensure_ascii=False),
        }
