"""Conversation context oracle (P3-4): the real ORM on in-memory sqlite drives conversation history projection,
model compaction checkpoints (scripted provider quoting every source), the loop's message assembly, and the
tool-feedback summaries. Rows are recorded so the TS replay feeds its own store the same facts."""

from __future__ import annotations

import hashlib
import json
import os

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, isolated_fs_oracle, stable

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/compaction.py",
    "app/domains/agent_runs/compaction_sources.py",
    "app/domains/agent_runs/loop/prompt_context.py",
    "app/domains/agent_runs/loop/support.py",
    "app/domains/agent_runs/loop_runtime.py",
]
CANON = {
    "version": 1,
    "entities": [{"id": "lin", "canonical_name": "林舟", "aliases": ["阿舟"]},
                 {"id": "shen", "canonical_name": "沈禾", "aliases": []}],
    "invariants": {"lifespan": [{"entity": "shen", "exits_after_chapter": 2, "reason": "离开铁城"}],
                   "single_holder": [{"item": "旧钥匙", "holder": "林舟", "from_chapter": 1}]},
}
PLAN = {"version": 1, "premise": "林舟寻找钟楼。", "chapters": [
    {"ordinal": 1, "title": "风起", "goal": "开门", "status": "done", "path": "正文/第001章.md"},
    {"ordinal": 2, "title": "夜行", "goal": "出发", "status": "pending"}]}
FILES = {
    "正文/第001章.md": "第一章 风起\n\n林舟推开门。\n他握紧旧钥匙。\n",
    "正文/第002章.md": "第二章 夜行\n\n沈禾问路。\n",
    "人物/主角.md": "# 林舟\n\n左臂有旧伤。\n",
    "大纲/总纲.md": "总纲。\n",
    ".storyforge/canon/canon.json": json.dumps(CANON, ensure_ascii=False, indent=2) + "\n",
    ".storyforge/serial-plan.json": json.dumps(PLAN, ensure_ascii=False, indent=2) + "\n",
    ".storyforge/agent-instructions.md": "多用短句。\n他一律叫老陈。\n",
}


def quote_entries(model_input: dict, *, category: str = "decision") -> list[dict]:
    """The scripted compaction model: one entry per new source, quoting its first ten code points."""
    return [{"category": category, "text": f"摘要 {source['key']}", "source_id": source["key"],
             "quote": source["content"][:10]} for source in model_input["new_sources"]]


