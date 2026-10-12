"""Real writing-context oracle: LLM context snapshot (selection, channel accounting, synthetic
delivery, prompt bundle projection), writing request admission and the previous chapter tail,
executed on synthetic inputs and trees (no author data)."""

from __future__ import annotations

import hashlib
import json
import os
from types import SimpleNamespace

from golden_fs import Project, isolated_fs_oracle, stable

SYNTHETIC_ROOT = r"D:\synthetic-book"
SOURCES = [
    "app/common/manuscript.py",
    "app/domains/agent_runs/_text.py",
    "app/domains/agent_runs/context_channel_requests.py",
    "app/domains/agent_runs/context_provenance.py",
    "app/domains/agent_runs/llm_context.py",
    "app/domains/agent_runs/llm_context_limits.py",
    "app/domains/agent_runs/llm_prompt_context.py",
    "app/domains/agent_runs/loop/context_values.py",
    "app/domains/assistant/writing_context.py",
]
SECRET_TEXT = "配置 api_key=sk-abcdefghijklmnopqrstuvwxyz0123 结束"
LONG = "雨夜里他推开门，" * 300
HARNESS = json.dumps({"proposed_patch": {"x": 1}}, ensure_ascii=False)


def _file(path, excerpt, **extra):
    return {"relative_path": path, "excerpt": excerpt, **extra}


