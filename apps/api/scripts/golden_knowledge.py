"""Real Project Knowledge oracle: knowledge blocks, entry index, retrieval, proposals, ordinary
context collection and materialization compile, executed on synthetic trees (no author data)."""

from __future__ import annotations

import datetime as real_datetime
import hashlib
import json
import os
from dataclasses import asdict
from pathlib import PurePosixPath, PureWindowsPath
from uuid import UUID

from golden_fs import Project, isolated_fs_oracle

SOURCES = [
    "app/domains/agent_runs/events/knowledge_materialization.py",
    "app/domains/agent_runs/fs/knowledge_entries.py",
    "app/domains/agent_runs/fs/knowledge_proposals.py",
    "app/domains/agent_runs/fs/knowledge_retrieval.py",
    "app/domains/agent_runs/fs/ordinary_context.py",
    "app/domains/agent_runs/fs/project_knowledge.py",
    "app/domains/agent_runs/knowledge_context.py",
]
FIXED_NOW = (2026, 10, 12, 4, 30, 15, 987654)
ID1 = "pk_11111111-1111-4111-8111-111111111111"
ID2 = "pk_22222222-2222-4222-8222-222222222222"
ID3 = "pk_33333333-3333-4333-8333-333333333333"
ID4 = "pk_44444444-4444-4444-8444-444444444444"


