"""Real scan oracle: prose smells, promise ledger, scene load-bearing and entity budget checks,
executed on synthetic project trees and pure inputs (no author data, no model calls)."""

from __future__ import annotations

import hashlib
import json
import os

from golden_fs import Project, isolated_fs_oracle

SOURCES = [
    "app/domains/agent_runs/collapse_scan.py",
    "app/domains/agent_runs/entity_budget_scan.py",
    "app/domains/agent_runs/promise_scan.py",
    "app/domains/agent_runs/prose_pattern_rules.py",
    "app/domains/agent_runs/prose_scan.py",
]


def _dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


PROSE = {
    "cliches": "他不禁五味杂陈，心中一震，莫名地深深地叹气。\n他推门走出去，看了一眼巷口。",
    "telling": "她感到非常愤怒，又有些害怕。她不知道该怎么办，只好转身。他走过来问她，她答不上来。",
    "emotion-only": "悲伤与绝望在胸口翻滚，他推门、握刀、转身、停步、看向远处。",
    "exposition": "因为下雨，所以他没走。因为风大，所以门关着。事实上他知道答案。他走过去推门。",
    "low-dialogue": "雨水顺着屋檐落下，石板路被冲得发亮，巷子尽头的灯笼一盏接一盏熄灭，"
                    "守夜人提着铜锣从桥上经过，脚步声在潮湿的墙壁之间来回撞击，久久不散，"
                    "他推开门，握紧刀，转身看向巷口，又停下来听了一会儿。",
    "high-dialogue": "“你来了。”“我来了。”“东西呢？”“在这里。”“好，你走吧，别回头，也别再来找我。”"
                     "“我会回来的。”“不必了。”他推门走了。",
    "long-sentence": "他" + "沿着那条被雨水冲刷得发亮的青石板路" * 4 + "一直走到桥头才停下脚步回头看了一眼。他推门。",
    "short-sentences": "他走。她看。门开。风停。灯灭。雨落。人散。夜深。",
    "repetition": "他推开门，他推开门，他推开门，然后停下来看了看四周的动静。",
    "astral": "𠀀😀" * 30 + "雨水落下，他推门走进去，看了一眼，问了一句，转身离开。",
    "python-whitespace": "\u001c他推门\u001f走进去\u0085看了看" + "门外\u3000" * 20,
    "paragraph-patterns": "与此同时，顾迟越过断桥。\n另一边，沈禾推开仓门。\n镜头一转，巡夜人抵达钟楼。\n雨停了，一切才刚刚开始。",
    "clean": "他推开门，握紧刀，转身，看向巷口，又停下。她走过来，递给他一把伞，问他要去哪里。",
    # Boundaries: dialogue ratio 7/99 sits between 0.07 and 0.08; a sentence of exactly 91 chars;
    # U+001C is Python whitespace (not visible) while JS \s would count it.
    "dialogue-boundary": "“好吧好吧。”" + "雨" * 85 + "他推门看了看。",
    "sentence-91": "他" + "走" * 90 + "。他推门。",
    "whitespace-visible": "他" + "推" * 74 + "\u001c" * 10 + "门",
}

PROMISE_CANON = {"invariants": {"promises": [
    {"id": "p1", "title": "井底的声音", "status": "planted", "planted_chapter": 2, "due_chapter": 8},
    {"id": " p1 ", "title": "重复的 id", "status": "advancing", "planted_chapter": 3},
    {"id": "p2", "status": "resolved", "planted_chapter": 5},
    {"id": "p3", "title": " 先收后埋 ", "status": "resolved", "planted_chapter": 9, "resolved_chapter": 4},
    {"id": "p4", "status": "planted", "planted_chapter": 10, "due_chapter": 6},
    {"id": "p5", "status": "planted", "planted_chapter": 1, "due_chapter": None, "touches": [3, 12]},
    {"id": "p6", "status": "planted", "planted_chapter": 1, "due_chapter": None, "touches": [3, 0]},
    {"id": "p7", "kind": "recurring", "status": "advancing", "planted_chapter": 2, "cadence_chapters": 5, "touches": [20]},
    {"id": "p8", "kind": "recurring", "planted_chapter": 2, "cadence_chapters": 0},
    {"id": "", "status": "planted", "planted_chapter": 1},
    {"title": "没有 id"},
    {"id": "p9", "status": "planted", "planted_chapter": 0, "due_chapter": None},
    {"id": "p10", "status": "advancing", "planted_chapter": -3, "due_chapter": 40},
    {"id": "p4", "status": "planted", "planted_chapter": 10, "due_chapter": 6},
    {"id": "p11", "status": "planted", "planted_chapter": 1},
]}}


