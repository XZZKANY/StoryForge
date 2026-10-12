"""Real style / strategy oracle: craft clauses, style fingerprint and baseline, author voice,
author edit policy, generation delivery, role and skill catalogs (synthetic inputs only)."""

from __future__ import annotations

import hashlib
import json
import os

from golden_fs import Project, isolated_fs_oracle

SYNTHETIC_ROOT = r"D:\synthetic-book"
SOURCES = [
    "app/common/author_edit_policy.py",
    "app/common/author_voice.py",
    "app/common/craft.py",
    "app/common/generation_delivery.py",
    "app/common/style_baseline.py",
    "app/common/style_fingerprint.py",
    "app/domains/agent_runs/role_catalog.py",
    "app/domains/agent_runs/skill_catalog.py",
]

ORIGINAL = "他推开门，门外有人。\n“谁？”他问。\n𠀀门后的风？？！！\n'I'm here' 写着 12\" 的尺寸。\n门外有人。"
POLICY_CASES = [
    "", "把引号统一换成中文引号", "不要改引号", "引号保持原样", "把全文引号调整为直引号，但人称不变",
    "保留“他推开门”逐字不变", "逐字保留「门外有人」", "原样保留『𠀀门后的风』", "保留“他推开门”", "保留“不存在的句子”逐字不变",
    "逐字保留“他推开门", "不要逐字保留“他推开门”逐字不变", "请执行以下要求：“把引号换成直引号”", "“改用第三人称”这是我的要求",
    "改为“第一人称”", "改为“第三人称”，但不要改引号", "保留重复问号", "不要保留连续感叹号", "把重复问号合并成一个",
    "保留重复问号，并把重复问号合并成一个", "改成第三人称", "不要改成第一人称", "保持人称", "```\n保留“他推开门”逐字不变\n```改引号",
    "~~~\n改为第一人称\n~~~", "保留'I'm here'逐字不变", "保留\"12\"逐字不变", "示例：“请把引号换成直引号”只是例子",
    "按以下要求执行：“逐字保留“门外有人””", "保留“门外有人”原样", "逐字保留“门外有人”并保留“他推开门”逐字不变",
    "<<<ANCHOR line=1>>>引号全部换掉 ANCHOR>>>改人称为第一人称", "改引号\n\n最小改动约束（必须严格遵守）：保留“x”逐字不变",
    "改引号<<<FILE 未闭合", "‘Don’t touch’ 改引号", "逐字保留“", "保留“他推开门”逐字不变；然后把引号改成直引号",
    "别改", "把句子里的引号改为直引号", "统一人称并且把引号改成「」",
    # Boundaries: a 12-char bridge; blanked supplementary characters inside the bridge;
    # a backslash-escaped quote; an apostrophe inside a quoted English word; negated person change.
    "改这段文字里面所有剩余的那引号", "改这段文字里面所有剩余的那个引号", "改“𠀀𠀀𠀀𠀀𠀀𠀀”的四个字引号",
    '示例："a\\"b" 改引号', "示例：'I'm 改引号 here' 结束", "禁止改为第三人称", "改成第三人称，保持人称",
]
POLICY_ORIGINAL_CASES = [
    ("a12b34c", '保留"12" 并保留"34"逐字不变'),
]


