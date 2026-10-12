"""Real canon chain oracle: consistency scan, presence rebuild, projection/dossier/report
writes and scene constraints, executed on synthetic project trees (no author data)."""

from __future__ import annotations

import hashlib
import json
import os

from golden_fs import Project, isolated_fs_oracle

SYNTHETIC_ROOT = r"D:\synthetic-book"

SOURCES = [
    "app/common/generation_sources.py",
    "app/domains/agent_runs/canon_assertions.py",
    "app/domains/agent_runs/canon_cache_freshness.py",
    "app/domains/agent_runs/canon_context.py",
    "app/domains/agent_runs/canon_dossier.py",
    "app/domains/agent_runs/canon_gate.py",
    "app/domains/agent_runs/canon_rebuild.py",
    "app/domains/agent_runs/canon_service.py",
    "app/domains/agent_runs/canon_store.py",
    "app/domains/agent_runs/consistency_scan.py",
    "app/domains/agent_runs/fs_safety.py",
    "app/domains/agent_runs/fs_tools.py",
]


def _dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


EVIDENCE = [{"quote": "林舟是船夫之子，\n自幼  水性极好。", "path": "人物/主角.md", "start_line": 1, "end_line": 2}]
CANON = {
    "version": 1,
    "entities": [
        {"id": "char_lin", "canonical_name": "林舟", "aliases": ["阿舟", " 舟哥 ", "林舟", ""], "kind": "人物",
         "assertion_type": "author_setting", "evidence": EVIDENCE},
        {"id": "char_shen", "canonical_name": "沈禾", "aliases": [], "kind": "人物"},
        {"id": "item_bell", "canonical_name": "铜钟", "kind": "物品", "assertion_type": "model_inference"},
        {"id": "char_ghost", "canonical_name": "巡夜人", "kind": " "},
        {"canonical_name": "无名氏"},
        {"id": "char_blank", "canonical_name": "  ", "aliases": ["老周"]},
    ],
    "invariants": {
        "single_holder": [
            {"item": "断魂刀", "holder": "char_lin", "from_chapter": 1, "to_chapter": 2,
             "assertion_type": "author_setting", "evidence": EVIDENCE},
            {"item": "断魂刀", "holder": "char_shen", "from_chapter": 2},
            {"item": "铜钟", "holder": "char_ghost", "assertion_type": "model_inference"},
            {"item": " ", "holder": "char_lin"},
        ],
        "timeline_order": [{"before": "血月夜", "after": "登基"}],
        "lifespan": [
            {"entity": "char_shen", "exits_after_chapter": 1, "reason": "坠崖", "assertion_type": "text_observation",
             "evidence": [{"quote": "沈禾坠入深渊"}, {"quote": "  "}, {"quote": "x" * 130, "path": "正文/第001章.md", "start_line": 3},
                          {"quote": "第三条", "path": "a  b.md", "start_line": 4, "end_line": 4}]},
            {"entity": "item_bell", "exits_after_chapter": 2, "assertion_type": "model_inference"},
        ],
    },
}
CHAPTERS = {
    "正文/第001章.md": "第一天清晨，林舟醒来。阿舟，阿舟！沈禾喊他。\n铜钟在钟楼里响了三下，次日也是如此。\n他推开门走进雨里去了，他推开门走进雨里去了。\r\n",
    "正文/第002章.md": "三天后，舟哥回到渡口，铜钟沉默。\r\n他推开门走进雨里去了。黄昏时分，雨停了。\n",
    "正文/第003章.md": "\ufeff沈禾的声音从井底传来。\r沈禾？林舟愣住。\r他推开门走进雨里去了。\r入夜，沈禾又出现。",
}
HOOKS = {
    "version": 1,
    "hooks": [
        {"id": "h1", "description": "井底的声音是谁", "status": "active", "category": "悬念",
         "planted_at": {"path": "正文/第001章.md", "chapter": 1}, "note": "第三章回响"},
        {"id": "h2", "description": "断魂刀的下落" * 6, "status": "planted",
         "planted_at": {"path": "正文/第001章.md", "chapter": 1},
         "last_advanced_at": {"path": "正文/第002章.md"}},
        {"id": "h3", "description": "已回收的旧账", "status": "resolved"},
        {"id": "h4", "description": "  ", "status": "active"},
        {"id": "h5", "description": "没有埋点的承诺", "status": "active", "category": " "},
    ],
    "agenda": {
        "3": {"advance": ["h1", "missing-id"], "resolve": ["h2"]},
        "2": {"advance": [], "resolve": []},
    },
}


