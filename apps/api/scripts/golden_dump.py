"""Export synthetic migration oracles by executing the current Python functions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory


def p0_snapshot() -> dict:
    # This short-lived exporter has no provider/config inputs or Pydantic plugins.
    for name in list(os.environ):
        if name.startswith(("STORYFORGE_", "OPENAI_", "ANTHROPIC_", "GEMINI_")):
            os.environ.pop(name)
    os.environ["PYDANTIC_DISABLE_PLUGINS"] = "__all__"
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from app.common.manuscript import is_manuscript_path, iter_manuscript_files
    from app.domains.agent_runs.book_context import (
        BookContext,
        ChapterEntry,
        RosterEntity,
        SkeletonFile,
        render_book_context_block,
    )
    from app.domains.agent_runs.prose_pattern_rules import check_paragraph_patterns

    platform = "windows" if os.name == "nt" else "posix"
    membership_paths = [
        "", "灵感.md", "正文/灵感.md", "第01章.md", "大纲/总纲.md", "OUTLINE/a.md",
        "正文\\卷一\\第01章.md", "资料/素材.md", "chapters/1.md", "正文/.hidden/a.md",
    ]
    manifests = [
        ("empty", []),
        ("membership", [
            "第01章.md", "灵感.md", "正文/灵感.md", "大纲/总纲.md", "人物/主角.md",
            "设定/规则.md", "OUTLINE/a.md", "资料/素材.md", "knowledge/facts.md",
            ".storyforge/canon.md", "正文/.hidden/a.md", "正文/a.txt", "正文/第02章.MD",
            "正文/.draft.md", "draft/3.md", "manuscript/4.md", "chapters/5.md",
        ]),
        ("unicode-order", [
            "正文/𠀀.md", "正文/\ue000.md", "正文/😀.md", "正文/é.md", "正文/é.md",
            "正文/A2.md", "正文/a1.md", "正文/b.md", "正文/第10章.md", "正文/第2章.md",
            "正文/A/第01章.md", "正文/A0.md",
        ]),
    ]
    manuscript = []
    for name, paths in manifests:
        with TemporaryDirectory(prefix="storyforge-golden-") as temporary:
            root = Path(temporary)
            entries = [{"relative_path": path, "is_directory": False} for path in paths]
            for entry in entries:
                path = root / entry["relative_path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes("第一段\r\n第二段\n".encode())
            (root / "正文/目录.md").mkdir(parents=True)
            entries.append({"relative_path": "正文/目录.md", "is_directory": True})
            output = [path.relative_to(root).as_posix() for path in iter_manuscript_files(root)]
            manuscript.append({"id": name, "entries": entries, "output": output})

    contexts = [("empty", BookContext()), ("empty-open-note", BookContext(current_relative_path="大纲/a.md"))]
    counts = [0, 1, 999, 1000, 1250, 1350, 2250, 2350, 9999, 10_000, 12_500, 22_500, 999_999]
    for count in counts:
        contexts.append((f"size-{count}", BookContext(
            chapters=[ChapterEntry(1, "正文/第01章.md", count * 3)],
            current_relative_path="正文/第01章.md", current_ordinal=1,
        )))
    contexts.extend([
        ("sum-before-floor", BookContext(chapters=[ChapterEntry(1, "a.md", 2), ChapterEntry(2, "b.md", 2)])),
        ("null-path-with-ordinal", BookContext(chapters=[ChapterEntry(1, "a.md", 30)], current_ordinal=1)),
        ("open-non-manuscript", BookContext(chapters=[ChapterEntry(1, "a.md", 30)], current_relative_path="人物/主角.md")),
        ("skeleton-over-limit", BookContext(
            skeleton=[SkeletonFile(f"大纲/第{i}卷.md", i * 1250, "outline") for i in range(1, 14)],
            skeleton_total=18,
        )),
        ("roster-branches", BookContext(roster=[
            RosterEntity("林舟", ["阿舟", "舟哥", "船主", "第四别名"], 1, 1),
            RosterEntity("沈禾", [], 2, 9), RosterEntity("巡夜人", [], 1, 5, True),
            RosterEntity("铜钟", [], None, 5), RosterEntity("旧钥匙", [], 2, None),
            RosterEntity("门锁", []),
        ], roster_declared_total=23)),
    ])
    for tail in ["", "上一章收尾。", "第一段\n第二段\n", "第一段\r\n第二段\r\n", "𠀀😀\r结束\n\n"]:
        contexts.append((f"previous-{len(contexts)}", BookContext(previous_chapter=("正文/前章.md", tail))))
    book_context = [{"id": name, "input": asdict(context), "output": render_book_context_block(context)}
                    for name, context in contexts]

    question = "他真的能回来吗？\n难道门后有人？\n谁也没想到，门锁换了。"
    transition = ["与此同时，顾迟越过断桥。", "另一边，沈禾推开仓门。", "镜头一转，巡夜人抵达钟楼。"]
    contrast = ["这不是退让，而是换路。", "与其说他在等，不如说他在计算。", "表面上仓库废弃，实际上炉火未熄。"]
    corpora = [
        ("empty", ""), ("clean", "他推开门，握紧刀，转身，看向巷口，又停下。"),
        ("transitions", "\n".join(transition + ["雨水顺着铁门落下。"] * 5)),
        ("quarter-density", "\n".join(transition + ["雨水顺着铁门落下。"] * 9)),
        ("percentage-half-even", "\n".join(transition + transition[:2] + ["雨水落下。"] * 3)),
        ("questions", question), ("diluted-questions", question + "\n" + "石墙" * 800),
        ("dialogue", '“你要去吗？”\n「难道现在就走？」\n"到底是谁呢？"\n“一切才刚刚开始。”'),
        ("contrasts", "\n".join(contrast)),
        ("contrast-sentence-boundary", "\n".join(contrast[:2] + ["这不是谎言。守卫沉默，而是转身。"])),
        ("summaries", "雨停了，一切才刚刚开始。\n他们离开广场，这一切都将改变未来。\n未来尚未揭晓！"),
        ("all-four", "\n".join(transition + [question] + contrast + ["雨停了，一切才刚刚开始。"])),
        ("python-whitespace", "\u001c" + question.replace("\n", "\r\n\u0085") + "\u001f"),
        ("bom-not-whitespace", "\ufeff" + "\n".join(transition) + "\ufeff"),
        ("supplementary-slices", "\n".join(["不是" + "𠀀" * 35 + "而是" + "😀" * 35] * 3)),
        ("question-patterns", "莫非钟楼无人？\n他真的会离开么?」\n门锁已经换过？不，钥匙还在。"),
        ("markers", "没人料到，井底有门。\n真正的答案尚未揭晓。\n谁也没想到，雨停了。"),
        ("remaining-contrasts", "看似仓门锁紧，实则窗后无人。\n并非他忘了，反倒记得更清楚。\n不是借口而是事实。"),
    ]
    visible_question_chars = sum(not char.isspace() for char in question)
    corpora.append(("question-density-boundary", question + "\n" + "x" * (1500 - visible_question_chars)))
    paragraph_patterns = [{"id": name, "input": prose,
                           "output": [issue.as_report_item() for issue in check_paragraph_patterns(prose)]}
                          for name, prose in corpora]

    # Compact descriptors reproduce exact 1 MiB corpora without committing megabytes of text.
    cpu = []
    for name, block in [
        ("clean", "他推开门，握紧刀，转身，看向巷口，又停下。\n"),
        ("mixed", "\n".join(transition + [question] + contrast + ["未来尚未揭晓！", "𠀀😀\n"])),
        ("long-paragraph", "雨水映出𠀀😀，他没有回答。"),
    ]:
        block_bytes = len(block.encode())
        repetitions, padding = divmod(1_048_576, block_bytes)
        prose = block * repetitions + "x" * padding
        cpu.append({
            "id": name, "block": block, "repetitions": repetitions, "padding": padding,
            "bytes": len(prose.encode()), "codepoints": len(prose),
            "sha256": hashlib.sha256(prose.encode()).hexdigest(),
            "output": [issue.as_report_item() for issue in check_paragraph_patterns(prose)],
        })

    values = [0.0, -0.0, 1.25, 1.35, 2.25, 2.35, 2.675, 37.5, 62.5, 1e20, 1e-10, -1.25]
    rng = random.Random(20261011)
    values.extend(rng.randrange(-1_000_000, 1_000_001) / 1000 for _ in range(80))
    fixed = [{"value": value, "digits": digits, "output": format(value, f".{digits}f")}
             for value in values for digits in [0, 1, 2]]
    source_paths = ["app/common/manuscript.py", "app/common/project_tree.py",
                    "app/domains/agent_runs/book_context.py", "app/domains/agent_runs/prose_pattern_rules.py"]
    api_root = Path(__file__).resolve().parents[1]
    return {
        "format_version": 1, "suite": "p0", "platform": platform,
        "sources": {path: hashlib.sha256((api_root / path).read_bytes()).hexdigest() for path in source_paths},
        "membership": [{"input": path, "output": is_manuscript_path(path)} for path in membership_paths],
        "manuscript": manuscript, "book_context": book_context,
        "paragraph_patterns": paragraph_patterns, "fixed": fixed, "cpu": cpu,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["p0", "p1-context", "p1-reader", "p1-punctuation", "p1-canon-gate", "p1-path-match", "p1-canon-chain", "p1-scans", "p1-plans", "p1-knowledge", "p1-style", "p1-review", "p1-breakdown", "p1-commands", "p2-llm-pure", "p2-llm-client", "p2-llm-native", "p2-writing-context", "p2-assistant-pure", "p2-assistant-service", "p3-sdk-runtime", "p3-contracts", "p3-tool-catalog", "p3-tool-handlers", "p3-conversation"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--fixture-root", type=Path, help="Fresh owned fixture directory (p1-reader only)")
    args = parser.parse_args()
    if args.fixture_root is not None and args.suite != "p1-reader":
        parser.error("--fixture-root requires --suite p1-reader")
    if args.suite == "p0":
        snapshot = p0_snapshot()
    elif args.suite == "p1-path-match":
        from golden_path_match import p1_path_match_snapshot

        snapshot = p1_path_match_snapshot()
    elif args.suite == "p3-conversation":
        from golden_conversation import p3_conversation_snapshot

        snapshot = p3_conversation_snapshot()
    elif args.suite == "p3-tool-handlers":
        from golden_tool_handlers import p3_tool_handlers_snapshot

        snapshot = p3_tool_handlers_snapshot()
    elif args.suite == "p3-tool-catalog":
        from golden_tool_catalog import p3_tool_catalog_snapshot

        snapshot = p3_tool_catalog_snapshot()
    elif args.suite == "p3-contracts":
        from golden_contracts import p3_contracts_snapshot

        snapshot = p3_contracts_snapshot()
    elif args.suite == "p3-sdk-runtime":
        from golden_sdk_runtime import p3_sdk_runtime_snapshot

        snapshot = p3_sdk_runtime_snapshot()
    elif args.suite == "p2-assistant-service":
        from golden_assistant_service import p2_assistant_service_snapshot

        snapshot = p2_assistant_service_snapshot()
    elif args.suite == "p2-assistant-pure":
        from golden_assistant_pure import p2_assistant_pure_snapshot

        snapshot = p2_assistant_pure_snapshot()
    elif args.suite == "p2-writing-context":
        from golden_writing_context import p2_writing_context_snapshot

        snapshot = p2_writing_context_snapshot()
    elif args.suite == "p2-llm-native":
        from golden_llm_native import p2_llm_native_snapshot

        snapshot = p2_llm_native_snapshot()
    elif args.suite == "p2-llm-client":
        from golden_llm_client import p2_llm_client_snapshot

        snapshot = p2_llm_client_snapshot()
    elif args.suite == "p2-llm-pure":
        from golden_llm_pure import p1_llm_pure_snapshot

        snapshot = p1_llm_pure_snapshot()
    elif args.suite == "p1-commands":
        from golden_commands import p1_commands_snapshot

        snapshot = p1_commands_snapshot()
    elif args.suite == "p1-breakdown":
        from golden_breakdown import p1_breakdown_snapshot

        snapshot = p1_breakdown_snapshot()
    elif args.suite == "p1-review":
        from golden_review import p1_review_snapshot

        snapshot = p1_review_snapshot()
    elif args.suite == "p1-style":
        from golden_style import p1_style_snapshot

        snapshot = p1_style_snapshot()
    elif args.suite == "p1-knowledge":
        from golden_knowledge import p1_knowledge_snapshot

        snapshot = p1_knowledge_snapshot()
    elif args.suite == "p1-plans":
        from golden_plans import p1_plans_snapshot

        snapshot = p1_plans_snapshot()
    elif args.suite == "p1-scans":
        from golden_scans import p1_scans_snapshot

        snapshot = p1_scans_snapshot()
    elif args.suite == "p1-canon-chain":
        from golden_canon_chain import p1_canon_chain_snapshot

        snapshot = p1_canon_chain_snapshot()
    elif args.suite == "p1-canon-gate":
        from golden_canon_gate import p1_canon_gate_snapshot

        snapshot = p1_canon_gate_snapshot()
    elif args.suite == "p1-punctuation":
        from golden_punctuation import p1_punctuation_snapshot

        snapshot = p1_punctuation_snapshot()
    elif args.suite == "p1-reader":
        from golden_project_reader import p1_reader_snapshot

        snapshot = p1_reader_snapshot(args.fixture_root)
    else:
        from golden_book_context import p1_context_snapshot

        snapshot = p1_context_snapshot()
    content = (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="backslashreplace")
    if args.check:
        if args.output.read_bytes() != content:
            raise SystemExit(f"Golden snapshot differs: {args.output}")
        print(f"Golden snapshot verified: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(content)
        print(f"Golden snapshot exported: {args.output}")


if __name__ == "__main__":
    main()
