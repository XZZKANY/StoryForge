"""Real proposal / plan / observatory oracle: canon_delta, hooks_delta, serial plan projection and
updates, and the observatory aggregation, executed on synthetic project trees (no author data)."""

from __future__ import annotations

import datetime as real_datetime
import hashlib
import json
import os

from golden_fs import Project, isolated_fs_oracle

SOURCES = [
    "app/domains/agent_runs/canon_delta.py",
    "app/domains/agent_runs/canon_hooks_delta.py",
    "app/domains/agent_runs/observatory.py",
    "app/domains/agent_runs/serial_plan.py",
    "app/domains/agent_runs/serial_plan_update.py",
]
FIXED_NOW = [(2026, 10, 12, 4, 30, 15, 123000), (2026, 10, 12, 4, 30, 15, 0)]


def _dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


CANON = {
    "version": 1,
    "entities": [
        {"id": "char_lin", "canonical_name": "林舟", "aliases": ["阿舟"], "kind": "人物"},
        {"id": "char_shen", "canonical_name": "沈禾", "aliases": []},
        {"canonical_name": "无 id 的人"},
    ],
    "invariants": {
        "single_holder": [{"item": "断魂刀", "holder": "char_lin", "from_chapter": 1, "to_chapter": 3}],
        "lifespan": [{"entity": "char_shen", "exits_after_chapter": 2, "reason": "坠崖"}],
        "promises": [{"id": "p-old", "title": "旧账", "status": "planted", "planted_chapter": 1, "due_chapter": 2}],
    },
    "custom": {"weight": 1.5, "note": "作者自定义字段原样保留"},
}
CHAPTERS = {
    "正文/第001章.md": "林舟醒来，阿舟阿舟，沈禾喊他。他不禁五味杂陈。巡夜人提灯走过。",
    "正文/第002章.md": "沈禾坠崖。林舟推门走出去，看了一眼。",
    "正文/第003章.md": "沈禾又出现了。与此同时，顾迟越过断桥。\n另一边，沈禾推开仓门。\n镜头一转，巡夜人抵达钟楼。",
}
HOOKS = {"version": 1, "hooks": [
    {"id": "h1", "description": "井底的声音是谁", "status": "active"},
    {"id": "h2", "description": "断魂刀的下落", "status": "resolved"},
    {"id": "h3", "status": "active"},
]}
DELTA_ARGS = {
    "entities": [
        {"name": "林舟"},
        {"name": " 阿舟 ", "aliases": ["沈禾"]},
        {"name": "巡夜人", "aliases": [" 老周 ", "巡夜人", ""], "assertion_type": "text_observation",
         "evidence": [{"quote": "巡夜人提灯走过", "path": "正文/第001章.md", "start_line": 1}]},
        {"name": "巡夜人", "aliases": ["守夜的"], "assertion_type": "text_observation",
         "evidence": [{"quote": "巡夜人提灯走过", "path": "正文/第001章.md", "start_line": 1}]},
        {"name": "铜钟"},
    ],
    "holder_claims": [{"item": "断魂刀", "holder": "ent_ghost", "from_chapter": 2},
                      {"item": "断魂刀", "holder": "char_lin", "from_chapter": 1, "to_chapter": 3}],
    "exit_claims": [{"entity": "char_lin", "exits_after_chapter": 1, "reason": " 坠崖 ", "assertion_type": "model_inference"}],
    "timeline_claims": [{"before": "血月夜", "after": "登基"}, {"before": "登基", "after": "血月夜"}],
    "promise_claims": [
        {"title": " 井底的声音 ", "planted_chapter": 1},
        {"title": "铜钟何时再响", "planted_chapter": 2, "id": "p-bell", "status": "advancing", "due_chapter": None,
         "cadence_chapters": 3, "kind": "recurring", "resolved_chapter": 5},
        {"title": "铜钟何时再响", "planted_chapter": 2, "id": "", "status": "", "due_chapter": 4},
    ],
}
DELTA_ERRORS = [
    {"entities": [{"aliases": []}]},
    {"entities": [{"name": "a", "aliases": "b"}]},
    {"entities": [{"name": "a", "aliases": None}]},
    {"entities": [{"name": "a", "assertion_type": "guess"}]},
    {"holder_claims": [{"item": "刀", "holder": "a", "from_chapter": 2.0}]},
    {"holder_claims": [{"item": "刀", "holder": " "}]},
    {"exit_claims": [{"entity": "a"}]},
    {"exit_claims": [{"entity": "a", "exits_after_chapter": None}]},
    {"exit_claims": [{"exits_after_chapter": 1, "reason": 3}]},
    {"timeline_claims": [{"before": "a"}]},
    {"promise_claims": [{"title": "t"}]},
    {"promise_claims": [{"title": "t", "planted_chapter": 0}]},
    {"promise_claims": [{"title": "t", "planted_chapter": 1, "status": "done"}]},
    {"promise_claims": [{"title": "t", "planted_chapter": 3, "due_chapter": 2}]},
    {"promise_claims": [{"title": "t", "planted_chapter": 3, "due_chapter": "4"}]},
    {"promise_claims": [{"title": "t", "planted_chapter": 3, "cadence_chapters": 0}]},
    {"promise_claims": [{"title": "t", "planted_chapter": 3, "id": 5}]},
    {"entities": [{"name": "新人", "assertion_type": "author_setting"}, {"name": "新人", "assertion_type": "model_inference"}]},
]
PLAN = {
    "version": 1,
    "premise": "  末世里的吞噬者  ",
    "chapter_word_count_min": 2000,
    "chapter_word_count_max": 3000,
    "chapters": [
        {"ordinal": 1, "title": "醒来", "goal": "林舟醒来", "status": "done", "path": "正文/第001章.md"},
        {"ordinal": 2, "title": "坠崖", "goal": "沈禾坠崖", "status": "pending", "note": " 记得写雨 "},
        {"ordinal": 3, "title": "空缺", "status": "done"},
        {"ordinal": 4, "goal": "目标" * 120, "status": "blocked", "note": "等设定", "path": "正文/第004章.md"},
        {"ordinal": 5, "title": "回声" * 50, "status": "weird"},
        {"ordinal": 6, "status": "pending"},
        {"ordinal": 7, "status": "pending", "goal": "七"},
        {"ordinal": 8, "status": "pending", "goal": "八"},
        {"ordinal": 0, "title": "无效章序"},
        {"title": "没有章序"},
    ],
    "arcs": [
        {"title": "井底之谜", "target_chapters": [2, 5], "payoff_chapter": 8},
        {"title": "钟声", "payoff_chapter": 2},
        {"title": " ", "target_chapters": [2]},
    ],
}
PLAN_CHAPTERS = {"正文/第001章.md": "一", "正文/第002章.md": "二", "正文/第004章.md": "四"}