def p1_style_snapshot() -> dict:
    with isolated_fs_oracle("style-oracle-") as (api, run):
        from app.common import author_edit_policy as policy_module
        from app.common import author_voice, craft, generation_delivery, style_baseline, style_fingerprint
        from app.common.generation_sources import GenerationSourceCapture, text_sha256
        from app.domains.agent_runs import role_catalog, skill_catalog

        pure = []

        def record(fn, args, run_fn, errors=(policy_module.AuthorEditPolicyError, KeyError, ValueError)):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            pure.append(row)

        record("craft", {"fn": "craft_prompt_clause"}, craft.craft_prompt_clause)
        record("craft", {"fn": "craft_prompt_clause", "with_examples": True}, lambda: craft.craft_prompt_clause(with_examples=True))
        record("craft", {"fn": "scene_discipline_clause"}, craft.scene_discipline_clause)
        record("craft", {"fn": "scene_discipline_guard_clause"}, craft.scene_discipline_guard_clause)
        for key in ["plot", "character", "prose", "continuity"]:
            record("craft", {"fn": "review_rubric_clause", "key": key}, lambda key=key: craft.review_rubric_clause(key))

        texts = ["", "  \n ", "他推门。她看他！为什么？", "没有句号的一整段", "「你来了。」「嗯。」\r\n他沉默，低声说：这说明一切。",
                 "𠀀😀。克制。意味着！只把灯关了？\r\r读者立刻明白", "。。。！！", "\u3000他走了。\u001c", "「𠀀𠀀𠀀」"]
        for text in texts:
            record("fingerprint", {"text": text}, lambda text=text: {
                "fingerprint": style_fingerprint.style_fingerprint(text).as_payload(),
                "sentences": style_fingerprint.split_sentences(text)})

        # CPython 3.12+ builtin sum() compensates float rounding (Neumaier); style baselines rely on it.
        for values in ([0.1] * 10, [3.667] * 10, [1e16, 1.0, -1e16], [0.1, 0.2, 0.3]):
            record("float_sum", {"values_json": json.dumps(values)}, lambda values=values: repr(sum(values)))

        def policy_dict(policy):
            return {**policy.summary(), "author_requirements": list(policy.author_requirements),
                    "instruction": policy.instruction, "baseline": policy.baseline,
                    "protected_spans": [[span.start, span.end] for span in policy.protected_spans],
                    "prompt": policy_module.author_edit_policy_prompt(policy)}

        for instruction in POLICY_CASES:
            record("policy", {"original": ORIGINAL, "instruction": instruction},
                   lambda instruction=instruction: policy_dict(policy_module.build_author_edit_policy(ORIGINAL, instruction=instruction)))
        record("policy", {"original": ORIGINAL, "instruction": "改引号", "requirements": ["保留重复问号", "保留重复问号", "  ", "逐字保留“门外有人”"], "baseline": "文风基线（x）"},
               lambda: policy_dict(policy_module.build_author_edit_policy(
                   ORIGINAL, instruction="改引号", author_requirements=("保留重复问号", "保留重复问号", "  ", "逐字保留“门外有人”"), baseline="文风基线（x）")))
        for original, instruction in POLICY_ORIGINAL_CASES:
            record("policy", {"original": original, "instruction": instruction},
                   lambda original=original, instruction=instruction: policy_dict(
                       policy_module.build_author_edit_policy(original, instruction=instruction)))
        for levels in (15, 16):
            nested = "按以下：" + "“请执行：" * levels + "逐字保留“门外有人”" + "”" * (levels + 1)
            record("policy", {"original": ORIGINAL, "instruction": nested},
                   lambda nested=nested: policy_dict(policy_module.build_author_edit_policy(ORIGINAL, instruction=nested)))
        record("policy", {"original": "的" * 70, "instruction": "逐字保留“的”"},
               lambda: policy_dict(policy_module.build_author_edit_policy("的" * 70, instruction="逐字保留“的”")))
        record("policy", {"original": ORIGINAL, "instruction": "按以下：" + "“请执行：" * 18 + "逐字保留“门外有人”" + "”" * 19},
               lambda: policy_dict(policy_module.build_author_edit_policy(
                   ORIGINAL, instruction="按以下：" + "“请执行：" * 18 + "逐字保留“门外有人”" + "”" * 19)))
        base_policy = policy_module.build_author_edit_policy(ORIGINAL, instruction="逐字保留“门外有人”。保留重复问号")
        for candidate in [ORIGINAL, ORIGINAL.replace("他推开门", "他关上门"), ORIGINAL.replace("门外有人", "门外无人", 1),
                          ORIGINAL + "门外有人", ORIGINAL.replace("？？！！", "？！"), "门外有人。门外有人。"]:
            record("failures", {"original": ORIGINAL, "candidate": candidate, "instruction": "逐字保留“门外有人”。保留重复问号"},
                   lambda candidate=candidate: list(policy_module.author_edit_policy_failures(ORIGINAL, candidate, base_policy)))
        record("failures", {"original": ORIGINAL + "x", "candidate": ORIGINAL, "instruction": "逐字保留“门外有人”。保留重复问号"},
               lambda: list(policy_module.author_edit_policy_failures(ORIGINAL + "x", ORIGINAL, base_policy)))

        for prompt in ["无作者部分", "基础\n\n文风基线（量自）：x" + "\n\n" + author_voice.GENERATION_PREFIX + "逐字保留“门外有人”",
                       "基础" + "\n\n" + author_voice.GENERATION_PREFIX + "改引号"]:
            for admitted in [(), ("保留重复问号",)]:
                record("edit_policy_from_prompt", {"system_prompt": prompt, "admitted": list(admitted), "original": ORIGINAL},
                       lambda prompt=prompt, admitted=admitted: policy_dict(author_voice.edit_policy_from_generation_prompt(
                           ORIGINAL, instruction="改为第一人称", system_prompt=prompt, admitted_author_requirements=admitted)))

        manifest = {"version": "generation-sources-v1", "delivery_boundary": "writer_provider_seam",
                    "project_identity_sha256": "abc", "request": {"system_sha256": "s", "user_sha256": "u"}, "extra": "中文"}
        record("delivery", {"id": 7, "manifest": manifest}, lambda: generation_delivery.generation_delivery_reference(7, manifest).as_dict())

        def delivery_bind():
            seen = []
            capture = generation_delivery.GenerationDeliveryCapture(on_record=seen.append)
            before = capture.bind({"a": 1, "generation_delivery_refs": ["forged"]})
            capture.record(3, manifest)
            capture.record(4, {**manifest, "version": "v2"})
            return {"before": before, "after": capture.bind({"generation_delivery_refs": ["forged"], "b": 2}), "seen": seen}

        record("delivery_bind", {}, delivery_bind)
        record("roles", {}, lambda: [role.model_dump() for role in role_catalog.list_agent_roles()])
        record("roles", {"fn": "subagents"}, lambda: [role.name for role in role_catalog.list_subagent_roles()])
        for args in [{}, {"agent_role_hints": ["plot_reviewer", " @剧情 ", "root_agent", "nobody", 5, "plot_reviewer"],
                          "agent_role_mentions": ["@伏笔", "@设定", "@root", "  ", "@伏笔"]}, {"agent_role_hints": "x"}]:
            record("normalize_roles", args, lambda args=args: role_catalog.normalize_agent_role_inputs(args).__dict__)
        for role, tool in [("plot_reviewer", "file.review"), ("plot_reviewer", "file.revise"), ("nobody", "x"), (" root_agent ", "file.create")]:
            record("role_tool", {"role": role, "tool": tool}, lambda role=role, tool=tool: role_catalog.is_role_allowed_tool(role, tool))
        for alias in ["@剧情", "repair_agent", "  ", "@无"]:
            record("role_alias", {"alias": alias}, lambda alias=alias: (lambda r: r.model_dump() if r else None)(role_catalog.resolve_agent_role_alias(alias)))
        record("skills", {}, lambda: [skill.model_dump() for skill in skill_catalog.list_agent_skills()])
        for intent, goal, scope in [("file.revise", "x", None), ("file.review", "看看伏笔", None), ("file.review", "润色", {}),
                                    ("chat.explain", "写个短篇", None), (None, "续写下一章", None), ("chat.explain", "x", {"book_id": 3}),
                                    ("chat.explain", "x", {"book_id": None}), ("chat.explain", "Check CONSISTENCY", None),
                                    (5, "随便", {"agent_role_hints": ["a", " ", 3], "agent_role_mentions": "x"})]:
            record("plan_payload", {"intent": intent, "goal": goal, "scope": scope},
                   lambda intent=intent, goal=goal, scope=scope: skill_catalog.agent_plan_payload(intent=intent, goal=goal, scope=scope, plan=[{"step": "s"}]))

        projects = []

        def project(name, files):
            item = Project(run, name, files)
            projects.append((name, item))
            return item

        def with_capture(p, run_fn):
            capture = GenerationSourceCapture(str(p.root))
            capture.project_identity_sha256 = text_sha256(os.path.normcase(SYNTHETIC_ROOT))
            with capture.collecting():
                value = run_fn()
            return {"value": value, "sources": capture.sources, "selections": capture.selections,
                    "projections": [{"row": row, "text": text} for row, text in capture.projections]}

        def baseline_dict(baseline):
            if baseline is None:
                return None
            return {"file_count": baseline.file_count, "sentence_count": baseline.sentence_count,
                    "average_sentence_length": None if baseline.average_sentence_length is None else baseline.average_sentence_length.__dict__,
                    "dialogue_ratio": None if baseline.dialogue_ratio is None else baseline.dialogue_ratio.__dict__,
                    "clause": style_baseline.style_baseline_clause(baseline)}

        steady = "他推开门。「来了。」她点头。雨落在檐下，一滴一滴。他没有说话，只把灯拨亮。\n" * 12
        variant = "他推开门，看了很久。「你来了，我等了好久。」她说。风从窗缝里挤进来。\n" * 12
        p = project("baseline", {
            "正文/第001章.md": steady, "正文/第002章.md": steady.replace("他推开门", "她推开窗"),
            "正文/第003章.md": steady.replace("一滴一滴", "淅淅沥沥") + "𠀀「𠀀」" * 20, "正文/第004章.md": "太短",
            "正文/第004章b.md": "他推开门。「来了。」" * 20,
            "正文/第005章.md": b"\x00binary" + b"x" * 500, "大纲/总纲.md": steady * 3, "正文/.草稿/a.md": steady,
            "灵感.md": steady, ".storyforge/agent-instructions.md": "少用「仿佛」。\r\n人物说话要短。\n",
        })
        p.call("baseline", {}, lambda: with_capture(p, lambda: baseline_dict(style_baseline.build_style_baseline(str(p.root)))))
        p.call("generation_prompt", {}, lambda: with_capture(p, lambda: author_voice.build_generation_system_prompt("基础提示。", str(p.root))))

        p = project("wide", {"正文/第001章.md": steady, "正文/第002章.md": variant, "正文/第003章.md": ("短句。" * 200 + "\n"),
                             "正文/第004章.md": "「" + "长" * 450 + "」\n"})
        p.call("baseline", {}, lambda: with_capture(p, lambda: baseline_dict(style_baseline.build_style_baseline(str(p.root)))))
        p = project("no-dialogue", {f"正文/第{i:03d}章.md": "他推开门。雨落在檐下。“你好。”她点头。\n" * 30 for i in range(1, 5)})
        p.call("baseline", {}, lambda: with_capture(p, lambda: baseline_dict(style_baseline.build_style_baseline(str(p.root)))))
        # ASCII-heavy chapters: each 200000-byte read decodes to ~200000 chars, so the 800000-char
        # aggregate budget stops after four files.
        p = project("budget", {f"正文/第{i:03d}章.md": (("x" * 40 + "。「嗯」\n") * 4500) for i in range(1, 12)})
        p.call("baseline", {}, lambda: with_capture(p, lambda: baseline_dict(style_baseline.build_style_baseline(str(p.root)))))

        long_instructions = "".join(f"第{i}条：人物说话要短，别用仿佛。\n" for i in range(400))
        for name, files in [("voice-missing", {"正文/a.md": "x"}), ("voice-empty", {".storyforge/agent-instructions.md": " \n "}),
                            ("voice-binary", {".storyforge/agent-instructions.md": b"\x00x"}),
                            ("voice-bad-utf8", {".storyforge/agent-instructions.md": b"\xff\xfe bad"}),
                            ("voice-large", {".storyforge/agent-instructions.md": "x" * (512 * 1024 + 1)}),
                            ("voice-long", {".storyforge/agent-instructions.md": long_instructions}),
                            ("voice-bom", {".storyforge/agent-instructions.md": "\ufeff改用第一人称\r"})]:
            p = project(name, files)
            p.call("author_instructions", {}, lambda p=p: with_capture(p, lambda: author_voice.read_author_instructions(str(p.root))))
            p.call("append_instructions", {}, lambda p=p: with_capture(p, lambda: author_voice.append_author_instructions_to_system_prompt("基础", str(p.root))))
        p.call("author_instructions", {"project": None}, lambda: with_capture(p, lambda: author_voice.read_author_instructions(None)))

        return {
            "format_version": 1,
            "suite": "p1-style",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": SYNTHETIC_ROOT,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [item.record(name) for name, item in projects],
            "pure": pure,
        }
