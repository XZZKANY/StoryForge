"""Real review-stack oracle: heuristic review skills, review prompts and LLM-output parsing with a
scripted fake model, review report assembly, revise scope / delivery, and cross-chapter checks."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict
from types import SimpleNamespace

from golden_fs import Project, isolated_fs_oracle

SOURCES = [
    "app/domains/agent_runs/cross_chapter.py",
    "app/domains/agent_runs/review_report.py",
    "app/domains/agent_runs/revise_delivery.py",
    "app/domains/agent_runs/revise_scope.py",
    "app/domains/ide/cross_chapter_consistency.py",
    "app/domains/ide/review_reasoning.py",
    "app/domains/ide/review_skills.py",
]

LONG = "他推开门走进雨里，" * 40
TEXTS = [
    "", "他推门。", "他推开门。但门外没有人。\n她却在等他？", LONG + "\n" + LONG + "因为害怕，他决定回去。",
    "说明一下，其实事实上这意味着让人觉得显然如此。\n" + "长" * 300, "忽然门开了。" * 50,
    "我们在雨里走着，" * 40, "昨天才第一次见面，第十天就前后矛盾，不一致。", " \n\t ", "短" * 280, "雨" * 239, " " + "雨" * 240 + "\n",
]
BUNDLES = [
    None, {}, {"files": "x"}, {"files": [{"relative_path": "人物/林舟.md", "kind": "character", "title": "林舟", "excerpt": "林舟会游泳。"},
                                          {"relativePath": "设定/a.md", "kind": "setting"}, {"path": "x.md"}, 3, {"kind": " "}],
                               "budget": {"truncated": True}},
    {"files": [{"relative_path": "a.md", "kind": "character", "excerpt": 5}], "budget": {"truncated": "yes"}},
    {"files": [{"kind": "setting"}, {"kind": "character"}, {"kind": "setting"}, *({"path": f"{i}.md"} for i in range(9))]},
]
LLM_REPLIES = [
    '[{"severity":"HIGH","code":"plot.hook","message":"钩子  弱","evidence":"原文\\n片段"}]',
    '```json\n[{"severity":"bogus","code":"","message":"' + "很长" * 200 + '"}]\n```',
    '模型说明：\n[{"code":"x"}, 5, {"severity":"low"}] 后记',
    '{"not":"array"}', "   ", "[" + ",".join(f'{{"code":"c{i}"}}' for i in range(9)) + "]", "not json at all",
    '[{"severity":" High ","evidence":"  多   空白  "}]', '[{"message":"' + "ab " * 100 + '"}]',
    '```\n{"a": 1}\n```',
]
REPORT = {
    "issues": [
        {"id": "plot-1", "agent": "plot-agent", "category": "plot", "severity": "high", "message": "冲突不足",
         "evidence": "原文" * 200, "suggested_action": "补阻力"},
        {"id": "character-1", "agent": "character-agent", "severity": "medium", "message": "动机不清", "evidence": "她走了"},
        {"id": "prose-1", "agent": "prose-agent", "category": "prose", "message": "说明腔"},
        {"id": "continuity-1", "agent": "continuity-agent", "message": "时间线冲突", "evidence": "第十天"},
        {"agent": "unknown-agent", "message": "无 id"},
        "not-a-dict",
    ],
    "suggested_actions": ["先核查剧情", "  ", 3, "再看人物"],
}
SCOPE_CASES = [
    ({}, None), ({"instruction": "只改人物"}, None), ({"instruction": "不改剧情，润色一下"}, None),
    ({"instruction": "全文重写"}, None), ({"selected_issue_ids": ["prose-1", "nope", " "]}, None),
    ({"included_categories": ["character", "bogus"], "excluded_categories": ["plot"]}, None),
    ({"revision_constraints": ["保留结尾"]}, "保留开头的对白，不要改主角名字。别改，"),
    ({}, "按审稿意见改第二条"), ({}, "改第1项和第三个"), ({}, "第十二条"), ({}, "第0条"), ({}, "只改人物的第一条"),
    ({"excluded_categories": ["character"]}, "第二条"), ({}, "整体重写，第二十一条以外都保留"), ({}, "第２条"),
    ({}, "第 一 条"), ({}, "第两条"), ({}, "第十一条"), ({}, "第二十条"), ({}, "第三十二条"),
    ({"instruction": "改第99999999999999999999条和第二条"}, None), ({"instruction": "第0条、第七七条，只改文风"}, None),
    ({"instruction": "第一条", "selected_issue_ids": ["continuity-1"]}, None), ({"selected_issue_ids": ["continuity-1"]}, "第一条"),
    ({"instruction": "只改人物的第一条"}, None), ({"instruction": "全文重写，保留结尾"}, None),
    ({"instruction": "，".join(f"保留{word}" for word in "甲乙丙丁戊己庚辛壬甲")}, None),
]


def p1_review_snapshot() -> dict:
    with isolated_fs_oracle("review-oracle-") as (api, run):
        from app.common.llm_client import LLMConfigError, LLMError
        from app.domains.agent_runs import cross_chapter, review_report, revise_delivery, revise_scope
        from app.domains.agent_runs.errors import AgentOrchestrationError
        from app.domains.agent_runs.fs_tools import FsToolError
        from app.domains.ide import cross_chapter_consistency as ccc
        from app.domains.ide import review_reasoning, review_skills

        pure = []

        def record(fn, args, run_fn, errors=(AgentOrchestrationError, ValueError, FsToolError, LLMError)):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            pure.append(row)

        for bundle in BUNDLES:
            record("context_summary", {"bundle": bundle}, lambda bundle=bundle: review_skills.review_context_summary(bundle))
        for text in TEXTS:
            paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
            for bundle in (None, BUNDLES[3], BUNDLES[4]):
                record("heuristics", {"content": text, "bundle": bundle},
                       lambda text=text, paragraphs=paragraphs, bundle=bundle: [
                           asdict(review_reasoning._heuristic_result(key, text, paragraphs, bundle)) for key in review_reasoning.REVIEW_AGENT_KEYS])
        for plot, character, prose in [([], [], []), ([1], [], []), ([], [1], [1])]:
            record("suggested_actions", {"plot": plot, "character": character, "prose": prose},
                   lambda plot=plot, character=character, prose=prose: review_skills.suggested_actions_for_review(
                       plot_issues=plot, character_issues=character, prose_issues=prose))
        for key in review_reasoning.REVIEW_AGENT_KEYS:
            record("system_prompt", {"key": key}, lambda key=key: review_reasoning._review_system_prompt(key))
        for bundle in BUNDLES[:4]:
            for instruction in ("", "只看人物，“保留”这段"):
                record("user_prompt", {"bundle": bundle, "instruction": instruction, "content": TEXTS[2]},
                       lambda bundle=bundle, instruction=instruction: review_reasoning._review_user_prompt(
                           "plot", TEXTS[2], bundle, author_instruction=instruction))
        for raw in [*LLM_REPLIES, None, 5]:
            record("parse_issues", {"raw": raw}, lambda raw=raw: review_reasoning._parse_llm_issues("prose", raw))

        def encode(reply):
            return {"raise": type(reply).__name__, "message": str(reply)} if isinstance(reply, Exception) else reply

        current = {"calls": []}
        review_reasoning.has_run_control = lambda: True
        review_reasoning.check_run_interruption = lambda stage: current["calls"].append({"interrupt": stage})

        def scripted(replies):
            calls = []
            current["calls"] = calls

            def fake(source, *, system_prompt, user_prompt):
                calls.append({"system": system_prompt, "user": user_prompt})
                reply = replies[sum("system" in call for call in calls) - 1]
                if isinstance(reply, Exception):
                    raise reply
                return reply
            return fake, calls

        reasoner_cases = [
            [{"content": LLM_REPLIES[0], "latency_ms": 12}, {"content": "[]", "latency_ms": 3.9}, {"content": LLM_REPLIES[7], "latency_ms": True}],
            [LLMError("网络超时 " + "x" * 300), {"content": '{"a": 1}'}, {"content": LLM_REPLIES[2]}],
            [{"content": LLM_REPLIES[4]}, {"latency_ms": 5}, {"content": LLM_REPLIES[5], "latency_ms": 7.0}],
            [LLMError("a"), LLMError("b"), LLMError("c")],
        ]
        overhead = max(len(review_reasoning._review_user_prompt(key, "", BUNDLES[3])) for key in review_reasoning.REVIEW_AGENT_KEYS)
        budget_cases = [{"repeat": ["雨", review_reasoning.MAX_REVIEW_PROMPT_CHARS - overhead + extra], "instruction": "",
                         "replies": [{"content": "[]"}] * 3} for extra in (0, 1)]
        cases = [{"content": TEXTS[3], "instruction": "改第二条", "replies": replies} for replies in reasoner_cases] + budget_cases
        for index, case in enumerate(cases):
            replies = case["replies"]
            fake, calls = scripted(replies)
            review_reasoning._call_llm = fake
            args = {"case": index, **case, "bundle": BUNDLES[3], "model": " fake-model ", "replies": [encode(reply) for reply in replies]}

            def reason(calls=calls, args=args):
                reasoner = review_reasoning.LlmReviewReasoner({"STORYFORGE_LLM_MODEL": args["model"]})
                text = args["content"] if "content" in args else args["repeat"][0] * args["repeat"][1]
                results = reasoner.review_all(content=text, paragraphs=[p.strip() for p in text.splitlines() if p.strip()],
                                              context_bundle=args["bundle"], author_instruction=args["instruction"])
                if "repeat" in args:
                    # The full 260k-char prompt is pinned by digest instead of being stored verbatim.
                    calls = [{"system": call["system"], "user_sha256": hashlib.sha256(call["user"].encode()).hexdigest(),
                              "user_chars": len(call["user"])} if "user" in call else call for call in calls]
                return {"results": [asdict(item) for item in results], "calls": calls}

            record("llm_reasoner", args, reason)

        class Executor:
            def run(self, role, payload, *, tool_name):
                if role == "continuity_reviewer":
                    return review_report.continuity_subagent_handler(payload)
                return review_report.review_subagent_handler(role.removesuffix("_reviewer"))(payload)

        class FakeUuid:
            hex = "0123456789abcdef0123456789abcdef"

        review_report.uuid = SimpleNamespace(uuid4=lambda: FakeUuid())
        for case, (reasoner_kind, text) in enumerate([("heuristic", TEXTS[3]), ("heuristic", TEXTS[7]), ("llm", TEXTS[2]), ("llm-failed", TEXTS[1]),
                                                       ("heuristic", LONG + "前后不一致。")]):
            replies = []
            if reasoner_kind == "heuristic":
                reasoner = review_reasoning.HeuristicReviewReasoner()
            else:
                replies = ([{"content": LLM_REPLIES[0]}, LLMError("b"), {"content": "[]"}] if reasoner_kind == "llm"
                           else [LLMError("a"), LLMError("b"), LLMError("c")])
                fake, _calls = scripted(replies)
                review_reasoning._call_llm = fake
                reasoner = review_reasoning.LlmReviewReasoner({"STORYFORGE_LLM_MODEL": "m"})
            review_report._select_review_reasoner = lambda reasoner=reasoner: reasoner

            args = {"case": case, "reasoner": reasoner_kind, "model": "m", "content": text, "bundle": BUNDLES[3],
                    "file_path": "正文/第001章.md", "user_message": "审一下", "hints": ["plot_reviewer"], "mentions": ["@剧情"],
                    "replies": [encode(reply) for reply in replies]}

            def build(args=args):
                report, traces = review_report.build_multi_agent_review_report_with_executor(
                    Executor(), file_path=args["file_path"], content=args["content"], context_bundle=args["bundle"],
                    user_message=args["user_message"], requested_role_hints=args["hints"], requested_role_mentions=args["mentions"])
                return {"report": report, "summary": review_report.review_report_summary(report),
                        "traces": [{"tool_name": t.tool_name, "status": t.status, "input_summary": t.input_summary,
                                    "output_summary": t.output_summary} for t in traces]}

            record("build_report", args, build)
        for report in [{}, {"mode": "heuristic_only", "issues": "x", "agent_findings": []},
                       {"mode": "mixed", "issues": [1, 2], "agent_findings": {"plot": {"issue_count": 2, "mode": "heuristic", "degraded_reason": "x", "agent": ""},
                                                                              "prose": {"issue_count": 0, "mode": "heuristic", "degraded_reason": ""}}}]:
            record("report_summary", {"report": report}, lambda report=report: review_report.review_report_summary(report))

        for args, author in SCOPE_CASES:
            def scope(args=args, author=author):
                resolved = revise_scope.resolve_revise_scope(REPORT, args, author_instruction=author)
                instruction = author or args.get("instruction") or "改一下"
                return {"scope": resolved, "public": revise_scope.public_revise_scope(resolved),
                        "instruction": revise_scope.scoped_revise_instruction(instruction, REPORT, resolved),
                        "summary": revise_scope.revise_summary_with_scope("已修订。", resolved),
                        "references_review": revise_scope.revision_references_review(instruction)}
            record("revise_scope", {"args": args, "author": author}, scope)
        for raw in ["一", "两", "十", "十一", "二十", "二十一", "三十二", "九十九", "十十", "一十", "十二三", "二三十", "二二",
                    "1", "01", "0", "00", "12", "２", "٣", "\U0001d7d1", "\U0001d7f9", "1十", "十1", "99999999999999999999", "七七七七"]:
            record("parse_ordinal", {"raw": raw}, lambda raw=raw: revise_scope._parse_ordinal(raw))
        record("scoped_instruction", {"case": "no-report-broad"}, lambda: revise_scope.scoped_revise_instruction(
            "全文重写", None, {"narrow": False}))
        record("scoped_instruction", {"case": "broad-unfiltered"}, lambda: revise_scope.scoped_revise_instruction(
            "全文重写", REPORT, revise_scope.resolve_revise_scope(REPORT, {"instruction": "全文重写"})))
        drift_cases = [("", "新内容"), ("a\n\nb\nc\n", "a\nb\nc"), ("一\n二\n三\n四", "一\n贰\n叁\n四"),
                       ("“你好”\n他说。", '"你好"\n他说。'), ("一\n二", "一\n二\n三\n四\n五\n六\n七"),
                       ("a\nb\nc\nd", "x\ny\nz\nw"), ("a\nb\na\nb\nc", "b\na\nc\nb\na"),
                       ("1\n2\n3\n4\n5\n6\n7\n8", "一\n二\n三\n四\n五\n6\n7\n8"), ("1\n2\n3", "一\n二\n3")]
        for before, after in drift_cases:
            for narrow in (True, False):
                record("drift", {"before": before, "after": after, "narrow": narrow}, lambda before=before, after=after, narrow=narrow: {
                    "counts": revise_scope._revise_drift_counts(before, after),
                    "ratio": revise_scope._revise_drift_ratio(before, after),
                    "warning": revise_scope.scope_warning({"narrow": narrow}, before, after)})
        issue = {"id": "p-1", "category": "plot", "severity": "high", "message": "m", "evidence": "证" * 400}
        for blocks, issues, actions in [(["指令"], [], []), (["指令"], [], ["建议"]), (["指令"], [issue] * 3, ["建议"]),
                                        (["长" * 3990], [issue], []), (["长" * 3700], [issue] * 4, []), (["x" * 4001], [], []),
                                        (["指令"], [{"agent": "a"}, {"suggested_action": "做"}], [])]:
            record("compose", {"blocks": blocks, "issues": issues, "actions": actions},
                   lambda blocks=blocks, issues=issues, actions=actions: revise_delivery.compose_scoped_instruction(blocks, issues, actions))
        fitted = {**issue, "evidence": "证" * (320 - len(" 证据："))}
        header = len(revise_delivery.compose_scoped_instruction([""], [{**issue, "evidence": ""}], []))
        for quote_budget in (13, 14):
            blocks = ["长" * (revise_delivery.INSTRUCTION_BUDGET - quote_budget - header)]
            record("compose", {"blocks": blocks, "issues": [issue], "actions": []},
                   lambda blocks=blocks: revise_delivery.compose_scoped_instruction(blocks, [issue], []))
        record("compose", {"blocks": ["指令"], "issues": [fitted], "actions": []},
               lambda: revise_delivery.compose_scoped_instruction(["指令"], [fitted], []))

        chapters = [{"name": " 第1章 ", "content": "  林舟出场。" + "雨" * 4100 + "   "}, {"name": None, "content": "第二章"}, {"content": ""}]
        for focus in (None, "  ", " 时间线 "):
            record("cross_prompt", {"chapters": chapters, "focus": focus},
                   lambda focus=focus: ccc._build_user_prompt(chapters, focus))
        for raw in ['[{"type":"TIMELINE","severity":"High","chapters":["第1章", 2, 1.0, true, null, " "],"finding":"冲突","evidence":"证据"}]',
                    '```\n[{"type":5,"severity":null,"chapters":"x"},{"type":"naming"},3]\n```', "[]", "{}", "  ", "bad",
                    "[" + ",".join('{"type":"other"}' for _ in range(14)) + "]",
                    '[{"finding":"' + "很长" * 200 + '","evidence":"' + "证 " * 200 + '"}]']:
            record("cross_parse", {"raw": raw}, lambda raw=raw: ccc._parse_findings(raw))

        p = Project(run, "cross", {
            "正文/第001章.md": "林舟左臂受伤。", "正文/第002章.md": "林舟用左手拔剑。\n", "正文/第003章.md": "  \n",
            "大纲/总纲.md": "大纲内容。", "正文/第004章.md": "长" * 4100,
            "正文/第005章.md": " " + "雨" * 4000 + "\n",
        })

        def review(paths, replies, focus=None):
            fake, calls = scripted(replies)
            ccc._call_llm = fake

            def execute():
                output = cross_chapter.cross_chapter_review(str(p.root), paths, focus=focus,
                                                            llm_env={"STORYFORGE_LLM_MODEL": " cross-model "})
                return {"output": output, "calls": calls}
            return execute

        sha = hashlib.sha256("林舟左臂受伤。".encode()).hexdigest()
        absolute = str(p.root / "正文" / "第001章.md")
        synthetic_absolute = r"D:\synthetic-book\正文\第001章.md" if os.name == "nt" else "/tmp/synthetic-book/正文/第001章.md"
        for report, file_path, rooted in [
            (None, "正文/第001章.md", True), ({"file_path": "x.md"}, "正文/第001章.md", True),
            ({"content_sha256": sha, "file_path": 5}, "正文/第001章.md", True),
            ({"content_sha256": sha, "file_path": "正文/第001章.md"}, "正文/第001章.md", True),
            ({"content_sha256": "0" * 64, "file_path": "正文/第001章.md"}, "正文/第001章.md", True),
            ({"content_sha256": sha, "file_path": "正文/./第001章.md"}, "正文/../正文/第001章.md", True),
            ({"content_sha256": sha, "file_path": absolute}, "正文/第001章.md", True),
            ({"content_sha256": sha, "file_path": "正文/第002章.md"}, "正文/第001章.md", True),
            ({"content_sha256": sha, "file_path": "../outside.md"}, "../outside.md", True),
            ({"content_sha256": sha, "file_path": "正文/第001章.md"}, "正文/第001章.md", False),
            ({"content_sha256": sha, "file_path": "正文/第002章.md"}, "正文/第001章.md", False),
        ]:
            shown = {**report, "file_path": synthetic_absolute} if report and report.get("file_path") == absolute else report
            p.call("verify_review_source", {"report": shown, "file_path": file_path, "rooted": rooted},
                   lambda report=report, file_path=file_path, rooted=rooted: revise_delivery.verify_review_source(
                       report, file_path, "林舟左臂受伤。", str(p.root) if rooted else None),
                   errors=(AgentOrchestrationError,))

        reply = {"content": '[{"type":"setting","severity":"high","chapters":["第1章","第2章"],"finding":"左右手矛盾","evidence":"左臂受伤/左手拔剑"}]'}
        for paths, replies, focus in [
            (["正文/第002章.md", "正文/第001章.md", "正文/第001章.md", " ", 5], [reply], " 伤势 "),
            (["大纲/总纲.md", "正文/第004章.md"], [reply], None),
            (["正文/第001章.md"], [reply], None), ("正文/第001章.md", [reply], None),
            (["正文/第005章.md", "正文/第001章.md"], [reply], " 时间线 "),
            ([f"正文/第00{i}章.md" for i in range(1, 8)], [reply], None),
            (["正文/第001章.md", "正文/第003章.md"], [reply], None), (["正文/第001章.md", "正文/缺失.md"], [reply], None),
            (["正文/第001章.md", "正文/第002章.md"], [LLMConfigError("未配置 key")], None),
            (["正文/第001章.md", "正文/第002章.md"], [LLMError("超时")], None),
            (["正文/第001章.md", "正文/第002章.md"], [{"content": "   "}], None),
        ]:
            p.call("cross_chapter_review", {"paths": paths, "focus": focus, "model": " cross-model ", "replies": [encode(reply) for reply in replies]},
                   review(paths, replies, focus), errors=(FsToolError, ValueError))

        return {
            "format_version": 1,
            "suite": "p1-review",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book",
            "report": REPORT,
            "llm_replies": LLM_REPLIES,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [p.record("cross")],
            "pure": pure,
        }