BUNDLE_FILES = [
    "not-an-object",
    _file("debug/a.md", "调试", kind="debug"),
    _file("人物/载荷.md", HARNESS, kind="character"),
    _file("正文/第002章.md", "选中文件本身", kind="chapter"),
    {"path": "D:/book/正文/第002章.md", "excerpt": "经 path 命中选中文件"},
    _file("../越界.md", "越界"),
    _file("/abs.md", "绝对"),
    _file("C:/盘符.md", "盘符"),
    _file("😀:x.md", "首字是增补平面"),
    _file("人物/林舟.md", "林舟会游泳。", kind="character", title="林舟"),
    {"relativePath": "设定\\世界观.md", "excerpt": "  灵力  会\n\n反噬。 ", "kind": "setting", "name": "世界观"},
    _file("设定/长.md", LONG, kind="setting"),
    _file("设定/密钥.md", SECRET_TEXT, kind="setting"),
    _file("设定/空.md", "   "),
    {"relative_path": "设定/无摘录.md", "kind": " "},
    _file("./设定//点.md", "点路径"),
    _file("第002章.md", "裸文件名命中选中文件"),
    _file("设定/增补.md", "𠀀字" * 3),
]
MANY_FILES = [_file(f"资料/{i:02d}.md", f"资料{i}") for i in range(11)]
MEMORY_ITEMS = [
    {"id": "m1", "kind": "fact", "entity": "林舟", "fact": "林舟会游泳。", "source_chapter_id": 3,
     "valid_from_chapter": True, "valid_to_chapter": 2.5},
    {"memoryId": " m2 ", "category": "rule", "name": "钟楼", "content": "钟楼只在子时响。"},
    {"type": "world", "subject": "灵力", "text": "长" * 801},
    {"summary": "  只有 摘要  ", "valid_to_chapter": 7},
    {"kind": "empty"},
    "not-an-object",
    {},
    {"fact": SECRET_TEXT},
    {"fact": "第九条"},
    {"fact": "第十条"},
]
CHAPTER = {
    "chapter_id": 12, "chapter": "第十二章", "ordinal": 1.5, "title": "  雨夜\n\n来客  ", "summary": "长" * 1300,
    "beats": ["开场", "  它说'走' ", 3, True, None, {"x": 1}, ["嵌", "套"], *[f"拍{i}" for i in range(12)]],
    "pov": None, "goal": {"x": 1}, "setting": "", "outline": SECRET_TEXT, "extra_key": "不在白名单",
    "next_summary": ["\x01控制", "引\"号'"],
}
REVIEW = {
    "kind": " review_report ", "file_path": " 正文/第002章.md ", "mode": "deep", "content_sha256": "abc", "report_id": "r1",
    "issues": [
        {"id": "plot-1", "category": "plot", "severity": "high", "agent": "plot-agent", "code": "hook",
         "message": "冲突  不足", "evidence": "原文" * 400, "suggested_action": "补阻力"},
        "not-an-object",
        {"id": "x", "message": 5, "evidence": ["列表证据"]},
        {"message": SECRET_TEXT},
        *({"id": f"i{i}", "message": f"问题{i}"} for i in range(12)),
    ],
    "suggested_actions": ["先核查剧情", "  ", 3, "长" * 700, *(f"建议{i}" for i in range(12))],
}
BIG_REVIEW = {
    "issues": [{"id": f"big-{i}", "message": "问题" * 100, "evidence": "证据" * 290} for i in range(10)],
    "suggested_actions": ["动作" * 200 for _ in range(5)],
}
LOOP_READS = [
    {"relative_path": "设定/循环.md", "excerpt": "循环读到的设定。"},
    {"relative_path": "人物/林舟.md", "excerpt": "重复路径会被跳过。"},
    {"relative_path": "../外面.md", "excerpt": "不安全路径"},
    {"relative_path": "", "excerpt": "空路径"},
    {"relative_path": "设定/空摘录.md", "excerpt": "  "},
    {"relative_path": "设定/非串摘录.md", "excerpt": 5},
    {"relative_path": "正文/第002章.md", "excerpt": "选中文件"},
    {"relative_path": "设定/载荷.md", "excerpt": HARNESS},
    "not-an-object",
    {"relative_path": "设定\\反斜杠.md", "excerpt": "反斜杠路径"},
]
BASE = {"intent": "file.revise", "user_message": "改得紧凑些", "file_path": "正文/第002章.md", "content": "他回头。\n"}
SNAPSHOT_CASES = [
    ("none", {}),
    ("bundle-not-object", {"context_bundle": "x"}),
    ("empty-bundle", {"context_bundle": {}}),
    ("files-not-list", {"context_bundle": {"files": "x", "budget": {"truncated": True}}}),
    ("files", {"context_bundle": {"project_root": SYNTHETIC_ROOT, "current_file": "D:/book/正文/第002章.md",
                                   "files": BUNDLE_FILES, "budget": {"truncated": "yes"}}}),
    ("many-files", {"context_bundle": {"files": MANY_FILES, "budget": {"truncated": False}}}),
    ("budget-truncated", {"context_bundle": {"files": [], "budget": {"truncated": True}}}),
    ("memory-list", {"context_bundle": {"story_memory": MEMORY_ITEMS}}),
    ("memory-mapping", {"context_bundle": {"storyMemory": {"atoms": MEMORY_ITEMS[:3], "items": "x"}}}),
    ("memory-none", {"context_bundle": {"memory": None, "memories": MEMORY_ITEMS}}),
    ("memory-mapping-empty", {"context_bundle": {"memories": {"x": 1}}}),
    ("memory-overflow", {"context_bundle": {"story_memory": [{"fact": "长" * 790, "entity": f"人{i}"} for i in range(8)]}}),
    ("chapter", {"context_bundle": {"chapter_context": CHAPTER}}),
    ("chapter-alt-key", {"context_bundle": {"chapterContext": "x", "scene_packet": {"goal": "夺钥匙", "beat": 2}}}),
    ("chapter-empty", {"context_bundle": {"chapter": {"other": 1}}}),
    ("chapter-13", {"context_bundle": {"chapter_context": {"beats": [str(i) for i in range(13)]}}}),
    ("chapter-overflow", {"context_bundle": {"chapter_context": {key: "长" * 1199 for key in ("summary", "previous_summary", "next_summary", "goal")}}}),
    ("review-arg", {"review_report": REVIEW}),
    ("review-artifacts", {"artifacts": [{"kind": "other", "payload": {}}, {"kind": " review_report ", "payload": None},
                                        {"kind": "review_report", "payload": {"issues": [{"id": "a-1", "message": "来自产物"}]}},
                                        "x", {"kind": "export"}],
                          "event_history": [{"x": 1}, 2, "three"]}),
    ("review-big", {"review_report": BIG_REVIEW}),
    ("review-empty", {"review_report": {}}),
    ("loop-reads", {"context_bundle": {"files": [_file("人物/林舟.md", "林舟会游泳。")]}, "extra_context_files": LOOP_READS}),
    ("loop-reads-no-bundle", {"extra_context_files": LOOP_READS}),
    ("loop-reads-overflow", {"context_bundle": {"files": MANY_FILES[:8]}, "extra_context_files": LOOP_READS}),
    ("roles-run", {"role_hints": [" plot ", "plot", "", 5, "character"], "role_mentions": ["@prose"],
                   "run_state": {"public_id": "", "run_id": " run-1 ", "goal": "  写 完 第三章  ", "status": " running ",
                                 "current_step": 3}}),
    ("run-public-id", {"run_state": {"public_id": "pub-1", "run_id": "run-2", "goal": None, "status": "", "current_step": " s "}}),
    ("summary", {"context_bundle": {"projectRoot": " " + SYNTHETIC_ROOT + " ", "currentFile": "正文/第002章.md",
                                    "summary": {"hasStoryStructure": True, "counts": {"chapters": 3, "words": 1.5, "flag": True,
                                                                                       "name": "x", "nested": {"a": 1}}}}}),
    ("summary-bad", {"context_bundle": {"summary": {"hasStoryStructure": "yes", "counts": [1]}}}),
    ("unsafe-keys", {"context_bundle": {"debug": 1, "events": [], "proposed_patch": {}, "timeline": "x", "files": []}}),
    ("defaults", {"intent": "  ", "user_message": "  多   空白\n消息  ", "file_path": " ", "content": "😀" * 3}),
    ("secret-bundle", {"context_bundle": {"files": [_file("设定/a.md", "token: abc"), _file("设定/b.md", SECRET_TEXT)],
                                          "story_memory": [{"fact": "password=hunter2hunter2"}], "api_key": "sk-shouldbehidden1234567890",
                                          "chapter_context": {"summary": "Bearer abcdefghijklmnop1234"}}}),
    ("everything", {"context_bundle": {"project_root": "storyforge://llm-context", "current_file": "正文/第002章.md",
                                       "files": BUNDLE_FILES[9:12], "story_memory": MEMORY_ITEMS[:4],
                                       "chapter_context": CHAPTER, "budget": {"truncated": False}},
                    "review_report": REVIEW, "extra_context_files": LOOP_READS[:2], "event_history": [1, 2]}),
]