def _as_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def p1_knowledge_snapshot() -> dict:
    with isolated_fs_oracle("knowledge-oracle-") as (api, run):
        from app.domains.agent_runs import knowledge_context
        from app.domains.agent_runs.events import knowledge_materialization as materialization
        from app.domains.agent_runs.fs import knowledge_entries as ke
        from app.domains.agent_runs.fs import knowledge_proposals as proposals_module
        from app.domains.agent_runs.fs import knowledge_retrieval as retrieval
        from app.domains.agent_runs.fs import ordinary_context
        from app.domains.agent_runs.fs import project_knowledge as pk
        from app.domains.agent_runs.fs_tools import FsToolError

        def entry(id_, title, claim, *, status="active", kind="world_rule", evidence="current",
                  sources=None, created="2026-10-01T00:00:00Z", updated="2026-10-02T00:00:00Z", superseded_by=None):
            return ke.KnowledgeEntry(
                id=id_, status=status, kind=kind, evidence_state=evidence, title=title, claim=claim,
                sources=tuple(sources or (ke.KnowledgeSource(type="author_statement", agent_event_id="ake_1"),)),
                claim_fingerprint=ke.knowledge_claim_fingerprint(title, claim), created_at=created,
                updated_at=updated, superseded_by=superseded_by)

        pure = []

        def record(fn, args, run_fn, errors=(ke.KnowledgeEntryError, ValueError, FsToolError)):
            row = {"fn": fn, "args_json": _as_json(args)}
            try:
                row["output_json"] = _as_json(run_fn())
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            pure.append(row)

        def parsed_dict(text):
            result = ke.parse_knowledge_markdown(text)
            return {"entries": [asdict(item) for item in result.entries], "warnings": list(result.warnings)}

        good = ke.render_knowledge_entry(entry(ID1, "灵力规则", "灵力  不能\n跨界使用。"))
        second = ke.render_knowledge_entry(entry(ID2, "钟楼", "钟楼只在子时响。", kind="timeline_fact",
                                                 sources=(ke.KnowledgeSource(type="project_file", path="设定/钟楼.md",
                                                                             content_sha256="sha256:" + "a" * 64),
                                                          ke.KnowledgeSource(type="external_reference", locator="https://x",
                                                                             title="资料", accessed_at="2026-10-01T00:00:00Z",
                                                                             summary_sha256="sha256:" + "b" * 64))))
        meta = json.loads(good.split("\n")[1])

        def block(metadata, body="## 标题\n\n断言。"):
            text = metadata if isinstance(metadata, str) else json.dumps(metadata, ensure_ascii=False)
            return f"<!-- storyforge-knowledge:v1\n{text}\n-->\n{body}\n<!-- /storyforge-knowledge -->\n"

        def variant(**changes):
            data = {**meta, **changes}
            for key, value in changes.items():
                if value is None:
                    data.pop(key)
            return data

        title_fp = ke.knowledge_claim_fingerprint("标题", "断言。")
        base = {**meta, "claim_fingerprint": title_fp}
        markdown_cases = {
            "empty": "", "plain": "普通说明。\n", "good": good, "two": "前言\n\n" + good + "\n中段\n" + second + "尾声",
            "bad-json": block("{not json}"), "nan-json": block('{"id": NaN}'), "array-meta": block("[1]"),
            "unclosed-meta": "<!-- storyforge-knowledge:v1\n{}\n", "unclosed-block": block(base).replace("<!-- /storyforge-knowledge -->", ""),
            "nested-start": "<!-- storyforge-knowledge:v1\n{}\n<!-- storyforge-knowledge:v1\n" + good,
            "nested-body": block(base, "## 标题\n\n断言。\n" + good.rstrip("\n")),
            "duplicate": good + good,
            "no-heading": block(base, "断言。"), "heading-only": block(base, "## 标题"),
            "blank-title": block({**base, "claim_fingerprint": ke.knowledge_claim_fingerprint("", "断言。")}, "##  \n\n断言。"),
            "bad-id": block({**base, "id": "pk_123"}), "upper-uuid": block({**base, "id": ID1.upper().replace("PK_", "pk_")}),
            "no-prefix": block({**base, "id": "11111111-1111-4111-8111-111111111111"}),
            "status": block({**base, "status": "draft"}), "kind": block({**base, "kind": "rumor"}),
            "evidence": block({**base, "evidence_state": "fresh"}),
            "no-z": block({**base, "created_at": "2026-10-01T00:00:00+00:00"}),
            "no-t": block({**base, "created_at": "2026-10-01 00:00:00Z"}),
            "bad-day": block({**base, "created_at": "2026-02-30T00:00:00Z"}),
            "fraction": block({**base, "created_at": "2026-10-01T00:00:00.5Z", "updated_at": "2026-10-01T00:00:00.25Z"}),
            "earlier": block({**base, "updated_at": "2026-09-01T00:00:00Z"}),
            "fingerprint": block({**base, "claim_fingerprint": "sha256:" + "0" * 64}),
            "no-sources": block({**base, "sources": []}), "sources-object": block({**base, "sources": {}}),
            "source-non-object": block({**base, "sources": ["x"]}),
            "pf-missing-hash": block({**base, "sources": [{"type": "project_file", "path": "设定/a.md"}]}),
            "pf-dotdot": block({**base, "sources": [{"type": "project_file", "path": "设定/../a.md", "content_sha256": "sha256:" + "a" * 64}]}),
            "pf-dot": block({**base, "sources": [{"type": "project_file", "path": "./设定/a.md", "content_sha256": "sha256:" + "a" * 64}]}),
            "pf-backslash": block({**base, "sources": [{"type": "project_file", "path": "设定\\a.md", "content_sha256": "sha256:" + "a" * 64}]}),
            "pf-space": block({**base, "sources": [{"type": "project_file", "path": " 设定/a.md", "content_sha256": "sha256:" + "a" * 64}]}),
            "pf-abs": block({**base, "sources": [{"type": "project_file", "path": "/a.md", "content_sha256": "sha256:" + "a" * 64}]}),
            "pf-drive": block({**base, "sources": [{"type": "project_file", "path": "C:/a.md", "content_sha256": "sha256:" + "a" * 64}]}),
            "pf-bad-hash": block({**base, "sources": [{"type": "project_file", "path": "a.md", "content_sha256": "sha256:" + "A" * 64}]}),
            "pf-extra": block({**base, "sources": [{"type": "project_file", "path": "a.md", "content_sha256": "sha256:" + "a" * 64, "title": "x"}]}),
            "author-missing": block({**base, "sources": [{"type": "author_statement"}]}),
            "author-blank": block({**base, "sources": [{"type": "author_statement", "agent_event_id": " "}]}),
            "external-missing": block({**base, "sources": [{"type": "external_reference", "locator": "x"}]}),
            "unknown-source": block({**base, "sources": [{"type": "rumor"}]}),
            "superseded-missing": block({**base, "status": "superseded"}),
            "superseded-self": block({**base, "status": "superseded", "superseded_by": base["id"]}),
            "superseded-ok": block({**base, "status": "superseded", "superseded_by": ID2}),
            "superseded-active": block({**base, "superseded_by": ID2}),
            "missing-id": block({key: value for key, value in base.items() if key != "id"}),
            "numeric-status": block({**base, "status": 3}),
            "crlf-body": block(base, "## 标题\r\n\r\n断言。"),
        }
        for name, text in markdown_cases.items():
            record("parse_knowledge_markdown", {"id": name, "content": text}, lambda text=text: parsed_dict(text))
            record("plain_notes", {"id": name, "content": text},
                   lambda text=text: [ke.has_knowledge_block_marker(text), ke.plain_notes_outside_knowledge_blocks(text)])
        for title, claim in [("标题", "断言"), (" ＡＢＣ　", "ｆｉ  \u3000多 \n 空白"), ("Ⅻ", "①")]:
            record("knowledge_claim_fingerprint", {"title": title, "claim": claim},
                   lambda title=title, claim=claim: ke.knowledge_claim_fingerprint(title, claim))
        proposed = entry(ID3, "新规则", "新的断言。")
        for name, content in [("empty", ""), ("no-newline", "说明"), ("newline", "说明\n"), ("existing", good + "尾\n"),
                              ("existing-two", good + second), ("malformed", block("{bad}"))]:
            record("upsert", {"id": name, "content": content}, lambda content=content: ke.upsert_knowledge_entry(content, proposed))
        replaced = entry(ID1, "灵力规则（修订）", "改写后的断言。", updated="2026-10-03T00:00:00Z")
        record("upsert", {"id": "replace", "content": "前\n" + good + "后\n" + second},
               lambda: ke.upsert_knowledge_entry("前\n" + good + "后\n" + second, replaced))

        def entry_json(item):
            return asdict(item)

        for op, related, before in [
            ("create", [], ""), ("create", [], good), ("migrate", [], "说明"), ("extend", [ID2], good + second),
            ("retire", [ID1, ID2], good + second), ("dispute", [ID1], good), ("supersede", [ID1, ID2], good + second),
            ("extend", [ID3], good), ("retire", [], good), ("create", [], block("{bad}")), ("retire", [ID1], block("{bad}")),
            ("rename", [ID1], good),
        ]:
            source_proposed = entry(ID3, "新规则", "新的断言。", sources=(
                ke.KnowledgeSource(type="project_file", path="设定/钟楼.md", content_sha256="sha256:" + "c" * 64),
                ke.KnowledgeSource(type="author_statement", agent_event_id="ake_9")))

            def compile_op(op=op, related=related, before=before, source_proposed=source_proposed):
                after, result = materialization._compile_operation(
                    before, source_proposed, operation=op, related_knowledge_ids=related,
                    updated_at="2026-10-05T00:00:00Z")
                return {"after": after, "entry": entry_json(result)}

            record("compile_operation", {"operation": op, "related": related, "before": before}, compile_op)
        for payload in [{"type": "project_file", "path": "a.md", "content_sha256": "sha256:x"}, {"type": "author_statement", "agent_event_id": "z"},
                        {"type": "external_reference", "locator": "l", "title": "t", "accessed_at": "a", "summary_sha256": "s"},
                        {"type": "external_reference"}, {"type": "project_file"}, {"type": "x"}]:
            record("materialized_source", payload,
                   lambda payload=payload: asdict(materialization._materialized_source(payload, confirmation_event_id="ake_confirm")))

        roots = [r"D:\synthetic-book", r"D:\Synthetic-Book\ＡＢ", r"C:\Users\作者\书 名", r"D:\Straße\ΣΑΣ"] if os.name == "nt" else ["/tmp/synthetic-book", "/Tmp/Book"]
        original_resolver = proposals_module.resolve_project_root
        proposals_module.resolve_project_root = PureWindowsPath if os.name == "nt" else PurePosixPath
        try:
            for root in roots:
                record("project_fingerprint", {"root": root}, lambda root=root: proposals_module.project_fingerprint(root))
        finally:
            proposals_module.resolve_project_root = original_resolver

        # Deterministic UUIDs and clock for proposal groups; the real formatting code still runs.
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

        index_entries = [
            ke.render_knowledge_entry(entry(ID1, "灵力规则", "灵力不能跨界使用，违者反噬。")),
            ke.render_knowledge_entry(entry(ID2, "钟楼", "钟楼只在子时响，钟声召回亡魂。", kind="timeline_fact",
                                            sources=(ke.KnowledgeSource(type="project_file", path="设定/钟楼.md",
                                                                        content_sha256="sha256:" + hashlib.sha256("钟楼在城北。\n".encode()).hexdigest()),))),
            ke.render_knowledge_entry(entry(ID3, "旧设定", "已经废弃的设定。", status="retired")),
            ke.render_knowledge_entry(entry(ID4, "Straße 的规矩", "STRASSE 上不许点灯。")),
        ]
        files = {
            "设定/世界观.md": "块外的作者说明：世界观草稿。\n\n" + index_entries[0] + "\n" + index_entries[2],
            "设定/钟楼.md": "钟楼在城北。\n",
            "设定/杂记.md": "杂记里的块外说明。\n" + index_entries[3],
            "人物/主角.md": index_entries[1] + "\n主角补充说明 api_key=abcdef123456\n",
            "资料/raw.md": "普通资料：林舟会游泳。\nsk-abcdefghijklmnopqrstuvwxyz\n灵力会反噬。\n",
            "knowledge/broken.md": block("{broken}"),
            "大纲/secrets.md": "不该被读",
            "大纲/notes.txt": "大纲文本。灵力\n",
            ".资料/hidden.md": "隐藏资料",
            "设定/大文件.md": "x" * (512 * 1024 + 1),
            "设定/config/a.md": "配置",
            "正文/第001章.md": "林舟来到钟楼。\n",
            "正文/draft.md": "草稿开头。" + "草稿内容。" * 600 + "草稿结尾。",
            "正文/payload.json": json.dumps({"events": [1], "x": 2}),
            "正文/mixed.md": "说明\n" + index_entries[0],
            ".storyforge/agent-instructions.md": "少用套话。",
            "notes.yaml": "a: b",
            "笔记.bin": "x",
        }
        p = Project(run, "knowledge", files)

        def index_dict():
            index = pk.project_knowledge_entry_index(str(p.root))
            return {"entries": [{"relative_path": item.relative_path, "entry": asdict(item.entry)} for item in index.entries],
                    "warnings": list(index.warnings), "structured_paths": list(index.structured_paths),
                    "plain_notes": [list(pair) for pair in index.plain_notes]}

        p.call("entry_index", {}, index_dict)
        for path, kwargs in [("设定/世界观.md", {}), ("人物/主角.md", {"offset": 3, "limit": 10}), ("设定/钟楼.md", {"offset": -1}),
                             ("大纲/secrets.md", {}), ("设定/大文件.md", {}), ("正文/第001章.md", {}), ("设定/缺失.md", {}),
                             ("设定/a.exe", {}), ("../x.md", {})]:
            p.call("project_knowledge_read", {"path": path, **kwargs},
                   lambda path=path, kwargs=kwargs: pk.project_knowledge_read(str(p.root), path, **kwargs), errors=(FsToolError,))
        for query, kwargs in [("灵力", {}), ("api_key", {}), ("不存在", {}), ("说明", {"max_matches": 1}), ("  ", {}), ("x" * 2049, {})]:
            p.call("project_knowledge_search", {"query": query, **kwargs},
                   lambda query=query, kwargs=kwargs: pk.project_knowledge_search(str(p.root), query, **kwargs), errors=(FsToolError,))
        for path in ["资料/raw.md", "设定/世界观.md", "正文/第001章.md", "大纲/secrets.md", "设定/config/a.md", "notes.yaml",
                     "笔记.bin", ".storyforge/agent-instructions.md", "正文/缺失.md", "../x.md", "设定/大文件.md",
                     "设定/config/缺失.md"]:
            p.call("read_project_context_file", {"path": path},
                   lambda path=path: pk.read_project_context_file(str(p.root), path), errors=(FsToolError,))

        def retrieval_dict(**kwargs):
            return asdict(retrieval.retrieve_project_knowledge(str(p.root), **kwargs))

        for kwargs in [{"query": "灵力反噬"}, {"query": "钟楼 子时"}, {"query": "  "}, {"query": "灵力", "pinned_paths": ["人物\\主角.md"]},
                       {"query": "灵力", "excluded_ids": [ID1]}, {"query": "灵力 钟楼", "max_items": 1},
                       {"query": "灵力", "pinned_paths": ["人物/主角.md", "设定/世界观.md"], "max_chars": 12},
                       {"query": "灵力钟楼", "max_chars": 0}, {"query": "strasse"}]:
            p.call("retrieve", kwargs, lambda kwargs=kwargs: retrieval_dict(**kwargs))

        def group(payload):
            def execute():
                result = proposals_module.build_knowledge_proposal_group(str(p.root), payload)
                result["project_fingerprint"] = "$FINGERPRINT"
                return result
            return execute

        proposal = {"target_path": "设定/新规.md", "operation": "create", "title": " 新规 ", "claim": "新规断言。",
                    "kind": "world_rule", "confidence": "author_declared", "reason": " 作者说的 ",
                    "sources": [{"type": "author_statement"}, {"type": "project_file", "path": "设定\\钟楼.md"},
                                {"type": "external_reference", "locator": "https://x", "title": "资料", "summary": "摘要"},
                                {"type": "external_reference", "locator": "l", "title": "t", "summary_sha256": "sha256:" + "d" * 64}]}
        group_cases = [
            {"proposals": [proposal]},
            {"proposals": [{**proposal, "operation": "extend", "related_knowledge_ids": [ID1, ID1]},
                           {**proposal, "title": "另一条", "operation": "supersede", "related_knowledge_ids": [ID1, ID2]}]},
            {"proposals": []}, {"proposals": [proposal] * 6}, {"proposals": "x"},
            {"proposals": [proposal, {**proposal, "title": "新规", "claim": "新规断言。 "}]},
            {"proposals": [proposal, 3]},
            {"proposals": [{**proposal, "target_path": "正文/a.md"}]},
            {"proposals": [{**proposal, "target_path": "设定/a.txt"}]},
            {"proposals": [{**proposal, "operation": "rename"}]},
            {"proposals": [{**proposal, "kind": "rumor"}]},
            {"proposals": [{**proposal, "sources": []}]},
            {"proposals": [{**proposal, "sources": [{"type": "project_file", "path": "设定/缺失.md"}]}]},
            {"proposals": [{**proposal, "sources": [{"type": "external_reference", "locator": "l", "title": "t"}]}]},
            {"proposals": [{**proposal, "sources": [{"type": "rumor"}]}]},
            {"proposals": [{**proposal, "operation": "retire"}]},
            {"proposals": [{**proposal, "operation": "retire", "related_knowledge_ids": [ID1]}]},
            {"proposals": [{**proposal, "operation": "supersede"}]},
            {"proposals": [{**proposal, "related_knowledge_ids": ["pk_x"]}]},
            {"proposals": [{**proposal, "related_knowledge_ids": [ID1.upper().replace("PK_", "pk_")]}]},
            {"proposals": [{**proposal, "related_knowledge_ids": "pk_x"}]},
            {"proposals": [{**proposal, "title": "  "}]},
        ]
        for payload in group_cases:
            p.call("proposal_group", payload, group(payload), errors=(FsToolError,))

        def ordinary_dict(context_files, structured=()):
            collected = ordinary_context.collect_ordinary_context(str(p.root), context_files=context_files, structured_paths=structured)
            return {"files": [item.as_context_file() for item in collected.files], "omitted": [list(row) for row in collected.omitted],
                    "warnings": list(collected.warnings),
                    "manifest": ordinary_context.source_delivery_manifest(
                        collected, [item.as_context_file() for item in collected.files],
                        requested=[*context_files, {"relative_path": "未采集.md"}])}

        context_files = [
            {"relative_path": "资料/raw.md", "kind": "materials", "excerpt": "林舟会游泳。"},
            {"relative_path": "正文/draft.md", "kind": "draft", "title": "草稿", "excerpt": "……（本章前文略） 早已删掉的句子"},
            {"relative_path": "正文/第001章.md", "selection_source": "author_pin", "excerpt": "……（本章前文略）\n林舟来到钟楼。"},
            {"relative_path": "正文/payload.json"},
            {"relative_path": "正文/mixed.md"},
            {"relative_path": "大纲/secrets.md"},
            {"relative_path": "设定/世界观.md"},
            {"relative_path": "正文/缺失.md", "kind": "draft"},
        ]
        p.call("ordinary", {"context_files": context_files}, lambda: ordinary_dict(context_files))
        p.call("ordinary", {"context_files": context_files, "structured": ["设定/世界观.md", "资料/RAW.md"]},
               lambda: ordinary_dict(context_files, ("设定/世界观.md", "资料/RAW.md")))

        def collected_dict(bundle, files, query, max_context_files=8):
            collected = knowledge_context.collect_project_knowledge_context(bundle, context_files=files, query=query)
            merged, warnings = knowledge_context.merge_project_knowledge_entries(collected, context_files=files,
                                                                                max_context_files=max_context_files)
            ordinary = collected.ordinary
            return {"result": None if collected.result is None else asdict(collected.result), "warnings": list(collected.warnings),
                    "ordinary": None if ordinary is None else {"files": [asdict(item) for item in ordinary.files],
                                                              "omitted": [list(row) for row in ordinary.omitted],
                                                              "warnings": list(ordinary.warnings)},
                    "recovery_json": collected.recovery_json, "merged": merged, "merged_warnings": warnings,
                    "manifest": ordinary_context.source_delivery_manifest(ordinary, merged, requested=files)}

        bundle = {"project_root": str(p.root), "knowledge_exclusions": {"ids": [ID3, "x", 5, "pk_" + "y" * 70]}}
        pinned = [{"relative_path": "设定/世界观.md", "kind": "knowledge"}, {"relative_path": "资料/raw.md", "kind": "materials"},
                  {"relative_path": "正文/mixed.md", "excerpt": "<!-- storyforge-knowledge:v1"}]
        p.call("knowledge_context", {"query": "灵力 钟楼", "files": pinned},
               lambda: collected_dict(bundle, pinned, "灵力 钟楼"))
        p.call("knowledge_context", {"query": "灵力 钟楼", "files": pinned, "max_context_files": 1},
               lambda: collected_dict({"projectRoot": " " + str(p.root) + " "}, pinned, "灵力 钟楼", 1))
        p.call("knowledge_context", {"query": "x", "files": pinned, "bundle": "storyforge"},
               lambda: collected_dict({"project_root": "storyforge://book"}, pinned, "x"))
        p.call("knowledge_context", {"query": "x", "files": pinned, "bundle": "missing-root"},
               lambda: collected_dict({"project_root": str(p.root / "missing")}, pinned, "x"))
        p.call("knowledge_context", {"query": "x", "files": [], "bundle": "none"}, lambda: collected_dict(None, [], "x"))

        p.mutate("设定/钟楼.md", "钟楼搬到了城南。\n".encode())
        p.call("retrieve", {"query": "钟楼 子时"}, lambda: retrieval_dict(query="钟楼 子时"))

        return {
            "format_version": 1,
            "suite": "p1-knowledge",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book",
            "fixed_now": list(FIXED_NOW),
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [p.record("knowledge")],
            "pure": pure,
        }