def p1_canon_chain_snapshot() -> dict:
    with isolated_fs_oracle("canon-chain-oracle-") as (api, run):
        from app.common.generation_sources import GenerationSourceCapture, text_sha256
        from app.domains.agent_runs import canon_assertions
        from app.domains.agent_runs.canon_context import build_scene_constraint_block
        from app.domains.agent_runs.canon_rebuild import rebuild_presence
        from app.domains.agent_runs.canon_service import build_canon_projection
        from app.domains.agent_runs.consistency_scan import consistency_scan
        from app.domains.agent_runs.fs_tools import FsToolError

        projects = []

        def project(name: str, files: dict) -> Project:
            item = Project(run, name, files)
            projects.append((name, item))
            return item

        def scan(p: Project, terms, **kwargs):
            p.call("consistency_scan", {"terms": terms, **kwargs},
                   lambda: consistency_scan(str(p.root), terms, **kwargs), errors=(FsToolError,))

        def projection(p: Project, **kwargs):
            p.call("canon_projection", kwargs,
                   lambda: build_canon_projection(str(p.root), **kwargs).output, errors=(FsToolError,))

        def presence(p: Project, entities, **kwargs):
            p.call("rebuild_presence", {"entities": entities, **kwargs},
                   lambda: rebuild_presence(str(p.root), entities, **kwargs), errors=(FsToolError,))

        def scene(p: Project, current, *, absolute: bool = True):
            target = None if current is None else (str(p.root / current) if absolute else current)

            def execute():
                capture = GenerationSourceCapture(str(p.root))
                # Source ids hash the project identity; pin it to the TS replay root.
                capture.project_identity_sha256 = text_sha256(os.path.normcase(SYNTHETIC_ROOT))
                with capture.collecting():
                    block = build_scene_constraint_block(str(p.root), target)
                return {
                    "block": block,
                    "sources": capture.sources,
                    "selections": capture.selections,
                    "projections": [{"row": row, "text": text} for row, text in capture.projections],
                }

            p.call("scene_constraints", {"current_file": current, "absolute": absolute}, execute)

        basic_files = {
            **CHAPTERS,
            "人物/主角.md": "林舟是船夫之子，\n自幼水性极好。阿舟。\n",
            "大纲/总纲.md": "林舟、沈禾、铜钟。血月夜之后登基。\n",
            ".storyforge/agent-instructions.md": "林舟的口头禅要少用。\n",
            ".storyforge/canon/canon.json": _dumps(CANON),
            ".storyforge/canon/hooks.json": _dumps(HOOKS),
            "灵感.md": "铜钟铜钟铜钟\n",
            "notes.txt": "林舟\n",
        }
        p = project("basic", basic_files)
        projection(p)
        projection(p, refresh=False)
        projection(p, glob="第00[12]章.md", refresh=True)
        projection(p, glob="正文/*.md")
        for current in ["正文/第001章.md", "正文/第002章.md", "正文/第003章.md", "正文/第004章.md",
                        "正文/第0章.md", "大纲/总纲.md", None]:
            scene(p, current)
        scene(p, "正文/第003章.md", absolute=False)
        scene(p, "../outside.md", absolute=False)
        scan(p, ["林舟", " 沈禾 ", "林舟", "铜钟", "", "不存在的词", "推开门"])
        scan(p, ["林舟"], subpath="正文")
        scan(p, ["林舟"], subpath="正文/第001章.md")
        scan(p, ["林舟"], subpath="..")
        scan(p, ["林舟"], glob="*.txt")
        scan(p, None)
        scan(p, [f"词{i}" for i in range(35)])
        presence(p, [{"id": "x", "canonical_name": "林舟", "aliases": ["铜钟"]}, {"id": "y", "aliases": ["  "]}])
        presence(p, [])

        p = project("no-canon", dict(CHAPTERS))
        projection(p)
        scene(p, "正文/第001章.md")

        p = project("empty", {})
        projection(p)
        scene(p, None)
        scan(p, ["x"])

        p = project("uncached-receipt", {
            **CHAPTERS,
            ".storyforge/canon/canon.json": _dumps(CANON),
            ".storyforge/writeback-receipts/" + "a" * 64 + ".intent.json": "{}",
        })
        projection(p)
        projection(p, refresh=False)

        p = project("stale-cache", {**CHAPTERS, ".storyforge/canon/canon.json": _dumps(CANON)})
        projection(p)
        p.mutate(".storyforge/canon/canon.json", _dumps({**CANON, "version": 2}).encode())
        projection(p, refresh=False)

        many = {"version": 1, "entities": [{"id": f"e{i}", "canonical_name": f"名{i:02d}"} for i in range(34)]}
        p = project("many-entities", {
            "正文/卷一/第001章.md": "".join(f"名{i:02d}" for i in range(0, 34, 2)) + "\n",
            "正文/卷二/第001章.md": "名33名33\n名01",
            ".storyforge/canon/canon.json": _dumps(many),
        })
        projection(p)

        markers = "\n".join(f"第{i}天，次日，黄昏。" for i in range(40))
        repeated = "".join(f"重复的句子编号{i % 25:02d}。" for i in range(80))
        p = project("text-edges", {
            "正文/a.md": markers,
            "正文/b.md": repeated + "\n" + repeated,
            "正文/c.md": b"\xef\xbb\xbf\xe6\x9e\x97\xe8\x88\x9f\xff\xfe\r\n\xe6\x9e\x97",
            "正文/d.md": b"\x00binary\xe6\x9e\x97\xe8\x88\x9f",
            "正文/f.md": "林舟" * 10 + "\n" + "a" * 600_000 + "\n林舟",
            "正文/g.md": "",
            ".storyforge/canon/canon.json": _dumps({"entities": [{"id": "lin", "canonical_name": "林舟", "aliases": ["林"]}]}),
        })
        scan(p, ["林舟", "林", "舟"])
        projection(p)

        # 512001 bytes: the 512000-byte cut lands inside the last character of a marker line.
        p = project("truncated-tail", {
            "正文/e.md": "a" * 511_991 + "\n黄昏林",
            # Python strip removes U+001C but keeps U+FEFF; a clause repeated exactly twice.
            "正文/f.md": "黄昏林\n\u001c入夜时分﻿\n只出现两次的子句。只出现两次的子句。\n",
        })
        scan(p, ["林"])

        p = project("budgets", {
            **{f"正文/{i:04d}.md": "林舟。" for i in range(2_001)},
            "正文/0000.md": "林舟" * 3,
            ".storyforge/canon/canon.json": _dumps({"entities": [{"id": "lin", "canonical_name": "林舟"}]}),
        })
        scan(p, ["林舟"])
        projection(p)

        p = project("long-provenance", {
            **{f"正文/第{i:03d}章.md": f"林舟第{i}次出场。" for i in range(1, 24)},
            ".storyforge/canon/canon.json": _dumps({"entities": [{"id": "lin", "canonical_name": "林舟"}],
                                                   "invariants": {"lifespan": [{"entity": "lin", "exits_after_chapter": 20}]}}),
        })
        projection(p)
        for current in ["正文/第０章.md", "正文/第１２章.md", "正文/第٣章.md", "正文/第 7 章.md", "正文/第99章.txt",
                        ".storyforge/第99章.md", "大纲/第99章.md", "正文/第005章.md"]:
            scene(p, current)
        scene(p, "D:第001章.md", absolute=False)

        p = project("assertions-only", {
            "正文/第001章.md": "无关正文",
            ".storyforge/canon/canon.json": _dumps({"entities": [], "invariants": {
                "lifespan": [{"entity": "ghost", "exits_after_chapter": 0}]}}),
        })
        projection(p)
        scene(p, "正文/第001章.md")
        scene(p, None)

        hooks_only = {"hooks": [{"id": "a", "description": "孤立伏笔", "status": "active",
                                 "planted_at": {"path": "正文/第001章.md", "chapter": 1}}],
                      "agenda": {"14": {"advance": ["a"]}}}
        p = project("stale-hooks", {
            **{f"正文/第{i:03d}章.md": f"第{i}章" for i in range(1, 16)},
            ".storyforge/canon/hooks.json": _dumps(hooks_only),
        })
        scene(p, "正文/第014章.md")
        scene(p, "正文/第012章.md")
        scene(p, "正文/第011章.md")

        p = project("agenda-only", {
            "正文/第001章.md": "x",
            "正文/第002章.md": "y",
            ".storyforge/canon/hooks.json": _dumps({"hooks": [], "agenda": {"2": {"resolve": ["ghost-hook"]}}}),
        })
        scene(p, "正文/第002章.md")

        pure = []

        def pure_case(fn: str, entry, label: str = "x"):
            row = {"fn": fn, "entry_json": json.dumps(entry, ensure_ascii=False), "label": label}
            try:
                if fn == "normalize":
                    row["output_json"] = json.dumps(canon_assertions.normalize_assertion_metadata(entry, label), ensure_ascii=False)
                elif fn == "render":
                    row["output"] = canon_assertions.render_assertion_metadata(entry)
                else:
                    row["output"] = canon_assertions.format_chapter_window(entry)
            except FsToolError as error:
                row["error"] = str(error)
            pure.append(row)

        for entry in [
            {}, {"assertion_type": "author_setting"}, {"assertion_type": "nope"}, {"evidence": "x"},
            {"evidence": [{"quote": " "}]}, {"evidence": [{"quote": "q", "path": "a/../b"}]},
            {"evidence": [{"quote": "q", "path": "C:/x"}]}, {"evidence": [{"quote": "q", "path": "/abs"}]},
            {"evidence": [{"quote": "q", "path": "a:b"}]}, {"evidence": [{"quote": "q", "path": " "}]},
            {"evidence": [{"quote": "q", "path": "a\\b.md", "start_line": 2, "end_line": 3}]},
            {"evidence": [{"quote": "q", "start_line": 2}]}, {"evidence": [{"quote": "q", "path": "a", "start_line": 0}]},
            {"evidence": [{"quote": "q", "path": "a", "end_line": 3}]},
            {"evidence": [{"quote": "q", "path": "a", "start_line": 3, "end_line": 2}]},
            {"assertion_type": "text_observation", "evidence": [], "extra": 1},
        ]:
            pure_case("normalize", entry, "entities[0]")
        for entry in [
            {}, {"assertion_type": "author_setting"}, {"assertion_type": "?"}, {"evidence": []},
            {"assertion_type": "model_inference", "evidence": [{"quote": "  多  行\n引文 "}, {"quote": "q", "path": " a\tb ", "start_line": 1, "end_line": 1}, {"quote": "q3"}]},
            {"evidence": [{"quote": "长" * 121, "path": "p" * 170, "start_line": 5, "end_line": 9}]},
            {"evidence": [{"quote": "q", "start_line": 5}]},
        ]:
            pure_case("render", entry)
        for entry in [{}, {"from_chapter": 3}, {"to_chapter": 5}, {"from_chapter": 2, "to_chapter": 2}]:
            pure_case("window", entry)

        return {
            "format_version": 1,
            "suite": "p1-canon-chain",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": SYNTHETIC_ROOT,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [item.record(name) for name, item in projects],
            "assertions": pure,
        }