def _legacy_snapshots():
    base = {"selected_file": {"file_path": "正文/a.md"}, "project": {"current_file": "正文/b.md", "counts": {"x": 1},
                                                                       "has_story_structure": False}}
    knowledge_file = {"relative_path": "设定/世界观.md", "kind": "knowledge", "excerpt": "灵力会反噬。", "knowledge_id": "pk_1",
                      "selection_source": "auto_retrieved", "evidence_state": "stale", "warning_count": 2, "truncated": True}
    return [
        ("legacy-memory", {**base, "story_memory": {"items": [{"text": "旧记忆一"}, {"entity": "林舟", "text": "旧记忆二"},
                                                               {"text_truncated": True}, {"text_truncated": True, "text": "带标记的旧记忆"}, "x"]}}),
        ("legacy-chapter", {**base, "chapter_context": {"goal": "目标", "beats": ["一", 2, 3.5, False], "skip": {"a": 1}, "n": None}}),
        ("legacy-review", {**base, "review_report": {"issues": [{"message": "旧问题"}], "suggested_actions": ["旧动作"]}}),
        ("legacy-review-counts", {**base, "review_report": {"issues": [], "issue_count": 0, "suggested_actions": []},
                                  "channel_requests": {"review_report": {"requested_count": 4, "requested_action_count": 2,
                                                                         "supplied_value_sha256": "s", "selection_truncated": False}}}),
        ("channel-only", {**base, "channel_requests": {"story_memory": {"requested_count": 3, "supplied_value_sha256": "m",
                                                                        "selection_truncated": True,
                                                                        "selection_omission_reasons": ["item_budget"]},
                                                       "chapter_context": {}, "review_report": None}}),
        ("knowledge-no-manifest", {**base, "context_files": [knowledge_file, {"relative_path": "x.md", "excerpt": ""}, 5],
                                   "context_budget": {"truncated": False}}),
        ("selected-not-dict", {"selected_file": None, "project": "y", "context_files": "z", "source_manifest": "w"}),
        ("too-many-files", {**base, "context_files": [{"relative_path": f"f{i}.md", "excerpt": "x"} for i in range(13)]}),
        ("manifest-too-long", {**base, "source_manifest": [{"relative_path": f"资料/{i}.md", "excerpt_sha256": "e" * 64}
                                                           for i in range(60)]}),
        ("long-excerpt", {**base, "context_files": [{"relative_path": "a.md", "excerpt": "长" * 4100, "kind": "setting",
                                                     "title": "  "}]}),
    ]


