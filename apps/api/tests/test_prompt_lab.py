"""prompt 对比实验台测试：纯函数、不触网。

真实 LLM 调用不进 pytest（那是人工跑的实验）；conftest 的 autouse fixture 已清空
全部 LLM env（含 STORYFORGE_LLM_CONFIG_FILE），测试天然隔离。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.common.craft import craft_prompt_clause
from app.domains.agent_runs.loop import prompt_context
from app.domains.book_runs.prompts import builder
from scripts.prompt_lab import runner as runner_module
from scripts.prompt_lab.agent_registry import AGENT_VARIANTS
from scripts.prompt_lab.fixtures import MANUAL_DRAFT, OPENING_CTX, TASKS, TRANSITION_CTX
from scripts.prompt_lab.registry import BOOK_VARIANTS
from scripts.prompt_lab.report import render_report

# --- 组 1：fixture 渲染锚串断言 ---


def test_opening_ctx_renders_draft_preview() -> None:
    prompt = builder.build_draft_prompt(OPENING_CTX, preview_chars=120)
    assert "林岚在雾港追查失真的灯塔信号。" in prompt
    assert "禁止表现：突然健谈" in prompt
    assert "禁用表达（绝不能出现）：不禁" in prompt
    assert "左臂受伤未愈（本段必须体现）" in prompt
    # pacing.target_chars=400 优先于 preview_chars，走「篇幅」行（builder 真实行为）
    assert "约 400 个中文字符，允许上下浮动 15%" in prompt
    assert "林岚持有旧港灯塔密钥" in prompt


def test_transition_ctx_renders_full_chapter() -> None:
    prompt = builder.build_draft_prompt(TRANSITION_CTX, full_chapter=True)
    assert "写出本章完整正文（600–1600 字）" in prompt
    assert "上一章林岚在旧港发现灯塔密钥" in prompt
    assert "上文衔接（保持连续，不要重复已写内容）" in prompt


def test_critique_and_revision_render() -> None:
    ctx = TASKS["critique-draft"].ctx
    prompt = builder.build_critique_prompt(ctx, TASKS["critique-draft"].draft)
    assert "评审问题清单" not in prompt
    assert "待审正文" in prompt
    assert "她不禁想起昨夜灯塔的异响" in prompt

    revision = builder.build_revision_prompt(ctx, TASKS["revise-draft"].draft, TASKS["revise-draft"].issues)
    assert "评审问题清单（逐条修复）" in revision
    assert "prose_quality｜medium" in revision


# --- 组 2：baseline 恒等 ---


def test_draft_baseline_identical_to_real_builder() -> None:
    for task_id in ("opening-preview", "transition-full"):
        task = TASKS[task_id]
        variant = BOOK_VARIANTS["draft"]["baseline"]
        assert variant.build(task.ctx, preview_chars=task.preview_chars, full_chapter=task.full_chapter) == builder.build_draft_prompt(
            task.ctx, preview_chars=task.preview_chars, full_chapter=task.full_chapter
        )


def test_critique_and_revision_baseline_identical() -> None:
    ctx = TRANSITION_CTX
    assert BOOK_VARIANTS["critique"]["baseline"].build(ctx, MANUAL_DRAFT) == builder.build_critique_prompt(ctx, MANUAL_DRAFT)
    issues = ("prose_quality｜medium｜命中｜原因｜scene_patch｜保留｜删除｜目标",)
    assert BOOK_VARIANTS["revision"]["baseline"].build(ctx, MANUAL_DRAFT, issues) == builder.build_revision_prompt(
        ctx, MANUAL_DRAFT, issues
    )


def test_agent_baseline_identical_to_real_system_prompt() -> None:
    assert AGENT_VARIANTS["agent-baseline"].build() == prompt_context.SYSTEM_PROMPT


# --- 组 3：变体按文档差异 ---


def test_no_craft_removes_craft_section() -> None:
    prompt = BOOK_VARIANTS["draft"]["no-craft"].build(OPENING_CTX, preview_chars=120)
    baseline = BOOK_VARIANTS["draft"]["baseline"].build(OPENING_CTX, preview_chars=120)
    assert "【创作准则" not in prompt
    assert "【创作准则" in baseline
    assert "保持克制叙述" in prompt  # 其余 section 保留


def test_no_style_removes_style_section() -> None:
    prompt = BOOK_VARIANTS["draft"]["no-style"].build(OPENING_CTX, preview_chars=120)
    baseline = BOOK_VARIANTS["draft"]["baseline"].build(OPENING_CTX, preview_chars=120)
    assert "【文风要求" not in prompt
    assert "【文风要求" in baseline
    assert "【创作准则" in prompt


def test_task_rewrite_replaces_task_line() -> None:
    prompt = BOOK_VARIANTS["draft"]["task-rewrite"].build(OPENING_CTX, preview_chars=120)
    assert "要么推进情节、要么加深人物、要么制造氛围" in prompt
    assert "避免说明腔与大纲腔" not in prompt


def test_critique_no_pass_appends_ban() -> None:
    prompt = BOOK_VARIANTS["critique"]["no-pass"].build(TRANSITION_CTX, MANUAL_DRAFT)
    assert "禁止输出单行“通过”" in prompt
    assert "至少一条 ISSUE" in prompt


def test_agent_no_craft_removes_craft_clause() -> None:
    prompt = AGENT_VARIANTS["agent-no-craft"].build()
    baseline = AGENT_VARIANTS["agent-baseline"].build()
    clause = craft_prompt_clause()
    assert clause in baseline
    assert clause not in prompt
    assert "你是 StoryForge 的中文长篇小说创作 agent" in prompt


# --- 组 4：report.py ---


def _sample_run_data() -> dict[str, object]:
    baseline_prompt = "任务：写正文。\n创作准则：具体呈现。"
    variant_prompt = "任务：写正文。\n"
    return {
        "model": "deepseek-v4-flash",
        "temperature": "0.2",
        "variants": {
            "opening-preview": {
                "task_description": "雾港开场预览",
                "variants": [
                    {"id": "baseline", "label": "原样", "description": "恒等", "prompt": baseline_prompt, "prompt_chars": len(baseline_prompt), "output": "正文甲", "output_chars": 3, "prompt_tokens": 10, "completion_tokens": 5, "latency_ms": 100, "cost_cny_estimated": 0.0001},
                    {"id": "no-craft", "label": "去准则", "description": "量化准则贡献", "prompt": variant_prompt, "prompt_chars": len(variant_prompt), "output": "正文乙", "output_chars": 3, "prompt_tokens": 8, "completion_tokens": 5, "latency_ms": 90, "cost_cny_estimated": 0.00008},
                ],
            }
        },
    }


def test_report_renders_metrics_outputs_and_diff() -> None:
    text = render_report(_sample_run_data(), dry_run=False)
    assert "## 任务 opening-preview" in text
    assert "| A | 原样 |" in text
    assert "| B | 去准则 |" in text
    assert "正文甲" in text
    assert "正文乙" in text
    assert "相对 baseline 的 prompt 差异" in text
    assert "- [ ] 哪版更好？理由：" in text
    assert "0.000100" in text


def test_report_dry_run_marks_no_llm() -> None:
    text = render_report(_sample_run_data(), dry_run=True)
    assert "（dry-run：未调用 LLM）" in text
    assert "dry-run：True" in text


def test_report_blind_does_not_leak_variant_names() -> None:
    text = render_report(_sample_run_data(), dry_run=False, blind_seed=7)
    assert "去准则" not in text
    assert "原样" not in text
    assert "正文甲" in text  # 输出保留


def test_report_blind_is_seed_reproducible() -> None:
    first = render_report(_sample_run_data(), dry_run=False, blind_seed=7)
    second = render_report(_sample_run_data(), dry_run=False, blind_seed=7)
    assert first == second


# --- 组 5/6：runner（dry-run 不触网 + 失败隔离） ---


def test_runner_dry_run_never_calls_llm(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[object] = []

    def fake_call(*args: object, **kwargs: object) -> dict[str, object]:
        calls.append((args, kwargs))
        return {"content": "不应发生", "cost_cny_estimated": 0.0, "latency_ms": 0}

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_messages", fake_call)
    from scripts.prompt_lab.runner import main

    code = main(["--task", "opening-preview", "--variants", "baseline,no-craft", "--dry-run", "--out", str(tmp_path)])
    assert code == 0
    assert calls == []
    assert (tmp_path / "run-metadata.json").exists()
    assert (tmp_path / "report.md").exists()


def test_runner_failure_isolation(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from app.common.llm_client import LLMError

    def fake_call(*args: object, **kwargs: object) -> dict[str, object]:
        raise LLMError("模拟失败")

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_messages", fake_call)
    from scripts.prompt_lab.runner import main

    code = main(["--task", "opening-preview", "--variants", "baseline,no-craft", "--out", str(tmp_path)])
    assert code == 1
    metadata = tmp_path / "run-metadata.json"
    data = __import__("json").loads(metadata.read_text(encoding="utf-8"))
    entries = data["variants"]["opening-preview"]["variants"]
    assert len(entries) == 2
    assert all("error" in entry for entry in entries)


def test_runner_merge_replaces_only_selected_cells(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """--merge 只替换命令行选中的变体格子，该任务其他变体保留旧数据。"""

    import json

    from scripts.prompt_lab.runner import main

    calls = {"n": 0}

    def fake_call(*args: object, **kwargs: object) -> dict[str, object]:
        calls["n"] += 1
        # 第一轮（2 格）返回"旧输出"，第二轮（merge 重跑 1 格）返回"新输出"
        tag = "新输出" if calls["n"] > 2 else "旧输出"
        return {"content": tag, "cost_cny_estimated": 0.0002, "latency_ms": 55}

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_messages", fake_call)

    # 第一次跑：baseline + no-craft（全成功，no-craft 输出"旧输出"）
    code = main(["--task", "opening-preview", "--variants", "baseline,no-craft", "--out", str(tmp_path)])
    assert code == 0
    first = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    first_entries = first["variants"]["opening-preview"]["variants"]
    assert {entry["id"] for entry in first_entries} == {"baseline", "no-craft"}

    # 合并补跑：只重跑 baseline（mock 返回"新输出"），no-craft 必须保留旧数据
    code = main(["--merge", str(tmp_path), "--task", "opening-preview", "--variants", "baseline"])
    assert code == 0
    merged = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in merged["variants"]["opening-preview"]["variants"]}
    assert set(by_id) == {"baseline", "no-craft"}
    assert by_id["baseline"]["output"] == "新输出"
    assert by_id["no-craft"]["output"] == "旧输出"


def test_runner_docstring_examples_use_real_flags() -> None:
    """docstring 用法示例里的每个 --flag 都必须真存在于 parser。

    实证（2026-08-01）：docstring 示例写了不存在的 `--blind`，照抄去跑直接 argparse 报错，
    而且这条假用法已被抄进 CLAUDE.md。文档撒谎比没文档更贵，故钉成断言。
    """

    import re

    from scripts.prompt_lab.runner import build_parser

    known = {
        option
        for action in build_parser()._actions
        for option in action.option_strings
    }
    used = set(re.findall(r"(?<![\w-])--[a-z][a-z-]*", runner_module.__doc__ or ""))
    unknown = sorted(used - known)
    assert not unknown, f"docstring 用法示例引用了不存在的参数：{unknown}（parser 只有 {sorted(known)}）"


def test_relative_out_dir_anchors_at_repo_root(tmp_path: Path) -> None:
    """相对 --out 锚仓根，不跟 cwd 跑偏。

    实证（2026-08-01）：从 `apps/api` 跑 `--out .codex/prompt-lab/wave4`，产物落进
    `apps/api/.codex/`——`.gitignore` 的 `.codex/*` 锚在仓根、覆盖不到那里，证据目录
    就变成未跟踪文件冒进 git status。而 CLAUDE.md 记的正是这条命令。
    """

    from scripts.prompt_lab.runner import _REPO_ROOT, anchor_at_repo_root

    anchored = anchor_at_repo_root(Path(".codex/prompt-lab/waveN"))
    assert anchored == _REPO_ROOT / ".codex" / "prompt-lab" / "waveN"
    assert anchor_at_repo_root(tmp_path) == tmp_path, "绝对路径必须原样放行"
    assert anchor_at_repo_root(None) is None


def test_blind_report_hides_prompt_chars_fingerprint() -> None:
    """盲评版不得泄露 prompt 字符数——那是配置属性，变体间必然不同即等于点名。

    实证（2026-08-01 wave4）：blind.md 的 831 / 740 两行直接对上
    live-with-examples / live-baseline，判读者根本没在盲评。
    """

    run_data = {
        "model": "m",
        "temperature": "0.2",
        "variants": {
            "t1": {
                "task_description": "d",
                "variants": [
                    {"id": "a", "label": "A", "description": "", "prompt": "x", "prompt_chars": 831,
                     "output": "甲", "output_chars": 1, "prompt_tokens": None, "completion_tokens": None,
                     "latency_ms": 1, "cost_cny_estimated": 0.0, "repeats": None},
                    {"id": "b", "label": "B", "description": "", "prompt": "y", "prompt_chars": 740,
                     "output": "乙", "output_chars": 1, "prompt_tokens": None, "completion_tokens": None,
                     "latency_ms": 1, "cost_cny_estimated": 0.0, "repeats": None},
                ],
            }
        },
    }
    blind = render_report(run_data, dry_run=False, blind_seed=42)
    assert "831" not in blind and "740" not in blind, "盲评版泄露了 prompt 字符数指纹"
    assert "prompt字符" not in blind
    # 明标版仍须保留该列，否则对照分析没得看
    plain = render_report(run_data, dry_run=False)
    assert "831" in plain and "prompt字符" in plain