def p3_conversation_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-conversation-") as (api, run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.db.base import Base
        from app.domains.agent_runs import compaction, loop_runtime
        from app.domains.agent_runs.compaction_sources import ContextBudgetError
        from app.domains.agent_runs.loop import prompt_context, support
        from app.domains.agent_runs.loop.author_view import AuthorView
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
        from app.domains.agent_runs.tools.runtime_arguments import chat_context_block
        from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
        from app.platform.ai_sdk import ChatResponse, TokenUsage, ToolCall

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        records: list[dict] = []

        def record(fn, args, run_fn, errors=(ContextBudgetError, compaction.CompactionRejected)):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            records.append(row)

        def new_session(title):
            item = AssistantSession(title=title, task_type="assistant", project_path=None)
            db.add(item)
            db.commit()
            return item.id

        def message(sid, role, content):
            db.add(AssistantMessage(session_id=sid, role=role, content=content))
            db.commit()

        def tool_call(sid, name, status="completed", input_summary=None, output_summary=None, related=None):
            db.add(AssistantToolCall(session_id=sid, tool_name=name, status=status,
                                     input_summary=input_summary or {}, output_summary=output_summary or {},
                                     related_type=related[0] if related else None,
                                     related_id=related[1] if related else None))
            db.commit()

        def new_run(sid, public_id):
            item = AgentRun(public_id=public_id, session_id="sess-" + public_id, assistant_session_id=sid,
                            goal="g", scope={}, permission_profile="ask", budget={}, status="completed",
                            root_plan=[], current_step=None)
            db.add(item)
            db.commit()
            return item

        def event(run_row, event_type, payload, message_text="m"):
            sequence = 1 + sum(1 for e in db.query(AgentRunEvent).filter(AgentRunEvent.run_id == run_row.id))
            db.add(AgentRunEvent(run_id=run_row.id, event_type=event_type, actor="agent-runtime",
                                 message=message_text, payload=payload, sequence=sequence))
            db.commit()

        def artifact(run_row, kind, payload, requires_confirmation=False):
            item = AgentArtifact(run_id=run_row.id, kind=kind, payload=payload,
                                 requires_confirmation=requires_confirmation)
            db.add(item)
            db.commit()
            return item

        def rows(sid):
            runs = [r.id for r in db.query(AgentRun).filter(AgentRun.assistant_session_id == sid)]
            return {
                "messages": [{"id": m.id, "role": m.role, "content": m.content}
                             for m in db.query(AssistantMessage).filter(AssistantMessage.session_id == sid)
                             .order_by(AssistantMessage.id)],
                "tool_calls": [{"id": c.id, "tool_name": c.tool_name, "status": c.status,
                                "input_summary": c.input_summary, "output_summary": c.output_summary,
                                "related_type": c.related_type, "related_id": c.related_id}
                               for c in db.query(AssistantToolCall).filter(AssistantToolCall.session_id == sid)
                               .order_by(AssistantToolCall.id)],
                "events": [{"id": e.id, "run_id": e.run_id, "event_type": e.event_type, "sequence": e.sequence,
                            "message": e.message, "payload": e.payload}
                           for e in db.query(AgentRunEvent).filter(AgentRunEvent.run_id.in_(runs))
                           .order_by(AgentRunEvent.id)],
                "artifacts": [{"id": a.id, "run_id": a.run_id, "kind": a.kind,
                               "requires_confirmation": a.requires_confirmation, "payload": a.payload}
                              for a in db.query(AgentArtifact).filter(AgentArtifact.run_id.in_(runs))
                              .order_by(AgentArtifact.id)],
            }

        def history(label, sid):
            record("project_conversation_history", {"label": label, "session": sid, "rows": rows(sid)},
                   lambda: compaction.project_conversation_history(db, sid))

        class Provider:
            def __init__(self, mode="ok"):
                self.mode = mode

            def complete(self, request):
                model_input = json.loads(request.messages[1].content)
                calls.append({"system": request.messages[0].content, "user": request.messages[1].content,
                              "max_tokens": request.max_tokens, "metadata": dict(request.metadata),
                              "model": request.model})
                usage = TokenUsage(30, 20, 50, source="provider_usage")
                if self.mode == "length":
                    return ChatResponse("{}", finish_reason="length", usage=usage)
                if self.mode == "tool":
                    return ChatResponse("{}", tool_calls=(ToolCall("t", "x", "{}"),), finish_reason="stop", usage=usage)
                if self.mode == "not-json":
                    return ChatResponse("不是 JSON", finish_reason="stop", usage=usage)
                if self.mode == "extra-key":
                    return ChatResponse(json.dumps({"entries": quote_entries(model_input), "x": 1}), finish_reason="stop")
                entries = quote_entries(model_input)
                if self.mode == "missing-source":
                    entries = entries[1:]
                elif self.mode == "bad-quote":
                    entries[0]["quote"] = "不存在的引用"
                elif self.mode == "bad-category":
                    entries[0]["category"] = "other"
                elif self.mode == "long-text":
                    entries[0]["text"] = "长" * 2001
                elif self.mode == "medium-text":
                    entries[0]["text"] = "长" * 500
                elif self.mode == "secret":
                    entries[0]["text"] = f"包含 {SECRET} 的摘要"
                return ChatResponse(json.dumps({"entries": entries}, ensure_ascii=False), finish_reason="stop",
                                    usage=usage)

        calls: list[dict] = []

        def checkpoint(label, sid, mode="ok"):
            calls.clear()

            def execute():
                payload = compaction.create_compaction_checkpoint(db, sid, provider=Provider(mode), model="m-compact")
                return {"payload": payload, "calls": list(calls)}
            record("create_compaction_checkpoint", {"label": label, "session": sid, "mode": mode, "rows": rows(sid)},
                   execute)
            row = records[-1]
            return json.loads(row["output_json"])["payload"] if "output_json" in row else None

        # S1: empty session.
        empty = new_session("空")
        history("empty", empty)
        # S2: messages, tool calls, events and artifacts across two runs.
        evid = new_session("证据")
        message(evid, "user", "帮我看看第一章")
        message(evid, "assistant", "第一章节奏偏慢。")
        r1 = new_run(evid, "run-a")
        r2 = new_run(evid, "run-b")
        event(r1, "agent_plan_created", {"plan": []})
        event(r1, "permission_required", {"reason": "requires_user_confirmation"})
        event(r1, "permission_approved", {"control_effect": "applied"})
        event(r2, "permission_required", {})
        event(r2, "permission_denied", {"control_effect": "ignored"})
        event(r2, "agent_run_completed", {"control_type": "deny_permission"})
        event(r1, "agent_run_completed", {"result": "x"})
        event(r2, "stop_run", {"control_effect": "requested"})
        event(r1, "agent_run_interrupted", {"run_status": "paused"})
        event(r1, "pause_run", {"control_effect": "ignored"})
        event(r2, "knowledge_proposal_accepted", {"proposal_id": "p"})
        artifact(r1, "review_report", {"issues": [{"id": "plot-1", "message": "节奏"}], "content": "原文" * 3})
        artifact(r1, "proposed_patch", {"id": "patch-1", "before": "旧", "after": "新",
                                        "nested": [{"original_text": "o", "x": 1}]}, True)
        artifact(r2, "runtime_checkpoint", {"x": 1})
        artifact(r2, "model_request_evidence", {"x": 1})
        artifact(r2, "system_summary", {"x": 1})
        artifact(r2, "review_report", {"\U00020000": 1, "\ue000": 2, "z": 3})
        r3 = new_run(evid, "run-c")
        event(r3, "permission_required", {})
        event(r3, "permission_approved", {"control_effect": "ignored"})
        tool_call(evid, "fs.read", input_summary={"path": "正文/第001章.md"}, output_summary={"returned_chars": 10})
        tool_call(evid, "conversation.compact")
        tool_call(evid, "file.revise", status="failed", input_summary={"content": "长" * 5}, related=("agent_run", r1.id))
        message(evid, "user", "接受这版。")
        history("evidence", evid)
        # S3: model compaction checkpoints, a tampered checkpoint, then a second generation with a parent.
        long_session = new_session("长会话")
        message(long_session, "user", "😀😀😀开场白：" + "内容" * 40)
        for index in range(14):
            message(long_session, "user" if index % 2 == 0 else "assistant", f"第{index}条消息：" + "内容" * 40)
        lr = new_run(long_session, "run-long")
        event(lr, "permission_required", {})
        tool_call(long_session, "fs.list", output_summary={"entry_count": 3})
        first = checkpoint("first", long_session)
        stored = artifact(lr, "system_compaction", first)
        artifact(lr, "system_compaction", {**first, "checkpoint_digest": "0" * 64})
        artifact(lr, "system_compaction", {**first, "status": "running"})
        artifact(lr, "system_compaction", {**first, "schema_version": 1})
        message(long_session, "user", "继续写第三章。")
        message(long_session, "assistant", "好的，我先读第二章。")
        history("after-first-checkpoint", long_session)
        for index in range(10):
            message(long_session, "user" if index % 2 == 0 else "assistant", f"后续{index}：" + "继续" * 30)
        second = checkpoint("second", long_session)
        artifact(lr, "system_compaction", second)
        artifact(lr, "system_compaction", {**second, "parent": {"artifact_id": stored.id, "checkpoint_digest": "1" * 64}})
        from app.domains.agent_runs.compaction_sources import content_digest, evidence_sources, message_sources

        def seal(payload):
            body = {key: value for key, value in payload.items() if key != "checkpoint_digest"}
            return {**body, "checkpoint_digest": content_digest(body)}

        def forged_cover(base, keep):
            refs = base["source_messages"][:keep]
            covered = message_sources(db, long_session)[:keep]
            keys = {ref["key"] for ref in refs} | {ref["key"] for ref in base["source_evidence"]}
            return {**base, "source_messages": refs, "coverage_digest": content_digest(refs),
                    "covered_through_message_id": covered[-1]["id"],
                    "author_ledger": [source for source in covered if source["role"] == "user"],
                    "entries": [entry for entry in base["entries"] if entry["source_id"] in keys], "parent": None}

        last_user = max(index for index, ref in enumerate(first["source_messages"]) if ref["role"] == "user")
        forged = {
            "ends-on-user": seal(forged_cover(first, last_user + 1)),
            "ledger": seal({**first, "author_ledger": []}),
            "evidence-ref": seal({**first, "source_evidence": [{**first["source_evidence"][0], "digest": "f" * 64},
                                                                *first["source_evidence"][1:]]}),
            "uncited": seal({**first, "entries": [entry for entry in first["entries"]
                                                  if entry["source_id"] != first["source_evidence"][0]["key"]]}),
            "parent-digest": seal({**second, "parent": {"artifact_id": stored.id, "checkpoint_digest": "1" * 64}}),
            "parent-entries": seal({**second, "entries": [{**second["entries"][0], "text": "改过的摘要"},
                                                          *second["entries"][1:]]}),
        }
        assert evidence_sources(db, long_session)
        for payload in forged.values():
            artifact(lr, "system_compaction", payload)
        history("after-second-checkpoint", long_session)
        checkpoint("nothing-new", long_session)
        for mode in ("long-text", "medium-text", "length", "tool", "not-json", "extra-key", "missing-source", "bad-quote", "bad-category", "secret"):
            message(long_session, "user", f"新消息 {mode}" + "字" * 20)
            message(long_session, "assistant", f"回复 {mode}")
            checkpoint(f"mode-{mode}", long_session, mode)
        short = new_session("短会话")
        message(short, "user", "你好")
        checkpoint("below-threshold", short)
        no_assistant = new_session("无回复")
        for index in range(14):
            message(no_assistant, "user", f"只有作者在说话 {index}" + "字" * 40)
        checkpoint("no-assistant-cut", no_assistant)
        many = new_session("多 run")
        message(many, "user", "看看")
        runs_ = [new_run(many, f"run-m{index}") for index in range(10)]
        for run_row in reversed(runs_):
            event(run_row, "permission_required", {})
        history("many-runs", many)
        twelve = new_session("十二条")
        for index in range(12):
            message(twelve, "user" if index % 2 == 0 else "assistant", f"短 {index}")
        checkpoint("exactly-twelve", twelve)
        # S4: the history budget.
        huge = new_session("超长")
        message(huge, "user", "长" * 45_000)
        history("over-budget", huge)

        # The loop's message assembly over a synthetic project.
        book = Project(run, "book", FILES)
        root = str(book.root)
        for label, sid, current_file, args in [
            ("full", evid, "正文/第002章.md", {
                "author_view": {"file_path": "正文/第002章.md", "cursor_line": 2, "selection_text": ""},
                "content": "第二章 夜行\n\n沈禾问路。\n",
                "context_bundle": {"files": [{"relative_path": "人物/主角.md", "kind": "character",
                                              "excerpt": "左臂有旧伤。"}]}}),
            ("selection", empty, None, {"author_view": {"selection_text": "林舟推开门。"}}),
            ("bare", empty, "大纲/总纲.md", {}),
            ("checkpointed", long_session, "正文/第001章.md", {}),
        ]:
            provenance: dict = {}

            def assemble(sid=sid, current_file=current_file, args=args, provenance=provenance):
                # The desktop sends the open tab as an absolute path.
                absolute = str(book.root / current_file) if current_file else None
                messages = loop_runtime._storyforge_messages(
                    db, assistant_session_id=sid, user_message="  帮我检查一下  ", project_path=root,
                    current_file=absolute, author_view=AuthorView.from_payload(args),
                    pinned_context=chat_context_block(args), provenance=provenance)
                for section in provenance["sections"]:
                    # A digest over text that embeds the temporary root is not reproducible; TS recomputes it.
                    entries = [messages[index] for index in section["message_indices"]]
                    if any(str(book.root) in entry["content"] for entry in entries):
                        section["sha256"] = "<root-dependent>"
                return {"messages": messages, "provenance": provenance}
            book.call("storyforge_messages", {"label": label, "session": sid, "current_file": current_file,
                                              "args": args, "rows": rows(sid)}, assemble, typed_args=True)
        plain = Project(run, "plain", {"笔记.md": "无\n"})
        plain.call("storyforge_messages", {"label": "plain-project", "session": empty, "current_file": None,
                                           "args": None, "rows": rows(empty)},
                   lambda: {"messages": loop_runtime._storyforge_messages(
                       db, assistant_session_id=empty, user_message="hi", project_path=str(plain.root),
                       current_file=None, author_view=None, pinned_context=None)}, typed_args=True)

        outputs = {
            "fs.list": {"entries": [1, 2], "truncated": False}, "fs.read": {"path": "a.md", "returned_chars": 3,
                                                                             "truncated": True},
            "project.consistency": {"scanned_files": 2, "term_occurrences": [1], "time_markers": [], "repeated_clauses": [1, 2]},
            "project.prose_check": {"path": "a.md", "issue_count": 2, "dimension_counts": {"a": 1}},
            "project.collapse_check": {"path": "a.md", "verdict": {"status": "warn", "issues": [1]}},
            "project.entity_budget_check": {"path": "a.md", "chapter": 3, "verdict": "bad"},
            "project.promise_check": {"current_chapter": 4, "promise_count": 1, "conflict_count": 0, "advisory_count": 2},
            "project.plan_update": {"planned_total": 3, "next_ordinal": 2, "created_count": 1, "updated_count": 0},
            "project.cross_chapter_check": {"chapter_count": 2, "finding_count": 1, "model": "m"},
            "project.deep_consistency": {"path": "a.md", "issue_count": 0, "bible_files": ["x"]},
            "project.canon": {"entity_count": 3, "conflict_count": 1, "advisory_count": 0},
            "project.canon_delta": {"proposals": {"new_entities": [1], "known_entities": []}, "alias_conflicts": [],
                                    "new_conflicts": [1], "new_advisories": []},
            "project.hooks_delta": {"new_hooks": [1, 2], "duplicates": [], "pattern_hits": [1]},
            "file.review": {"review_report": {"file_path": "a.md", "issues": [1, 2], "mode": "llm"}},
            "project.trim_prose": {"file_path": "a.md", "trim_audit": {"original_chars": 10, "compressed_chars": 8,
                                                                       "actual_percent": 20.0, "target_percent": 15},
                                   "model": "m"},
            "prose.continue": {"file_path": "a.md", "anchor_line": 3, "inserted_chars": 100, "model": "m"},
            "file.revise": {"file_path": "a.md", "after": "新的正文𠀀", "model": "m", "proposed_patch": {"id": "p1"}},
            "file.create": {"file_path": "b.md", "after": None, "model": "m", "proposed_patch": "x"},
            "chapter.polish": {"file_path": "c.md", "after": "抛光", "model": "m"},
            "fs.search": {"matches": [1], "scanned_files": 3, "truncated": False},
            "knowledge.propose": {"proposal_count": 1},
        }
        for name, output in outputs.items():
            record("tool_output_summary", {"name": name, "output": output},
                   lambda name=name, output=output: support.tool_output_summary(name, output))
        record("tool_output_summary", {"name": "project.trim_prose", "output": {"file_path": "a.md"}},
               lambda: support.tool_output_summary("project.trim_prose", {"file_path": "a.md"}))
        for output in [{"a": "中文"}, {"text": "x" * 30_000}, {"emoji": "😀" * 12_000}, {"n": 2.0, "m": [1, None]}]:
            record("serialize_tool_output", {"output": output}, lambda output=output: support.serialize_tool_output(output))
        reports = [{}, {"review_report": "x"}, {"review_report": {"file_path": "a.md", "mode": "llm", "issues": [
            {"id": f"i{index}", "category": "plot", "severity": "high", "code": "c", "message": "m",
             "suggested_action": None, "extra": 1} for index in range(22)] + ["bad"], "suggested_actions": ["s"]}}]
        for output in reports:
            record("review_feedback", {"output": output}, lambda output=output: support.review_feedback(output))
        record("revise_feedback", {"output": {"file_path": "a.md", "summary": "s", "before": "b"}},
               lambda: support.revise_feedback({"file_path": "a.md", "summary": "s", "before": "b"}))
        record("revise_feedback", {"output": {"applied_scope": {"x": 1}}},
               lambda: support.revise_feedback({"applied_scope": {"x": 1}}))
        merges = [
            ({}, None), ({}, {"input_cny": 0.5, "output_cny": 1, "total_cny": 1.5, "currency": "CNY",
                              "input_cny_per_m_tokens": 2.0, "x": 9}),
            ({"input_cny": 0.25, "total_cny": True, "currency": "USD"}, {"input_cny": 0.5, "total_cny": True,
                                                                         "cache_hit_input_cny_per_m_tokens": None}),
            ({"output_cny": None}, {"output_cny": 0.125}),
        ]
        for current, incoming in merges:
            record("merge_cost_breakdown", {"current": current, "incoming": incoming},
                   lambda current=current, incoming=incoming: support.merge_cost_breakdown(
                       current, incoming, prompt_tokens=10, completion_tokens=4, token_usage_source="provider_usage"))
        return {
            "format_version": 1,
            "suite": "p3-conversation",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book" if os.name == "nt" else "/tmp/synthetic-book",
            "secret": SECRET,
            "system_prompt": prompt_context.SYSTEM_PROMPT,
            "author_instructions_prefix": prompt_context.AUTHOR_INSTRUCTIONS_PREFIX,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "records": [stable(row, run) for row in records],
            "projects": [book.record("book"), plain.record("plain")],
        }
