"""Agent tool handler oracle (P3-3b): the real Python handlers for the read-only, check and canon
tools run on synthetic project trees; each call records its ToolResult and the bytes it wrote."""

from __future__ import annotations

import datetime as real_datetime
import hashlib
import json
import os
from pathlib import PurePosixPath, PureWindowsPath
from types import SimpleNamespace
from uuid import UUID

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, isolated_fs_oracle

SYNTHETIC_ROOT = r"D:\synthetic-book" if os.name == "nt" else "/tmp/synthetic-book"
SECRET = "sk-oracle-secret-123456"
FIXED_NOW = (2026, 10, 12, 8, 30, 0)
SOURCES = [
    "app/domains/agent_runs/fs/runtime_tools.py",
    "app/domains/agent_runs/tools/project_checks_runtime.py",
    "app/domains/agent_runs/tools/project_canon_runtime.py",
    "app/domains/agent_runs/fs_tools.py",
    "app/domains/agent_runs/fs_safety.py",
    "app/domains/agent_runs/fs/project_knowledge.py",
]

CANON = {
    "version": 1,
    "entities": [
        {"id": "lin", "canonical_name": "林舟", "aliases": ["阿舟", "舟哥"]},
        {"id": "shen", "canonical_name": "沈禾", "aliases": []},
        {"id": "key", "canonical_name": "旧钥匙", "aliases": ["铜钥匙"]},
    ],
    "invariants": {
        "single_holder": [{"item": "旧钥匙", "holder": "林舟", "from_chapter": 1},
                          {"item": "旧钥匙", "holder": "沈禾", "from_chapter": 3}],
        "timeline_order": [{"before": "风起", "after": "夜行"}],
        "lifespan": [{"entity": "shen", "exits_after_chapter": 2, "reason": "离开铁城"}],
        "promises": [{"id": "p1", "title": "钟楼的秘密", "planted_chapter": 1, "due_chapter": 2, "status": "planted"},
                     {"id": "p2", "title": "左臂旧伤", "planted_chapter": 1, "status": "resolved", "resolved_chapter": 2}],
    },
}
FILES = {
    "正文/第001章.md": "第一章 风起\n\n林舟推开门，阿舟这个名字已经很久没人叫了。\n三天后，雨停了。\n他握紧旧钥匙。\n",
    "正文/第002章.md": "第二章 夜行\n\n舟哥，你还记得钟楼吗？沈禾问。\n次日清晨，他们出发。\n他握紧旧钥匙。\n",
    "正文/第003章.md": "第三章\n\n" + "林舟沉默。" * 30 + "\n铜钥匙在沈禾手里。\n",
    "人物/主角.md": "# 林舟\n\n左臂有旧伤。别名阿舟。\n",
    "设定/规则.md": "# 规则\n\n灵力不能跨界使用。api_key=" + SECRET + "\n",
    "大纲/总纲.md": "总纲：林舟寻找钟楼。\n",
    "资料/杂记.txt": "杂记一行\n林舟在这里也出现。\n前半句\u2028林舟后半句\n",
    "正文/第004章.md": "第四章\n\n" + "风过钟楼。" * 600 + "\n    " + "钥匙" * 150 + "在林舟手里。\n",
    "notes/bin.dat": b"\x00\x01binary",
    ".storyforge/canon/canon.json": json.dumps(CANON, ensure_ascii=False, indent=2) + "\n",
    ".storyforge/agent-instructions.md": "多用短句。\n",
    "正文/空占位.md": "  \n",
}


