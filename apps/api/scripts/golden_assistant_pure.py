"""Real assistant pure-layer oracle: continuation windows / prompt / post-processing, revision prompt,
expansion authorization and revise_text with a scripted generator, draft / chat prompts, and the
polish candidate gate with its fact guards (synthetic inputs only, no model or file access)."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict

from golden_fs import isolated_fs_oracle

SOURCES = [
    "app/domains/agent_runs/patches/polish_fact_guards.py",
    "app/domains/agent_runs/patches/polishing.py",
    "app/domains/assistant/continuation.py",
    "app/domains/assistant/revision.py",
    "app/domains/assistant/service.py",
]

CONTENTS = [
    "",
    "第一段。",
    "第一段。\n\n第二段。\n\n\n",
    "第一段\r\n\r\n第二段\r\n第三段",
    "老式\r换行\r结尾",
    "开头。\n" + "雨夜里他推开门，" * 60 + "\n\n" + "钟声响了。" * 30 + "\n\n最后一句。",
    "𠀀" * 50 + "\n\n" + "增补平面" * 10,
    "\n\n  \n\n",
]
CURSORS = [0, 1, 2, 3, 5, 99, -1]
INSTRUCTIONS = [
    "扩写这一段", "不要扩写", "别扩写，保持原样", "不要立刻展开", "不必再细化了", "不再展开", "不继续补充",
    "不需要再继续进一步丰富", "不但要展开，还要细化", "别怕，展开写", "特别展开一点", "分别补充两句",
    "先别急，等会儿再展开", "请把这段加长", "这里不要立刻马上就地展开描写", "改错字<<<ANCHOR\n他展开地图\nANCHOR>>>",
    "<<<ANCHOR\n被截断的锚定块里有展开", "精简一下", "", "𠀀展开", "不𠀀展开", "无需展开但要补充细节",
    "<<<ANCHORX 展开 ANCHOR>>>", "<<<ANCHOR中 展开 ANCHOR>>>扩写", "不过展开吧",
]
GENERATED = [
    ("他推开门，雨声更大了。他走进去。", "雨声更大了。他走进去，看见灯。"),
    ("短", "完全不同的开头。"),
    ("这一句会被模型原样复述出来", "这一句会被模型原样复述出来，然后往下写。"),
    ("尾巴有空格   ", "尾巴有空格往下写"),
    ("", "从头写起。"),
    ("x", ""),
    ("上文", "  只写了半句没有句号"),
    ("上文", "第一句。第二句写了一半"),
    ("上文", "很长很长很长很长很长很长的半句。短"),
    ("上文", "引号里收尾”"),
    ("上文", "😀😀😀。😀😀"),
    ("上文。八个字的一句话呀", "八个字的一句话呀然后继续。"),
    ("上文", "末尾有空格的半句   "),
]
MARKDOWN = [
    "",
    "正文一段。\n正文二段。",
    "---\ntitle: 章\n---\n# 第一章\n\n他推开门。\n\n## 小节\n\n```\n代码\n```\n正文。\n",
    "---\n没有结束的 frontmatter\n正文",
    "  ...\n不是 frontmatter",
    "   # 标题\n正文\n#不是标题\n",
    "````js\n```\n内层\n````\n后文",
    "~~~\n未闭合围栏\n正文",
    "第一行\r\n# 标题\r\n第二行\u2028第三行\x1c第四行",
    "以下是润色后的版本：\n\n他推开门。。。他说：“好！！！”？？？...\n....不变",
    "\n润色结果：\n他走了，，，",
]
POLISH_CASES = [
    ("他推开门。", "他推开了门。", {}),
    ("他推开门。" * 10, "他推开门。" * 13, {}),
    ("他推开门。" * 10, "", {}),
    ("# 标题\n他推开门。", "# 新标题\n他推开门。", {}),
    ("他推开门。", "他推开门。", {"response_truncated": True}),
    ("我推开门，我看见我的影子。我走了。", "他推开门，他看见他的影子。他走了。", {}),
    ("我推开门，我看见我的影子。我走了。", "他推开门，他看见他的影子。他走了。", {"instruction": "改成第三人称"}),
    ("我推开门，他看见我。", "他推开门，我看见他。", {}),
    ("林舟推开门。林舟说话。", "林州推开门。林舟说话。", {"entities": ["林舟", " ", 5, "林舟"]}),
    ("林舟推开门。", "林舟推开门。林舟又来了。", {"entities": ["林舟"]}),
    ("钥匙在林岚手中，她笑了。", "钥匙不在林岚手中，她笑了。", {"facts": ["钥匙在林岚手中"]}),
    ("钥匙在林岚手中，她笑了。", "钥匙并未在林岚手中。", {"facts": [{"statement": "钥匙在林岚手中。院里没有人"}, 5]}),
    ("林舟把钥匙交给林岚。", "林岚把钥匙交给林舟。", {"entities": ["林舟", "林岚"]}),
    ("林舟把钥匙交给林岚。", "林舟没有把钥匙交给林岚。", {"entities": ["林舟", "林岚"]}),
    ("林舟把钥匙交给林岚，林岚把钥匙交给林舟。", "林舟把钥匙交给林岚，林岚把钥匙交给林舟。", {"entities": ["林舟", "林岚"]}),
    ("他推开门。", "他不禁五味杂陈地推开门。值得注意的是门开了。", {}),
    ("他走。他看。他说。", "他走。他走。他走。他走。他走。", {}),
    ("他推开门。", "他推开门，仿佛命运的齿轮开始转动。", {"constraints": [{"forbidden_traits": ["推开"]}]}),
    ("他推开门。", "他推开门。门外有人。", {"required": ["门外有人"]}),
    ("「保留这句」他说。", "「改掉这句」他说。", {"instruction": "保留「保留这句」逐字不变"}),
    ("他问？？", "他问？", {"instruction": "保留重复的问号"}),
    ("他推开门。" * 3, "他推开门。" * 10, {"max_ratio": "inf"}),
    ("---\na: 1\n---\n正文。", "---\na: 2\n---\n正文。", {}),
    ("我推开门，他看见我。他走了。我也走了。", "我推开门，他看见我。他走了。我也走了。", {}),
    ("他不禁推开门。", "他不禁心中一震推开门。", {}),
    ("他走了。你来了。我说了。", "他走了。他走开。你来了。你来过。我说了。我说过。", {"max_ratio": "inf"}),
    ("他不在家。", "他不没有在家。", {"facts": ["他不在家"]}),
    ("他推开门。", "  \n ", {}),
]


def p2_assistant_pure_snapshot() -> dict:
    with isolated_fs_oracle("assistant-pure-oracle-") as (api, run):
        from app.common.author_edit_policy import AuthorEditPolicyError, build_author_edit_policy
        from app.domains.agent_runs.patches import polish_fact_guards as guards
        from app.domains.agent_runs.patches import polishing
        from app.domains.assistant import continuation, revision
        from app.domains.assistant import service as assistant_service
        from app.domains.assistant.schemas import AssistantContextBundle, AssistantDraftRequest

        pure = []

        def record(fn, args, run_fn, errors=(AuthorEditPolicyError, ValueError)):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except revision.RevisionQualityRejected as error:
                row["error"] = {"type": "RevisionQualityRejected", "message": str(error),
                                "gate": gate_dict(error.gate)}
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            pure.append(row)

        def gate_dict(gate):
            return None if gate is None else {"passed": gate.passed, "reasons": list(gate.reasons), "metrics": gate.metrics,
                                              "gate_version": gate.gate_version, "advisories": list(gate.advisories)}

        record("constants", {}, lambda: {
            "continue_system": continuation.CONTINUE_SYSTEM_PROMPT,
            "revision_system": revision.REVISION_SYSTEM_PROMPT,
            "draft_system": assistant_service._DRAFT_SYSTEM_PROMPT,
            "chat_system": assistant_service._CHAT_SYSTEM_PROMPT,
            "limits": [continuation.TAIL_MAX_CHARS, continuation.SUFFIX_MAX_CHARS, continuation.DEFAULT_TARGET_CHARS],
        })
        for message, block in [("下一章怎么写？", ""), ("林舟会游泳吗", "### 人物/林舟.md\n林舟会游泳。")]:
            record("chat_prompt", {"message": message, "block": block},
                   lambda message=message, block=block: assistant_service._build_chat_prompt(message, block))

        bundle = {"project_root": "D:\\book", "current_file": "正文/第003章.md", "files": [
            {"path": "人物/林舟.md", "relative_path": "人物/林舟.md", "kind": "character", "title": "林舟", "excerpt": "林舟会游泳。"},
            {"path": "设定/钟楼.md", "relative_path": "设定/钟楼.md", "kind": "setting", "title": "钟楼", "excerpt": "钟楼在城北。\n子时响。"}]}
        for draft in [
            {"file_path": "正文/第003章.md", "instruction": "写第三章"},
            {"file_path": "正文/第003章.md", "instruction": "写第三章", "project_name": "末世", "context_bundle": bundle},
            {"file_path": "正文/第003章.md", "instruction": "写", "context_bundle": {**bundle, "files": []}},
        ]:
            for constraints, previous in [(None, None), ("【场景约束】\n- 林舟不能死", ["正文/第002章.md", "他回头。"])]:
                record("draft_prompt", {"payload": draft, "constraints": constraints, "previous": previous},
                       lambda draft=draft, constraints=constraints, previous=previous: assistant_service._build_draft_prompt(
                           AssistantDraftRequest(**draft), constraints, tuple(previous) if previous else None))

        for content in CONTENTS:
            for cursor in CURSORS:
                record("windows", {"content": content, "cursor": cursor}, lambda content=content, cursor=cursor: {
                    "tail": continuation.manuscript_tail(content, cursor),
                    "tail_small": continuation.manuscript_tail(content, cursor, max_chars=20),
                    "suffix": continuation.manuscript_suffix(content, cursor),
                    "anchor": continuation.resolve_anchor_line(content, cursor),
                    "insert": continuation.insert_at_anchor(content, cursor, "\n新的一段。\n"),
                })
        for options in [
            {"tail": "", "file_path": "正文/a.md"},
            {"tail": "", "file_path": "正文/a.md", "previous_chapter": ["正文/0.md", "上一章结尾。"]},
            {"tail": "上文。", "file_path": "正文/a.md", "suffix": "后文。", "instruction": "写得紧张些",
             "scene_constraints": "【约束】林舟不能死", "target_chars": 120, "context_bundle": bundle},
            {"tail": "上文。", "file_path": "正文/a.md", "suffix": "长后文" * 1100, "previous_chapter": ["正文/0.md", "尾"],
             "context_bundle": {**bundle, "files": []}},
            {"tail": "上文。", "file_path": "正文/a.md", "suffix": "x" * 3000},
        ]:
            def run_prompt(options=options):
                kwargs = dict(options)
                if "context_bundle" in kwargs:
                    kwargs["context_bundle"] = AssistantContextBundle(**kwargs["context_bundle"])
                if "previous_chapter" in kwargs:
                    kwargs["previous_chapter"] = tuple(kwargs["previous_chapter"])
                return continuation.build_continue_prompt(**kwargs)
            record("continue_prompt", options, run_prompt)
        for tail, generated in GENERATED:
            record("post_process", {"tail": tail, "generated": generated}, lambda tail=tail, generated=generated: {
                "strip": continuation.strip_repeated_prefix(tail, generated),
                "trim": continuation.trim_to_sentence_end(generated),
                "finalize": continuation.finalize_continuation(tail, generated),
            })
        for instruction in INSTRUCTIONS:
            record("expansion", {"instruction": instruction},
                   lambda instruction=instruction: revision.instruction_authorizes_expansion(instruction))

        context_files = (revision.RevisionContextFile("人物/林舟.md", "character", "林舟会游泳。"),
                         revision.RevisionContextFile("设定/钟楼.md", "setting", "钟楼在城北。"))
        for request in [
            {"file_path": "正文/a.md", "content": "他推开门。", "instruction": "改紧凑"},
            {"file_path": "正文/a.md", "content": "他推开门。\n“好。”", "instruction": "改紧凑，保留“好。”逐字不变",
             "project_name": "末世", "context": True, "scene_constraints": "【约束】不许死人"},
        ]:
            def run_revision_prompt(request=request):
                return revision.build_revision_prompt(revision.RevisionInput(
                    file_path=request["file_path"], content=request["content"], instruction=request["instruction"],
                    system_prompt="系统", project_name=request.get("project_name"),
                    context_files=context_files if request.get("context") else (),
                    scene_constraints=request.get("scene_constraints")))
            record("revision_prompt", request, run_revision_prompt)

        revise_cases = [
            ("他推开门。他走了。", "改紧凑", None, {"content": "他推开门，走了。", "completion_tokens": 7, "latency_ms": 12,
                                                  "native": {"x": 1}, "token_usage": None}),
            ("他说：“好。”", "改紧凑", None, {"content": "他说：\"好。\"", "prompt_tokens": 0}),
            ("他推开门。" * 10, "扩写这一段", "polish", {"content": "他推开门。" * 30}),
            ("他推开门。" * 10, "不要扩写", "polish", {"content": "他推开门。" * 30}),
            ("他推开门。" * 10, "润色", "polish", {"content": "他推开门。" * 10, "reasoning_leak_stripped": True}),
            ("「保留这句」他说。", "保留「保留这句」逐字不变", None, {"content": "「改掉这句」他说。"}),
            ("他推开门。", "保留「不存在的句子」逐字不变", None, {"content": "x"}),
            ("我推开门，我看见我的影子。我走了。", "润色", "polish", {"content": "他推开门，他看见他的影子。他走了。"}),
            ("他推开门。", "改", None, {"content": 5}),
            ("他推开门，走了。\n她笑了。", "改", None, {"content": "他推开门,走了.\n她笑了。"}),
            ("他说：“好……”\n她笑了。", "改", None, {"content": "他说：\"好...\"\n她哭了。"}),
            ("他推开门。", "改", None, {"content": "x", "policy_from": "别的正文"}),
        ]
        for content, instruction, gate, reply in revise_cases:
            def run_revise(content=content, instruction=instruction, gate=gate, reply=reply):
                calls = []

                def generate(*, system_prompt, user_prompt):
                    calls.append({"system": system_prompt, "user": user_prompt})
                    return reply
                try:
                    result = revision.revise_text(revision.RevisionInput(
                        file_path="正文/a.md", content=content, instruction=instruction, system_prompt="系统提示",
                        quality_gate=gate, edit_policy=build_author_edit_policy(reply["policy_from"])
                        if "policy_from" in reply else None), generate=generate)
                except revision.RevisionQualityRejected as error:
                    # 记录生成器是否被调用：生成前的政策自检与生成后的检查给出同一原因。
                    return {"error": {"type": "RevisionQualityRejected", "message": str(error),
                                      "gate": gate_dict(error.gate)}, "calls": calls}
                return {"after": result.after, "telemetry": dict(result.telemetry),
                        "quality_gate": gate_dict(result.quality_gate), "calls": calls}
            record("revise_text", {"content": content, "instruction": instruction, "gate": gate, "reply": reply}, run_revise)

        def document_dict(document):
            return {"original": document.original, "segments": [asdict(segment) for segment in document.segments]}

        for text in MARKDOWN:
            record("split", {"text": text}, lambda text=text: document_dict(polishing.split_polishable_markdown(text)))
            record("deterministic", {"text": text}, lambda text=text: polishing.apply_deterministic_polish(text))
        spans_text = "「甲」正文「乙」\n# 标题「丙」\n尾巴"
        record("split_spans", {"text": spans_text, "instruction": "保留「甲」和「乙」和「丙」逐字不变"},
               lambda: document_dict(polishing.split_polishable_markdown(
                   spans_text, protected_spans=build_author_edit_policy(
                       spans_text, instruction="保留「甲」和「乙」和「丙」逐字不变").protected_spans)))
        record("deterministic", {"text": "他问？？！！", "instruction": "保留连续问号"},
               lambda: polishing.apply_deterministic_polish("他问？？！！", edit_policy=build_author_edit_policy(
                   "他问？？！！", instruction="保留连续问号")))
        record("rebuild_mismatch", {}, lambda: polishing.rebuild_polishable_markdown(
            polishing.split_polishable_markdown("# 标题\n正文"), ["a", "b"]))

        def evaluate(original, candidate, options):
            policy = build_author_edit_policy(original, instruction=options.get("instruction", ""))
            config = polishing.PolishGateConfig(max_char_ratio=float("inf")) if options.get("max_ratio") else None
            return gate_dict(polishing.evaluate_polish_candidate(
                original, candidate, protected_entities=options.get("entities", ()),
                character_constraints=options.get("constraints", ()), continuity_facts=options.get("facts", ()),
                required_facts=options.get("required", ()), response_truncated=options.get("response_truncated", False),
                config=config, edit_policy=policy))

        for original, candidate, options in POLISH_CASES:
            record("evaluate", {"original": original, "candidate": candidate, "options": options},
                   lambda original=original, candidate=candidate, options=options: evaluate(original, candidate, options))
        for name, local, online in [
            ("online-pass", None, {"text": "她推开门。"}),
            ("online-noop", None, {"text": "他推开门。"}),
            ("online-fail-local-pass", {"text": "她推开门。"}, {"text": ""}),
            ("local-only", {"text": "她推开门。"}, None),
            ("local-noop", {"text": "他推开门。"}, {"text": "他推开门。", "response_truncated": True}),
            ("both-fail", {"text": ""}, {"text": "他推开门。" * 9}),
            ("none", None, None),
        ]:
            def run_select(local=local, online=online):
                decision = polishing.select_polish_candidate(
                    "他推开门。",
                    local_candidate=polishing.PolishCandidate("local", local["text"]) if local else None,
                    online_candidate=polishing.PolishCandidate("online", online["text"], online.get("response_truncated", False))
                    if online else None)
                return {"status": decision.status, "selected_source": decision.selected_source, "text": decision.text,
                        "degraded": decision.degraded, "rule_version": decision.rule_version,
                        "evaluations": {key: gate_dict(value) for key, value in decision.evaluations.items()}}
            record("select", {"name": name, "local": local, "online": online}, run_select)
        for original, candidate, entities in [
            ("林舟推开门。\n林岚走了。", "林州推开门。\n林岚走了。", ["林舟", "林岚"]),
            ("林舟推开门。", "林舟推开门。", ["林舟"]),
            ("林舟和林舟。", "林州和林舟。", ["林舟"]),
            ("林舟" + "长" * 4000, "林州" + "长" * 4000, ["林舟"]),
            ("𠀀林舟推开门。", "𠀀林州推开门。", ["林舟"]),
            ("阿青推门", "阿清推门", ["阿青", "青"]),
        ]:
            record("spelling", {"original": original, "candidate": candidate, "entities": entities},
                   lambda original=original, candidate=candidate, entities=entities: list(
                       guards.entity_spelling_changes(original, candidate, entities)))

        return {
            "format_version": 1,
            "suite": "p2-assistant-pure",
            "platform": "windows" if os.name == "nt" else "posix",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "pure": pure,
        }