def p1_plans_snapshot() -> dict:
    with isolated_fs_oracle("plans-oracle-") as (api, run):
        from app.domains.agent_runs import observatory, serial_plan, serial_plan_update
        from app.domains.agent_runs.canon_delta import canon_delta, read_pending_proposals
        from app.domains.agent_runs.canon_hooks_delta import evaluate_hook_admission, hooks_delta
        from app.domains.agent_runs.fs_tools import FsToolError

        projects = []

        def project(name: str, files: dict) -> Project:
            item = Project(run, name, files)
            projects.append((name, item))
            return item

        def delta(p: Project, args: dict):
            p.call("canon_delta", args, lambda: canon_delta(str(p.root), **args), errors=(FsToolError,), typed_args=True)

        def pending(p: Project):
            p.call("read_pending_proposals", {}, lambda: read_pending_proposals(str(p.root)))

        def hooks(p: Project, args: dict):
            p.call("hooks_delta", args, lambda: hooks_delta(str(p.root), **args), errors=(FsToolError,))

        def plan_view(p: Project):
            def view():
                plan = serial_plan.build_plan(str(p.root))
                return {"block": serial_plan.build_plan_block(str(p.root)),
                        "payload": None if plan is None else serial_plan.to_payload(plan)}
            p.call("plan_view", {}, view)

        def plan_update(p: Project, args: dict):
            p.call("apply_plan_update", args, lambda: serial_plan_update.apply_plan_update(str(p.root), **args),
                   errors=(FsToolError,), typed_args=True)

        def mark(p: Project, path: str, *, absolute: bool = False, undo: bool = False):
            target = str(p.root / path) if absolute else path
            fn = serial_plan_update.unmark_chapter_written if undo else serial_plan_update.mark_chapter_written
            p.call("unmark_chapter_written" if undo else "mark_chapter_written", {"path": path, "absolute": absolute},
                   lambda: fn(str(p.root), target))

        def scan(p: Project, clock: int):
            moment = FIXED_NOW[clock]

            class FixedDatetime(real_datetime.datetime):
                @classmethod
                def now(cls, tz=None):
                    return real_datetime.datetime(*moment, tzinfo=tz)

            observatory.datetime = FixedDatetime
            try:
                p.call("observatory_scan", {"clock": clock}, lambda: observatory.run_observatory_scan(str(p.root)))
            finally:
                observatory.datetime = real_datetime.datetime

        p = project("delta", {**CHAPTERS, ".storyforge/canon/canon.json": _dumps(CANON), ".storyforge/canon/hooks.json": _dumps(HOOKS)})
        pending(p)
        delta(p, DELTA_ARGS)
        delta(p, {})
        pending(p)
        merged = json.loads(_dumps(CANON))
        merged["entities"].append({"id": "ent_" + hashlib.sha1("铜钟".encode()).hexdigest()[:8], "canonical_name": "铜钟", "aliases": []})
        merged["invariants"]["timeline_order"] = [{"before": "血月夜", "after": "登基"}]
        p.mutate(".storyforge/canon/canon.json", _dumps(merged).encode())
        pending(p)
        delta(p, {"entities": [{"name": "铜钟"}, {"name": "铜钟", "aliases": ["铜"]}], "promise_claims": [{"title": "旧账", "planted_chapter": 1, "id": "p-old"}]})
        for args in DELTA_ERRORS:
            delta(p, args)
        hooks(p, {"observed_hooks": [
            {"description": "井底的声音是谁"}, {"description": " 井底的声音 "}, {"description": "断魂刀的下落去了哪"},
            {"description": "断魂刀究竟在谁手里", "category": " 悬念 ", "note": "", "verification": "第三章"},
            {"description": "钟声"}, {"description": "钟声"}, {"description": "ABC 的秘密"}, {"description": "abc 的秘密"},
        ], "evidence_text": "😀𠀀如果你走出这扇门，我就跟你走。还剩三天。\r只有他知道。如果他\r回来就好了。\n有个关于钟楼的秘密。绝不能开门，否则后果自负。他发誓一定会回来。达到十级便会解锁。"})
        hooks(p, {"observed_hooks": [{"description": "  "}]})
        hooks(p, {"evidence_text": "  "})
        hooks(p, {})
        scan(p, 0)
        scan(p, 1)

        p = project("no-canon-observatory", {"正文/a.md": "他不禁叹气。", "正文/.hidden/b.md": "x", "README.MD": "他不禁转身。"})
        scan(p, 0)
        p = project("uncached-observatory", {**CHAPTERS, ".storyforge/canon/canon.json": _dumps(CANON),
                                             ".storyforge/writeback-receipts/" + "b" * 64 + ".outcome.json": "{}"})
        scan(p, 0)
        delta(p, {"entities": [{"name": "新人"}]})
        pending(p)

        draft = json.loads(_dumps(CANON))
        draft["entities"] += [{"id": "ent_dup", "canonical_name": "重名"}, {"id": "ent_dup", "canonical_name": "重名二"}]
        p = project("duplicate-draft", {**CHAPTERS, ".storyforge/canon/canon.json": _dumps(CANON),
                                        ".storyforge/canon/derived/proposals.json": _dumps(draft)})
        delta(p, {"entities": [{"name": "铜钟"}]})
        pending(p)

        p = project("plan", {**PLAN_CHAPTERS, ".storyforge/serial-plan.json": _dumps(PLAN)})
        plan_view(p)
        mark(p, "正文/第002章.md")
        plan_view(p)
        mark(p, "正文/第002章.md", absolute=True)
        mark(p, "正文/第004章.md")
        mark(p, "正文/第009章.md")
        mark(p, "大纲/a.md")
        mark(p, "../outside.md")
        mark(p, "正文/第002章.md", undo=True)
        mark(p, "正文/第009章.md", undo=True)
        mark(p, "正文/第001章.md", undo=True)
        p.mutate("正文/第003章.md", "三".encode())
        plan_view(p)
        plan_update(p, {"chapters": [{"ordinal": 5, "status": "done"}, {"ordinal": 9, "status": "done"}]})
        plan_update(p, {"chapters": [
            {"ordinal": 3, "status": "done", "path": "随便写的.md"},
            {"ordinal": 2, "title": " 新标题 ", "goal": None, "note": "  "},
            {"ordinal": 9, "title": "新增", "status": "bogus"},
            {"ordinal": 2.0, "status": "done"}, "not-an-object", {"status": "pending"},
        ], "premise": "", "chapter_word_count_min": 0, "chapter_word_count_max": 4000, "remove_ordinals": [7, 7, 0, "8", 99],
            "arcs": [{"title": "新弧线", "target_chapters": [3]}, "bad"]})
        plan_view(p)
        p.remove("正文/第003章.md")
        mark(p, "正文/第003章.md", undo=True)
        plan_view(p)

        p = project("no-plan", {"正文/第001章.md": "一"})
        plan_view(p)
        mark(p, "正文/第001章.md")
        plan_update(p, {"premise": "新书", "chapters": [{"ordinal": 1, "status": "done", "goal": "开篇"}, {"ordinal": 2}]})
        plan_view(p)

        pure = []
        for existing, hook in [
            ({"hooks": [{"description": "井底的声音是谁"}]}, {"description": "井底的声音是谁？"}),
            ({"hooks": [{"description": "钟楼里的老人知道真相"}]}, {"description": "老人知道钟楼真相"}),
            ({"hooks": [{"description": "钟楼里的老人知道真相"}]}, {"description": "钟楼老人"}),
            ({"hooks": [{"description": "Mystery Box"}]}, {"description": "  mystery box "}),
            ({"hooks": [{"description": "mystery box"}]}, {"description": "MYSTERY BOX"}),
            ({"hooks": [{"description": "甲乙丙丁戊"}]}, {"description": "甲乙丙己庚"}),
            ({"hooks": [{"description": "甲乙丙丁戊"}]}, {"description": "甲乙丙丁庚"}),
            ({"hooks": "bad"}, {"description": "x"}),
            ({"hooks": [{"description": "a"}, {"description": "ab"}, {"description": "a"}]}, {"description": "a"}),
            ({}, {"description": None}),
        ]:
            pure.append({"fn": "evaluate_hook_admission", "existing": existing, "hook": hook,
                         "output": evaluate_hook_admission(existing, hook)})
        for existing, updates in [
            ({}, {"chapters": [{"ordinal": 1}]}),
            ({"chapters": [{"ordinal": 2, "title": "旧", "extra": True}, {"ordinal": 2, "title": "后者"}]},
             {"chapters": [{"ordinal": 2, "title": None}], "chapter_word_count_min": True}),
            ({"version": 3, "arcs": None}, {"remove_ordinals": [1]}),
        ]:
            merged_plan, counts = serial_plan_update.merge_plan_payload(existing, **updates)
            pure.append({"fn": "merge_plan_payload", "existing": existing, "updates": updates,
                         "merged_json": json.dumps(merged_plan, ensure_ascii=False), "counts": counts})
        for chapters, written in [([{"ordinal": 2, "status": "done"}, {"ordinal": 1, "status": "done"}, {"ordinal": 3}], [1]),
                                  (None, []), ([{"ordinal": 0, "status": "done"}, "x"], [])]:
            pure.append({"fn": "reject_premature_done", "chapters": chapters, "written": written,
                         "output": serial_plan_update.reject_premature_done(chapters, frozenset(written))})

        return {
            "format_version": 1,
            "suite": "p1-plans",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book",
            "fixed_now": FIXED_NOW,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [item.record(name) for name, item in projects],
            "pure": pure,
        }