def p3_tool_handlers_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-handlers-") as (api, run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        os.environ["STORYFORGE_LLM_MODEL"] = " cross-model "
        from app.domains.agent_runs.errors import AgentOrchestrationError
        from app.domains.agent_runs.fs import knowledge_proposals as proposals_module
        from app.domains.agent_runs.fs_tools import FsToolError
        from app.domains.agent_runs.runtime import AgentRuntime
        from app.domains.agent_runs.tools import ToolExecutionContext
        from app.domains.ide import cross_chapter_consistency as ccc

        counter = {"value": 0}

        def fake_uuid():
            counter["value"] += 1
            return UUID(f"00000000-0000-4000-8000-{counter['value']:012x}")

        class FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(*FIXED_NOW, tzinfo=tz)

        def synthetic_fingerprint(_root=None):
            canonical = (PureWindowsPath if os.name == "nt" else PurePosixPath)(SYNTHETIC_ROOT).as_posix()
            if os.name == "nt":
                canonical = canonical.casefold()
            return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"

        proposals_module.uuid4 = fake_uuid
        proposals_module.datetime = FixedDatetime
        proposals_module.project_fingerprint = synthetic_fingerprint

        llm_calls: list[dict] = []
        llm_replies: list = []

        def fake_call_llm(source, *, system_prompt, user_prompt):
            llm_calls.append({"system": system_prompt, "user": user_prompt})
            reply = llm_replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply

        ccc._call_llm = fake_call_llm
        runtime = AgentRuntime(SimpleNamespace())

        class FakeSession:
            def __init__(self, existing=None, payloads=()):
                self.existing, self.payloads = existing, list(payloads)

            def scalar(self, _statement):
                return self.existing

            def scalars(self, _statement):
                return [SimpleNamespace(payload=payload) for payload in self.payloads]

        def result_record(result):
            return {
                "status": result.status, "output": result.output, "trace": result.trace.as_dict(),
                "summary": result.summary, "payload": result.payload,
                "artifacts": [[a.kind, a.payload, a.requires_confirmation] for a in result.artifacts],
                "metrics": result.metrics,
            }

        from app.domains.agent_runs.fs import knowledge_entries as ke

        existing_rule = ke.render_knowledge_entry(ke.KnowledgeEntry(
            id="pk_00000000-0000-4000-8000-0000000000aa", status="active", kind="world_rule", evidence_state="current", title="新规",
            claim="旧的规则断言。", sources=(ke.KnowledgeSource(type="author_statement", agent_event_id="ake_1"),),
            claim_fingerprint=ke.knowledge_claim_fingerprint("新规", "旧的规则断言。"),
            created_at="2026-10-01T00:00:00Z", updated_at="2026-10-02T00:00:00Z", superseded_by=None))
        wide_rule = ke.render_knowledge_entry(ke.KnowledgeEntry(
            id="pk_00000000-0000-4000-8000-0000000000bb", status="active", kind="world_rule",
            evidence_state="current", title="Rule", claim="半角标题。",
            sources=(ke.KnowledgeSource(type="author_statement", agent_event_id="ake_2"),),
            claim_fingerprint=ke.knowledge_claim_fingerprint("Rule", "半角标题。"),
            created_at="2026-10-01T00:00:00Z", updated_at="2026-10-02T00:00:00Z", superseded_by=None))
        project = book = Project(run, "book", {**FILES, "设定/既有规则.md": "# 既有规则\n\n" + existing_rule,
                                        "设定/半角.md": "# 半角\n\n" + wide_rule})
        calls = []

        def call(tool, payload, *, args=None, user_message="帮我看看", events=(), artifacts=(), session=None,
                 replies=None):
            context_args = dict(args or {})
            context = ToolExecutionContext(
                session=session or FakeSession(),
                run=SimpleNamespace(id=1, public_id="run-1", permission_profile="ask", goal="帮我看看",
                                    status="running", current_step="agent.loop",
                                    events=[SimpleNamespace(**e) for e in events],
                                    artifacts=[SimpleNamespace(**a) for a in artifacts]),
                agent_session_id="sess-1", assistant_session_id=7, user_message=user_message, args=context_args)
            spec = {"tool": tool, "payload": payload, "args": args or {}, "user_message": user_message,
                    "events": list(events), "artifacts": list(artifacts),
                    "session": None if session is None else {"existing": session.existing,
                                                             "payloads": session.payloads},
                    "replies": replies}
            if replies is not None:
                llm_calls.clear()
                llm_replies[:] = [RuntimeError(r["error"]) if "error" in r else r for r in replies]

            def execute():
                full = {**payload, "project_root": str(project.root)} if "project_root" not in payload else payload
                result = result_record(runtime._tool_registry.get(tool).handler(context, full))
                if replies is not None:
                    result["llm_calls"] = list(llm_calls)
                result["args_after"] = context_args
                return result

            project.call(tool, spec, execute, errors=(FsToolError, AgentOrchestrationError, ValueError),
                         typed_args=True)
            calls.append(tool)

        bundle = {"files": [{"relative_path": "人物/主角.md", "kind": "character", "excerpt": "林舟左臂有旧伤。"}]}
        call("context.load", {"file_path": "正文/第001章.md", "content": "林舟推开门。", "context_bundle": bundle,
                              "_agent_intent": "file.revise"},
             args={"agent_role_hints": ["prose_reviewer"]})
        call("context.load", {"file_path": "正文/第002章.md", "content": "正文", "context_bundle": "x"},
             args={"intent": "file.review", "file_path": "a.md", "content": "c"},
             artifacts=[{"kind": "review_report", "payload": {"issues": [{"id": "plot-1", "message": "节奏"}]}}],
             events=[{"event_type": "tool_trace", "payload": {"index": 0}}])
        call("context.load", {"file_path": "正文/第001章.md", "content": "  "})
        call("context.load", {"file_path": "正文/第001章.md", "content": "𠀀林舟😀"})
        for subpath in (None, "正文", "缺失", "../外面", ".storyforge", "正文/第001章.md"):
            call("fs.list", {} if subpath is None else {"subpath": subpath})
        for payload in [{"path": "正文/第003章.md"}, {"path": "正文/第004章.md"},
                        {"path": "正文/第003章.md", "offset": "5", "limit": "10"},
                        {"path": "正文/第003章.md", "offset": 1000}, {"path": "正文/第003章.md", "limit": 0},
                        {"path": "正文/第003章.md", "offset": -2}, {"path": ".storyforge/canon/canon.json"},
                        {"path": ".storyforge/agent-instructions.md"}, {"path": "缺失.md"}, {"path": "../x.md"},
                        {"path": "notes/bin.dat"}, {"path": "正文"}, {"path": "  "}]:
            call("fs.read", payload)
        for payload in [{"query": "林舟"}, {"query": "钥匙", "glob": "正文/*.md"}, {"query": "林舟", "glob": "*.txt"},
                        {"query": "握紧.+钥匙", "use_regex": True}, {"query": "握紧.+钥匙", "use_regex": "true"},
                        {"query": "舟[哥", "use_regex": True}, {"query": "   "}, {"query": "不存在的词"},
                        {"query": "林", "glob": "*"}, {"query": " 钥匙"}, {"query": "钥" * 210},
                        {"query": "钥匙在林舟", "glob": "正文/*.md"}, {"query": "林舟后半句", "glob": "*.txt"}]:
            call("fs.search", payload)
        for payload in [{"action": "list"}, {"action": "read", "path": "人物/主角.md"},
                        {"action": "read", "path": "设定/规则.md", "offset": 2, "limit": 5},
                        {"action": "read", "path": "正文/第001章.md"}, {"action": "search", "query": "林舟"},
                        {"action": "search", "query": "灵力.+使用", "use_regex": True},
                        {"action": "search", "query": "api_key"}, {"action": "delete"}]:
            call("project.knowledge", payload)
        proposal = {"target_path": "设定/新规.md", "operation": "create", "title": " 新规 ", "claim": "新规断言。",
                    "kind": "world_rule", "confidence": "author_declared", "reason": "作者说的",
                    "sources": [{"type": "author_statement"}]}
        twin = {**proposal, "target_path": "设定/另一条.md", "title": "另一条", "claim": "另一断言。"}
        call("knowledge.propose", {"proposals": [proposal, twin]})
        call("knowledge.propose", {"proposals": [proposal]}, args={"_knowledge_proposal_group_created": True})
        call("knowledge.propose", {"proposals": [proposal]}, session=FakeSession(existing=3))
        known_fp = hashlib.sha256(b"x").hexdigest()
        twin_fp = ke.knowledge_claim_fingerprint("另一条", "另一断言。")
        migrate = {**proposal, "operation": "migrate", "title": "新规", "claim": "迁移来的断言。",
                   "target_path": "设定/迁移.md"}
        wide = {**proposal, "title": "ＲＵＬＥ", "claim": "宽字符标题。", "target_path": "设定/宽.md"}
        call("knowledge.propose", {"proposals": [migrate, wide]})
        call("knowledge.propose", {"proposals": [proposal, twin]}, session=FakeSession(payloads=[
            {"project_fingerprint": synthetic_fingerprint(),
             "proposals": [{"claim_fingerprint": twin_fp}, {"x": 1}, "bad"]},
            {"project_fingerprint": "sha256:other", "proposals": [{"claim_fingerprint": known_fp}]}, "notdict"]))
        call("knowledge.propose", {"proposals": [proposal, twin]}, session=FakeSession(payloads=[
            {"project_fingerprint": "sha256:other", "proposals": [{"claim_fingerprint": twin_fp}]}]))
        call("knowledge.propose", {"proposals": [twin]}, session=FakeSession(payloads=[
            {"project_fingerprint": synthetic_fingerprint(), "proposals": [{"claim_fingerprint": twin_fp}]}]))
        call("knowledge.propose", {"proposals": []})
        for payload in [{"terms": ["林舟", "钟楼", " ", 3]}, {"terms": "林舟", "subpath": "正文"},
                        {"terms": ["风", "雨", "门", "钥", "钟", "楼", "夜", "行", "林", "沈", "禾"]},
                        {"terms": ["沈禾"], "glob": "*.txt"}, {"subpath": "缺失"}]:
            call("project.consistency", payload)
        for path in ("正文/第003章.md", "缺失.md"):
            call("project.prose_check", {"path": path})
        for payload in [{"path": "正文/第001章.md"},
                        {"path": "正文/第001章.md", "beats": ["开门", "握钥匙"], "emotion_before": "平静",
                         "emotion_after": "紧张", "irreversible_consequence": "钥匙被拿走", "deletable": False},
                        {"path": "正文/第001章.md", "beats": "开门"}, {"path": "正文/第001章.md", "beats": ["a", 1]},
                        {"path": "正文/第001章.md", "emotion_before": 3},
                        {"path": "正文/第001章.md", "deletable": "no"}]:
            call("project.collapse_check", payload)
        for payload in [{"path": "正文/第002章.md"},
                        {"path": "正文/第002章.md", "chapter": 31, "new_core_locations": ["钟楼"],
                         "new_mysteries": ["谜"], "new_core_evidence": ["账本"], "new_key_characters": list("abcdef"),
                         "budget_key_characters": 2, "budget_new_core_entities_after_chapter_20": 1},
                        {"path": "正文/第002章.md", "new_mysteries": "谜"}, {"path": "正文/第002章.md", "chapter": True},
                        {"path": "正文/第002章.md", "budget_new_mysteries_after_chapter_25": "1"}]:
            call("project.entity_budget_check", payload)
        for payload in [{}, {"stale_after_chapters": 1}, {"stale_after_chapters": 0},
                        {"stale_after_chapters": True}, {"stale_after_chapters": None}]:
            call("project.promise_check", payload)
        for payload in [{}, {"chapters": "x"}, {"arcs": "x"}, {"remove_ordinals": 3},
                        {"premise": "  林舟找钟楼  ", "chapter_word_count_min": 2000, "chapter_word_count_max": 4000,
                         "chapters": [{"ordinal": 1, "title": "风起", "status": "planned"},
                                      {"ordinal": 4, "title": "钟楼", "goal": "抵达"}, "bad"],
                         "arcs": [{"name": "第一卷", "chapters": [1, 4]}, 3]},
                        {"remove_ordinals": [4, "x", 2]}, {"arcs": []}, {"premise": "   "}]:
            call("project.plan_update", payload)
        reply = {"content": '[{"type":"setting","severity":"high","chapters":["第1章","第3章"],'
                            '"finding":"钥匙持有人矛盾","evidence":"握紧旧钥匙/铜钥匙在沈禾手里"}]', "latency_ms": 12}
        for payload, replies in [
            ({"paths": ["正文/第003章.md", "正文/第001章.md", " "], "focus": " 道具 "}, [reply]),
            ({"paths": "正文/第001章.md"}, None), ({"paths": ["正文/第001章.md"]}, None),
            ({"paths": ["正文/第001章.md", "正文/第002章.md"]}, [{"content": "   "}]),
        ]:
            call("project.cross_chapter_check", payload, replies=replies)
        for payload in [{}, {"refresh": False}, {"glob": "正文/*.md", "refresh": True}, {"refresh": "no"}]:
            call("project.canon", payload)
        for payload in [{}, {"entities": [{"name": "钟楼守卫", "aliases": ["守卫"]}, {"name": "林舟", "aliases": ["小舟"]},
                                          {"name": "阿舟", "aliases": []}],
                             "holder_claims": [{"item": "旧钥匙", "holder": "沈禾", "from_chapter": 3}],
                             "exit_claims": [{"entity": "林舟", "exits_after_chapter": 2, "reason": "离开"}],
                             "timeline_claims": [{"before": "夜行", "after": "风起"}]},
                        {"entities": "x"}, {"exit_claims": [1]},
                        {"promise_claims": [{"title": "钟楼的秘密", "planted_chapter": 1, "status": "advancing"},
                                            {"title": "新的谜题", "planted_chapter": 3}]},
                        {"entities": [{"name": ""}]}]:
            call("project.canon_delta", payload)
        for payload in [{}, {"observed_hooks": [{"description": "钟楼的秘密", "category": "mystery"},
                                                {"description": " 新的线索 ", "verification": "第3章", "note": "备注"}]},
                        {"evidence_text": "  他想起钟楼那晚的事，一切都还没结束。  "},
                        {"evidence_text": "𠀀😀钟楼"}, {"observed_hooks": "x"},
                        {"observed_hooks": [1]}, {"evidence_text": "   "}]:
            call("project.hooks_delta", payload)
        from app.domains.agent_runs import fs_tools

        def direct(fn, args, run_fn):
            project.call(fn, {"direct": args}, run_fn, errors=(FsToolError,), typed_args=True)

        for rel in ["正文/新章.md", "正文/空占位.md", "正文/第001章.md", "正文", "../外面.md", "  ", "正文/..",
                    "notes/新.md"]:
            direct("resolve_new_project_file", {"path": rel},
                   lambda rel=rel: fs_tools.resolve_new_project_file(str(project.root), rel))
        for rel in ["正文/第001章.md", "notes/bin.dat", "缺失.md", ".storyforge/canon/canon.json", "正文",
                    "资料/杂记.txt"]:
            def raw_read(rel=rel):
                target, content, raw = fs_tools.read_project_file_raw(str(project.root), rel)
                return {"target": target, "content": content, "raw_sha256": hashlib.sha256(raw).hexdigest()}
            direct("read_project_file_raw", {"path": rel}, raw_read)
        direct("fs_list", {"max_entries": 3}, lambda: fs_tools.fs_list(str(project.root), "正文", max_entries=3))
        direct("fs_list", {"max_entries": 0}, lambda: fs_tools.fs_list(str(project.root), None, max_entries=0))
        direct("fs_search", {"query": "林舟", "max_matches": 2},
               lambda: fs_tools.fs_search(str(project.root), "林舟", max_matches=2))
        many = Project(run, "many", {
            **{f"资料/卡片{index:03d}.md": f"资料卡片 {index}\n" for index in range(205)},
            **{f"草稿/片段{index:03d}.md": "片段\n" for index in range(300)},
        })
        project = many
        call("fs.list", {})
        call("project.knowledge", {"action": "list"})
        return {
            "format_version": 1,
            "suite": "p3-tool-handlers",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": SYNTHETIC_ROOT,
            "secret": SECRET,
            "fixed_now": "2026-10-12T08:30:00Z",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [book.record("book"), many.record("many")],
        }