def p2_writing_context_snapshot() -> dict:
    with isolated_fs_oracle("writing-context-oracle-") as (api, run):
        from pydantic import ValidationError

        from app.common.exceptions import ConflictError
        from app.common.generation_sources import GenerationSourceCapture, text_sha256
        from app.common.manuscript import previous_chapter_tail
        from app.domains.agent_runs import context_provenance, llm_context, llm_prompt_context
        from app.domains.agent_runs.fs import knowledge_entries as ke
        from app.domains.agent_runs.knowledge_context import CollectedProjectKnowledge
        from app.domains.assistant import writing_context as wc
        from app.domains.assistant.schemas import (
            AssistantContinueRequest,
            AssistantDraftRequest,
            AssistantReviseRequest,
        )

        errors = (ValueError, ConflictError, ValidationError)
        pure = []

        def record(fn, args, run_fn):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error).splitlines()[0]}
            pure.append(row)

        def projections(snapshot):
            out = {"trace": context_provenance.llm_context_snapshot_trace_summary(snapshot),
                   "selected_values": list(llm_prompt_context.synthetic_context_selected_values(snapshot)),
                   "synthetic": list(llm_prompt_context.synthetic_context_delivery(snapshot))}
            try:
                out["prompt_bundle"] = llm_prompt_context.llm_context_snapshot_to_prompt_context_bundle(snapshot)
            except ValueError as error:
                out["prompt_bundle_error"] = str(error)
            return out

        def collected_case(case):
            args = {**BASE, **case}
            snapshot = llm_context.build_llm_context_snapshot_from_collected(
                knowledge=CollectedProjectKnowledge(),
                run_state=args.get("run_state"),
                intent=args["intent"],
                user_message=args["user_message"],
                file_path=args["file_path"],
                content=args["content"],
                context_bundle=args.get("context_bundle"),
                role_hints=args.get("role_hints"),
                role_mentions=args.get("role_mentions"),
                review_report=args.get("review_report"),
                artifacts=args.get("artifacts"),
                event_history=args.get("event_history"),
                extra_context_files=args.get("extra_context_files"),
            )
            return {"snapshot": snapshot, **projections(snapshot)}

        for name, case in SNAPSHOT_CASES:
            record("collected_snapshot", {"name": name, **BASE, **case}, lambda case=case: collected_case(case))
        for name, snapshot in _legacy_snapshots():
            record("projections", {"name": name, "snapshot": snapshot}, lambda snapshot=snapshot: projections(snapshot))

        identity_args = {"project_root": SYNTHETIC_ROOT, "file_path": "正文/第002章.md", "content": "他回头。", "intent": "file.revise"}
        files_dump = [{"path": "人物/林舟.md", "relative_path": "人物/林舟.md", "kind": "character", "title": "林舟",
                       "excerpt": "林舟会游泳。"}]
        guarded = {"project_root": ".", "current_file": "正文/第002章.md", "files": files_dump, "summary": {"a": 1}}

        def prepared_dict(prepared):
            return {"bundle": prepared.context_bundle.model_dump(), "receipt": prepared.context_receipt_json}

        receipt_ok = {"prompt_files_sha256": hashlib.sha256(json.dumps(files_dump, ensure_ascii=False, sort_keys=True,
                                                                       separators=(",", ":")).encode()).hexdigest(), "v": 1}
        for name, raw, extra in [
            ("dot-root", guarded, {}),
            ("same-root", {**guarded, "project_root": SYNTHETIC_ROOT + "\\正文\\.."}, {}),
            ("other-root", {**guarded, "project_root": r"D:\other-book"}, {}),
            ("receipt-ok", guarded, {"context_receipt": receipt_ok}),
            ("receipt-stale", guarded, {"context_receipt": {"prompt_files_sha256": "stale"}}),
            ("extra-key", {**guarded, "extra": 1}, {}),
            ("long-title", {**guarded, "files": [{**files_dump[0], "title": "长" * 256}]}, {}),
            ("budget-null", {**guarded, "budget": None, "summary": {}}, {}),
        ]:
            record("guarded_bundle", {"name": name, "raw": raw, **extra},
                   lambda raw=raw, extra=extra: prepared_dict(wc.writing_context_from_guarded_bundle(
                       json.loads(json.dumps(raw)), **{k: v for k, v in identity_args.items()}, **extra)))

        def from_snapshot(snapshot, **target):
            return prepared_dict(wc.writing_context_from_snapshot(snapshot, **{**identity_args, **target}))

        good = llm_context.build_llm_context_snapshot_from_collected(
            knowledge=CollectedProjectKnowledge(), run_state=None, intent="file.revise", user_message="改",
            file_path="正文/第002章.md", content="他回头。",
            context_bundle={"project_root": SYNTHETIC_ROOT, "current_file": "正文/第002章.md", "files": BUNDLE_FILES[9:11]})
        for name, snapshot, target in [
            ("match", good, {}),
            ("intent-mismatch", good, {"intent": "prose.continue"}),
            ("content-mismatch", good, {"content": "改过的正文"}),
            ("file-mismatch", good, {"file_path": "正文/第003章.md"}),
            ("synthetic-root", {**good, "project": {"project_root": "storyforge://llm-context"}}, {"project_root": None}),
            ("root-mismatch", good, {"project_root": None}),
            ("too-many-files", {**good, "context_files": [{"relative_path": f"f{i}.md", "excerpt": "x"} for i in range(13)]}, {}),
            ("long-title", {**good, "context_files": [{"relative_path": "a.md", "title": "长" * 256, "excerpt": "x"}]}, {}),
        ]:
            record("from_snapshot", {"name": name, "snapshot": snapshot, **target},
                   lambda snapshot=snapshot, target=target: from_snapshot(snapshot, **target))

        # ---- file-backed: live snapshot, admission and previous chapter tail ----
        knowledge_entry = ke.KnowledgeEntry(
            id="pk_11111111-1111-4111-8111-111111111111", status="active", kind="world_rule", evidence_state="current",
            title="灵力", claim="灵力会反噬使用者。", sources=(ke.KnowledgeSource(type="author_statement", agent_event_id="ake_1"),),
            claim_fingerprint=ke.knowledge_claim_fingerprint("灵力", "灵力会反噬使用者。"),
            created_at="2026-10-01T00:00:00Z", updated_at="2026-10-02T00:00:00Z", superseded_by=None)
        long_chapter = "第一章开头。\n\n" + "雨夜里他推开门。" * 200 + "\n\n最后一段：钟声响了。\n"
        files = {
            "正文/卷二/第001章.md": "卷二开篇。\n",
            "正文/第001章.md": long_chapter,
            "正文/第002章.md": "第二章。\r\n\r\n他回头，  看见钟楼。\r\n",
            "正文/第003章.md": "\n\n  \n",
            "正文/第004章.md": b"\x00binary chapter",
            "正文/第006章.md": "\ufeff第六章：短。",
            "正文/第008章.md": "x" * (2 * 1024 * 1024 + 1),
            "正文/第010章.md": b"bad \xff\xfe utf8\r\rend",
            "正文/第012章.md": "长句没有空行。" * 200,
            "人物/林舟.md": "林舟会游泳。\n",
            "设定/世界观.md": "块外说明：灵力。\n\n" + ke.render_knowledge_entry(knowledge_entry),
            "设定/钟楼.md": "钟楼在城北。\n",
            ".storyforge/agent-instructions.md": "少用套话。",
            "灵感.md": "速记",
            "大纲/总纲.md": "总纲。",
        }
        p = Project(run, "book", files)
        root = str(p.root)

        def with_capture(run_fn, current_file=None):
            capture = GenerationSourceCapture(root, current_file=current_file)
            capture.project_identity_sha256 = text_sha256(os.path.normcase(SYNTHETIC_ROOT))
            with capture.collecting():
                value = run_fn()
            return {"value": value, "sources": capture.sources, "selections": capture.selections,
                    "projections": [{"row": row, "text": text} for row, text in capture.projections],
                    "context_delivery": capture.context_delivery}

        def rooted(value):
            return json.loads(json.dumps(value, ensure_ascii=False).replace("$ROOT", json.dumps(root)[1:-1]))

        for current in [None, "人物/林舟.md", "正文/卷二/第001章.md", "正文/第001章.md", "正文/第002章.md",
                        "正文/第003章.md", "正文/第004章.md", "正文/第005章.md", "正文/第007章.md", "正文/第009章.md",
                        "正文/第011章.md", "正文/第013章.md", "$ROOT\\正文\\第002章.md", "正文\\第003章.md", "../外面.md", "灵感.md",
                        "正文/第001章.txt"]:
            p.call("previous_chapter", {"current_file": current},
                   lambda current=current: with_capture(lambda: previous_chapter_tail(root, rooted(current))))
        p.call("previous_chapter", {"current_file": "正文/第002章.md", "project": None},
               lambda: with_capture(lambda: previous_chapter_tail(None, "正文/第002章.md")))

        def stable_snapshot(snapshot):
            body = stable({key: value for key, value in snapshot.items() if key != "snapshot_id"}, p.root)
            return {"snapshot": body, "stable_id": context_provenance.with_snapshot_id(body)["snapshot_id"]}

        def live(bundle, **kwargs):
            snapshot = llm_context.build_llm_context_snapshot(
                run_state=SimpleNamespace(public_id="run-9", goal="写完", status="running", current_step="draft"),
                intent=kwargs.get("intent", "chat.explain"), user_message=kwargs.get("user_message", "灵力 钟楼"),
                file_path="正文/第002章.md", content="他回头。", context_bundle=bundle,
                extra_context_files=kwargs.get("extra_context_files"))
            view = {**stable_snapshot(snapshot), **projections(snapshot)}
            # The real-root id differs per temporary directory; the trace carries the stable id instead.
            view["trace"]["snapshot_id"] = view["stable_id"]
            return view

        live_files = [_file("人物/林舟.md", "旧摘录", kind="character"), _file("设定/钟楼.md", "旧", kind="setting"),
                      _file("设定/缺失.md", "不存在", kind="setting"), _file("设定/世界观.md", "旧", kind="knowledge")]
        for name, bundle, kwargs in [
            ("live-root", {"project_root": root, "current_file": "正文/第002章.md", "files": live_files}, {}),
            ("live-loop-reads", {"project_root": root, "files": live_files[:1]}, {"extra_context_files": LOOP_READS[:3]}),
            ("live-synthetic", {"project_root": "storyforge://llm-context", "files": live_files[:2]}, {}),
            ("live-missing-root", {"project_root": root + "\\missing", "files": live_files[:2]}, {}),
            ("live-no-bundle", None, {}),
        ]:
            p.call("live_snapshot", {"name": name, "bundle": stable(bundle, p.root), **kwargs},
                   lambda bundle=bundle, kwargs=kwargs: live(bundle, **kwargs))

        classes = {"revise": AssistantReviseRequest, "continue": AssistantContinueRequest, "draft": AssistantDraftRequest}

        def admit(kind, data, intent, prepared=None):
            payload = classes[kind](**rooted(data))
            result = wc.admit_writing_request(payload, intent=intent, prepared_context=prepared)
            return result.context_bundle.model_dump() if result.context_bundle is not None else None

        bundle_files = [{"path": "$ROOT\\人物\\林舟.md", "relative_path": "人物/林舟.md", "kind": "character",
                         "title": "林舟", "excerpt": "旧摘录"},
                        {"path": "设定/密钥.md", "relative_path": "设定/密钥.md", "kind": "setting", "title": "密钥",
                         "excerpt": SECRET_TEXT},
                        {"path": "正文/第002章.md", "relative_path": "正文/第002章.md", "kind": "chapter", "title": "本章",
                         "excerpt": "选中文件"}]
        request_bundle = {"project_root": "D:\\elsewhere", "current_file": "x.md", "files": bundle_files,
                          "summary": {"hasStoryStructure": True}, "budget": {"truncated": False}}
        admit_cases = [
            ("revise-root", "revise", {"file_path": "正文/第002章.md", "content": "他回头。", "instruction": "改紧凑 钟楼",
                                       "project_root": "$ROOT"}, "file.revise"),
            ("revise-bare", "revise", {"file_path": "正文/第002章.md", "content": "他回头。", "instruction": "改"}, "file.revise"),
            ("revise-bundle-no-root", "revise", {"file_path": "正文/第002章.md", "content": "他回头。", "instruction": "改",
                                                 "context_bundle": request_bundle}, "file.revise"),
            ("continue-bundle", "continue", {"file_path": "正文/第002章.md", "content": "他回头。\n", "cursor_line": 1,
                                             "project_root": "$ROOT", "context_bundle": request_bundle}, "prose.continue"),
            ("continue-no-instruction", "continue", {"file_path": "正文/第002章.md", "content": "", "project_root": "$ROOT"},
             "prose.continue"),
            ("draft-root", "draft", {"file_path": "正文/第012章.md", "instruction": "写第十二章：灵力 钟楼",
                                     "project_root": "$ROOT"}, "file.create"),
            ("revise-empty-root", "revise", {"file_path": "正文/第002章.md", "content": "他回头。", "instruction": "改",
                                             "project_root": "", "context_bundle": request_bundle}, "file.revise"),
        ]
        for name, kind, data, intent in admit_cases:
            p.call("admit", {"name": name, "kind": kind, "data": data, "intent": intent},
                   lambda kind=kind, data=data, intent=intent: with_capture(lambda: admit(kind, data, intent)),
                   errors=errors)

        prepared = wc.writing_context_from_snapshot(
            llm_context.build_llm_context_snapshot(
                run_state=None, intent="file.revise", user_message="改", file_path="正文/第002章.md", content="他回头。",
                context_bundle={"project_root": root, "current_file": "正文/第002章.md", "files": live_files[:2]}),
            project_root=root, file_path="正文/第002章.md", content="他回头。", intent="file.revise")
        for name, data, intent in [
            ("prepared-match", {"file_path": "正文/第002章.md", "content": "他回头。", "instruction": "改", "project_root": "$ROOT"},
             "file.revise"),
            ("prepared-other-file", {"file_path": "正文/第003章.md", "content": "他回头。", "instruction": "改",
                                     "project_root": "$ROOT"}, "file.revise"),
            ("prepared-other-intent", {"file_path": "正文/第002章.md", "content": "他回头。", "instruction": "改",
                                       "project_root": "$ROOT"}, "prose.continue"),
        ]:
            p.call("admit_prepared", {"name": name, "data": data, "intent": intent},
                   lambda data=data, intent=intent: with_capture(lambda: admit("revise", data, intent, prepared)),
                   errors=errors)

        return {
            "format_version": 1,
            "suite": "p2-writing-context",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": SYNTHETIC_ROOT,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "pure": pure,
            "projects": [p.record("book")],
            "prepared_files": live_files[:2],
        }