def p1_scans_snapshot() -> dict:
    with isolated_fs_oracle("scans-oracle-") as (api, run):
        from app.domains.agent_runs import promise_scan
        from app.domains.agent_runs.collapse_scan import collapse_scan
        from app.domains.agent_runs.entity_budget_scan import entity_budget_scan
        from app.domains.agent_runs.fs_tools import FsToolError
        from app.domains.agent_runs.prose_scan import check_prose_static_quality, prose_static_scan

        projects = []

        def project(name: str, files: dict) -> Project:
            item = Project(run, name, files)
            projects.append((name, item))
            return item

        p = project("prose", {
            **{f"正文/{name}.md": text for name, text in PROSE.items()},
            "正文/empty.md": "",
            "正文/blank.md": " \n\u3000\n",
            "正文/binary.md": b"\x00\x01binary",
            "正文/bom.md": "\ufeff他不禁叹气。他不禁转身。他推门。",
            "正文/long.md": "他推门走进去，看了一眼。" * 2_100,
            "正文/目录/a.md": "x",
        })
        for name in [*PROSE, "empty", "blank", "binary", "bom", "long"]:
            path = f"正文/{name}.md"
            p.call("prose_static_scan", {"path": path}, lambda path=path: prose_static_scan(str(p.root), path), errors=(FsToolError,))
        for path in ["正文/目录", "正文/missing.md", "../outside.md", ""]:
            p.call("prose_static_scan", {"path": path}, lambda path=path: prose_static_scan(str(p.root), path), errors=(FsToolError,))

        scene_text = "他来到码头，追问管理员，翻看账本，把登记表收进口袋，然后离开。"
        p = project("scenes", {
            "正文/第001章.md": scene_text,
            "正文/第002章.md": "他推门。",
            "正文/三桶.md": "他来到码头，询问证人，查看四周。",
            "笔记.md": "x",
            "大纲/总纲.md": "x",
            "正文/blank.md": "  ",
            ".storyforge/agent-instructions.md": "少用套话。",
            **{f"正文/第{i:03d}章.md": f"第{i}章" for i in range(3, 32)},
        })
        collapse_cases = [
            {}, {"beats": ["到场", " 取证", "保存 ", "转场"]}, {"beats": ["到场", "取证", "", "保存", "转场"]},
            {"beats": ["到场", "取证", "保存"]}, {"emotion_before": " 平静 ", "emotion_after": "平静"},
            {"emotion_before": "平静", "emotion_after": "愤怒"}, {"emotion_before": " ", "emotion_after": " "},
            {"irreversible_consequence": "  "}, {"irreversible_consequence": "钥匙落井"}, {"deletable": True},
            {"deletable": False}, {"beats": ["到场", "取证", "保存", "转场"], "emotion_before": "怕", "emotion_after": "怕",
                                   "irreversible_consequence": "", "deletable": True},
        ]
        for args in collapse_cases:
            p.call("collapse_scan", {"path": "正文/第001章.md", **args},
                   lambda args=args: collapse_scan(str(p.root), "正文/第001章.md", **args), errors=(FsToolError,))
        p.call("collapse_scan", {"path": "正文/三桶.md"},
               lambda: collapse_scan(str(p.root), "正文/三桶.md"), errors=(FsToolError,))
        for path in ["正文/blank.md", "正文", "../x.md"]:
            p.call("collapse_scan", {"path": path}, lambda path=path: collapse_scan(str(p.root), path), errors=(FsToolError,))
        budget_cases = [
            ("正文/第001章.md", {}),
            ("正文/第025章.md", {"new_core_locations": ["灯塔"], "new_mysteries": ["井底"], "new_core_evidence": ["账本"]}),
            ("正文/第031章.md", {"new_core_evidence": ["账本"], "new_equipment": ["无线电"], "new_mysteries": []}),
            ("笔记.md", {"chapter": 30, "new_equipment": ["枪"], "new_core_locations": ["a", "b", "c", "d"],
                        "new_key_characters": ["1", "2", "3", "4", "5", "6"], "new_core_evidence": ["x"] * 4,
                        "new_major_reversals": ["r1", "r2", "r3"]}),
            ("正文/第002章.md", {"new_key_characters": ["甲", "乙"], "budget_key_characters": 1,
                               "budget_core_locations": 0, "new_core_locations": ["码头"], "budget_new_mysteries_after_chapter_25": 9}),
            ("笔记.md", {}),
            ("大纲/总纲.md", {"chapter": 0}),
            ("正文/blank.md", {}),
        ]
        for path, args in budget_cases:
            p.call("entity_budget_scan", {"path": path, **args},
                   lambda path=path, args=args: entity_budget_scan(str(p.root), path, **args), errors=(FsToolError,))

        p = project("promises", {
            **{f"正文/第{i:03d}章.md": f"第{i}章" for i in range(1, 41)},
            ".storyforge/canon/canon.json": _dumps(PROMISE_CANON),
        })
        for stale in [30, 5]:
            p.call("promise_check", {"stale_after_chapters": stale},
                   lambda stale=stale: promise_scan.promise_check(str(p.root), stale_after_chapters=stale))
        p = project("no-promises", {"正文/第001章.md": "x"})
        p.call("promise_check", {}, lambda: promise_scan.promise_check(str(p.root)))

        pure = []
        constraint_cases = [
            ("character", PROSE["clean"], {"character_constraints": [
                {"forbidden_traits": ["递给", " 握紧 ", "", "哭泣"]}, {"forbidden_traits": "握紧"}, {"other": 1}]}),
            ("continuity-negated", "他没有带钥匙，推门走了。", {"continuity_facts": ["钥匙在他口袋里", {"statement": None}]}),
            ("continuity-statement", "他推门。", {"continuity_facts": [{"statement": " 门锁换了 "}]}),
            ("required-missing", "他推门走了。", {"required_facts": ["铜钟在井底", "x"]}),
            ("required-present", "铜钟沉在井底。", {"required_facts": ["铜钟在井底"]}),
            ("required-stripped", "他推门。", {"required_facts": [" 铜钟 "]}),
            ("beats-missed", PROSE["low-dialogue"], {"scene_beats": ["拔刀，追击", "跳河"], "ending_hook": "门后有人"}),
            ("beats-hit", "他拔刀追击，门后有人。", {"scene_beats": ["拔刀/追击"], "ending_hook": "门后有人"}),
            ("hook-short", "他拔刀。门后有人", {"ending_hook": "门"}),
            ("hook-tail-40", "他拔刀追击，门后有人" + "x" * 36, {"ending_hook": "门后有人"}),
            ("empty", "  \n ", {}),
        ]
        for name, text, kwargs in constraint_cases:
            pure.append({"fn": "check_prose_static_quality", "id": name, "text": text, "kwargs": kwargs,
                         "output": [issue.as_report_item() for issue in check_prose_static_quality(text, **kwargs)]})
        for current in [0, 7, 9, 25, 31, 40]:
            for stale in [1, 30]:
                output = promise_scan.check_promises(PROMISE_CANON, current, stale_after_chapters=stale)
                pure.append({"fn": "check_promises", "id": f"{current}-{stale}", "current_chapter": current,
                             "stale_after_chapters": stale, "output": output,
                             "ledger": promise_scan.build_promise_ledger(PROMISE_CANON, output)})
        for canon in [{}, {"invariants": None}, {"invariants": {"promises": {}}}]:
            output = promise_scan.check_promises(canon, 3)
            pure.append({"fn": "check_promises", "id": json.dumps(canon), "canon": canon, "current_chapter": 3,
                         "stale_after_chapters": 30, "output": output,
                         "ledger": promise_scan.build_promise_ledger(canon, output)})

        return {
            "format_version": 1,
            "suite": "p1-scans",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [item.record(name) for name, item in projects],
            "promise_canon": PROMISE_CANON,
            "pure": pure,
        }
