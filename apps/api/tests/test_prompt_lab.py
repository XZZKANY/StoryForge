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

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_streamed", fake_call)
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

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_streamed", fake_call)
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

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_streamed", fake_call)

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


@pytest.mark.parametrize("change", ["description", "ctx", "kind", "draft", "issues", "user_prompt", "preview_chars", "full_chapter"])
def test_merge_rejects_changed_fixture_before_touching_artifacts(monkeypatch, tmp_path, change):
    from dataclasses import replace

    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: {
        "content": "original evidence", "cost_cny_estimated": 0.1, "latency_ms": 1,
    })
    # 未变化的任务排在变化任务前面，确保全部选中任务都会提前校验。
    args = ["--task", "transition-full,opening-preview", "--variants", "baseline"]
    assert runner_module.main([*args, "--out", str(tmp_path), "--seed", "7"]) == 0
    before = {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    task = TASKS["opening-preview"]
    changes = {
        "description": "Different instructions for readers",
        "ctx": replace(task.ctx, user_intent="Different input with the same task description"),
        "kind": "critique", "draft": "different draft", "issues": ("new issue",),
        "user_prompt": "new user prompt", "preview_chars": task.preview_chars + 1,
        "full_chapter": not task.full_chapter,
    }
    monkeypatch.setitem(runner_module.TASKS, task.id, replace(task, **{change: changes[change]}))
    monkeypatch.setattr(runner_module, "_build_prompt", lambda *a: pytest.fail("必须在装配 prompt 前校验"))
    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: pytest.fail("不得分发调用"))
    with pytest.raises(SystemExit, match="opening-preview.*固定输入.*--out.*新目录.*重新开始实验"):
        runner_module.main([*args, "--merge", str(tmp_path)])
    assert {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before


def test_merge_rejects_legacy_fixture_identity_without_relabeling(monkeypatch, tmp_path):
    import json

    data = _sample_run_data()
    runner_module._write_artifacts(tmp_path, data, dry_run=False, blind_seed=7)
    before = {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: pytest.fail("不得分发调用"))
    with pytest.raises(SystemExit, match="opening-preview.*固定输入.*--out.*新目录.*重新开始实验"):
        runner_module.main(["--merge", str(tmp_path), "--task", "opening-preview", "--variants", "baseline"])
    assert {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before
    assert json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8")) == data


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


def test_realtime_and_final_output_files_agree(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """实时落盘与收尾写产物必须同一套编号，失败格留空档而不是让成功格改名重写。

    实证（2026-08-01 wave5）：两处口径不一致——实时按「已成功数」、收尾按「repeats 位次」，
    于是 2 次成功落出 3 个文件、r1 与 r2 逐字节相同。判读若按 outputs/*.txt 数样本
    （评审 agent 与我都是这么读的）就会把 n=2 当成 n=3。
    """

    import json

    from app.common.llm_client import LLMError
    from scripts.prompt_lab.runner import main

    calls = {"n": 0}

    def fake_call(*args: object, **kwargs: object) -> dict[str, object]:
        calls["n"] += 1
        if calls["n"] == 1:
            raise LLMError("第一次失败")
        return {"content": f"正文{calls['n']}", "cost_cny_estimated": 0.0, "latency_ms": 1}

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_streamed", fake_call)
    main(["--task", "opening-preview", "--variants", "baseline", "--repeat", "3", "--out", str(tmp_path)])

    files = sorted((tmp_path / "outputs").rglob("*.txt"))
    bodies = [f.read_text(encoding="utf-8") for f in files]
    assert len(files) == 2, f"2 次成功却落了 {len(files)} 个文件：{[f.name for f in files]}"
    assert len(set(bodies)) == 2, f"落盘出现重复正文：{bodies}"
    # 编号口径的真不变量：rN 必须对应 repeats 里第 N 位的那次（并发下哪一次失败不固定，
    # 但「文件编号 ↔ repeats 位次」必须恒成立），失败位次留空档。
    meta = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    repeats = meta["variants"]["opening-preview"]["variants"][0]["repeats"]
    for f in files:
        position = int(f.name.rsplit('--r', 1)[1].removesuffix('.txt'))
        assert repeats[position - 1]["output"] == f.read_text(encoding="utf-8"), f"{f.name} 与 repeats 位次对不上"


def test_transport_level_exception_does_not_discard_completed_cells(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """传输层裸异常只判该格失败，不打崩整跑。

    实证（2026-08-01 wave6 首跑）：中转站 ConnectionResetError 不是 LLMError，从
    as_completed 循环逃逸出去杀掉进程，已完成格与实时落盘一起归零——那正是实时落盘
    要防的故障。这里断言的是「已成功格必须活下来」，不只是「有 error 字段」。
    """

    import json

    from scripts.prompt_lab.runner import main

    calls = {"n": 0}

    def fake_call(*args: object, **kwargs: object) -> dict[str, object]:
        calls["n"] += 1
        if calls["n"] == 2:
            raise ConnectionResetError(10054, "远程主机强迫关闭了一个现有的连接")
        return {"content": f"正文{calls['n']}", "cost_cny_estimated": 0.0, "latency_ms": 1}

    monkeypatch.setattr("scripts.prompt_lab.runner.call_llm_streamed", fake_call)
    code = main(
        ["--task", "opening-preview", "--variants", "baseline", "--repeat", "3", "--out", str(tmp_path)]
    )

    assert code == 1  # 有失败格，退出码非 0
    meta = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    repeats = meta["variants"]["opening-preview"]["variants"][0]["repeats"]
    assert len(repeats) == 3, "整跑被打断，没跑满 repeats"
    assert sum(1 for r in repeats if "error" not in r) == 2, "已完成格被连坐丢弃"
    assert any("ConnectionResetError" in str(r.get("error", "")) for r in repeats)
    assert len(sorted((tmp_path / "outputs").rglob("*.txt"))) == 2


def test_grid_identity_is_scheduled_before_completion(monkeypatch, tmp_path):
    import json
    from concurrent.futures import Future

    class ControlledPool:
        def __init__(self, **kwargs):
            self.count = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def submit(self, function, *args):
            before = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
            slots = before["variants"]["opening-preview"]["variants"][0]["repeats"]
            assert len(slots) == 3
            assert len({slot["sample_id"] for slot in slots}) == 3
            self.count += 1
            future = Future()
            future.set_result({"output": f"body-{self.count}", "latency_ms": self.count,
                               "prompt_tokens": 10, "completion_tokens": 5,
                               "cost_cny_estimated": 0.1})
            return future

    monkeypatch.setattr(runner_module, "ThreadPoolExecutor", ControlledPool)
    monkeypatch.setattr(runner_module, "as_completed", lambda futures: [list(futures)[i] for i in (1, 2, 0)])
    task = runner_module.TASKS["opening-preview"]
    data, failed = runner_module._run_grid(
        {"opening-preview": task}, {task.kind: runner_module._select_variants(task.kind, ["baseline"])},
        dry_run=False, repeat=3, out_dir=tmp_path,
    )
    entry = data["variants"]["opening-preview"]["variants"][0]
    assert failed == 0
    assert [r["output"] for r in entry["repeats"]] == ["body-1", "body-2", "body-3"]
    assert entry["output"] == "body-1"
    assert entry["resources"]["attempt_count"] == 3
    assert entry["resources"]["cost_cny_known"] == pytest.approx(0.3)
    assert entry["resources"]["prompt_tokens_known"] == 30
    assert len(data["current_outputs"]) == 3


def test_failed_merge_excludes_stale_output_but_keeps_history(monkeypatch, tmp_path):
    import hashlib
    import json

    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: {
        "content": "old success", "cost_cny_estimated": 0.2, "latency_ms": 1,
    })
    args = ["--task", "opening-preview", "--variants", "baseline", "--repeat", "2"]
    assert runner_module.main([*args, "--out", str(tmp_path)]) == 0
    first = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    old_output = first["current_outputs"][0]
    original = (tmp_path / old_output["path"]).read_bytes()
    assert hashlib.sha256(original).hexdigest() == old_output["sha256"]

    def broken(*args, **kwargs):
        raise RuntimeError("prompt construction failed")

    monkeypatch.setattr(runner_module, "_build_prompt", broken)
    assert runner_module.main([*args, "--merge", str(tmp_path)]) == 1
    merged = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    entry = merged["variants"]["opening-preview"]["variants"][0]
    assert merged["current_outputs"] == []
    assert entry["output"] is None
    assert len(entry["repeats"]) == 2
    assert all(r["status"] == "prompt_failed" for r in entry["repeats"])
    assert entry["resources"]["attempt_count"] == 4
    assert entry["resources"]["cost_cny_known"] == pytest.approx(0.4)
    assert (tmp_path / old_output["path"]).read_bytes() == original
    assert entry["history"][0]["repeats"] == first["variants"]["opening-preview"]["variants"][0]["repeats"]


def test_merge_adds_new_variant_and_does_not_mutate_input(monkeypatch):
    from copy import deepcopy

    task = runner_module.TASKS["opening-preview"]
    original, _ = runner_module._run_grid(
        {task.id: task}, {task.kind: runner_module._select_variants(task.kind, ["baseline"])}, dry_run=True,
    )
    before = deepcopy(original)
    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: {
        "content": "new", "cost_cny_estimated": 0.1, "latency_ms": 1,
    })
    data, failed = runner_module._run_grid(
        {"opening-preview": task}, {task.kind: runner_module._select_variants(task.kind, ["no-craft"])},
        dry_run=False, existing=original,
    )
    assert failed == 0
    assert original == before
    assert {e["id"] for e in data["variants"]["opening-preview"]["variants"]} == {"baseline", "no-craft"}
    assert data["variants"][task.id]["fixture_fingerprint"] == original["variants"][task.id]["fixture_fingerprint"]
    assert data["variants"][task.id]["variants"][0] == original["variants"][task.id]["variants"][0]


def test_call_once_keeps_partial_usage_and_redacts_source_secret(monkeypatch):
    from app.common.llm_client import LLMError
    from app.platform.ai_sdk import TokenUsage

    secret = "opaque-local-credential"
    monkeypatch.setattr(runner_module, "resolved_llm_env", lambda: {"STORYFORGE_LLM_API_KEY": secret,
        "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "1", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "2"})

    def fail(*args, **kwargs):
        raise LLMError(secret, usage=TokenUsage(input_tokens=12, output_tokens=3, source="provider_usage"))

    monkeypatch.setattr(runner_module, "call_llm_streamed", fail)
    result = runner_module._call_once("prompt", runner_module.TASKS["opening-preview"])
    assert result["status"] == "failed"
    assert result["prompt_tokens"] == 12
    assert result["completion_tokens"] == 3
    assert result["cost_cny_estimated"] == pytest.approx(0.000018)
    assert secret not in str(result)


def test_blind_packet_has_no_operational_side_information():
    from scripts.prompt_lab.report import render_blind_packet

    data = _sample_run_data()
    data["run_id"] = "run-example"
    data["variants"]["another-task"] = __import__("copy").deepcopy(data["variants"]["opening-preview"])
    text, reveal = render_blind_packet(data, dry_run=False, seed=42)
    for forbidden in ("deepseek", "0.2", "0.000100", "token", "耗时", "成本", "温度", "原样", "去准则", "baseline"):
        assert forbidden not in text
    assert "正文甲" in text and "正文乙" in text
    first = reveal["tasks"]["opening-preview"]
    second = reveal["tasks"]["another-task"]
    assert {r["anonymous_id"] for r in first}.isdisjoint(r["anonymous_id"] for r in second)
    assert {r["variant_id"] for r in first} == {"baseline", "no-craft"}
    assert (text, reveal) == render_blind_packet(data, dry_run=False, seed=42)
    data["run_id"] = "another-run"
    assert text != render_blind_packet(data, dry_run=False, seed=42)[0]


def test_failed_sample_is_in_reveal_not_blind_diagnostics():
    from scripts.prompt_lab.report import render_blind_packet

    data = _sample_run_data()
    entry = data["variants"]["opening-preview"]["variants"][0]
    entry["repeats"] = [{"sample_id": "one", "output": "current prose", "status": "ok"},
                        {"sample_id": "two", "status": "failed", "error": "provider-name-secret"}]
    entry["history"] = [{"output": "stale prose"}]
    text, reveal = render_blind_packet(data, dry_run=False, seed=9)
    assert "current prose" in text
    assert "provider-name-secret" not in text and "stale prose" not in text
    assert len(reveal["tasks"]["opening-preview"]) == 3
    assert sum(r["included"] for r in reveal["tasks"]["opening-preview"]) == 2


def test_interruption_keeps_pending_denominator_and_replaces_old_blind(monkeypatch, tmp_path):
    import json

    args = ["--task", "opening-preview", "--variants", "baseline", "--repeat", "3", "--jobs", "1"]
    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: {
        "content": "old-body", "cost_cny_estimated": 0.1, "latency_ms": 1,
    })
    assert runner_module.main([*args, "--out", str(tmp_path), "--seed", "8"]) == 0
    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: {
        "content": "new-body", "cost_cny_estimated": None, "latency_ms": 1,
    })

    def interrupt(futures):
        yield next(iter(futures))
        raise KeyboardInterrupt

    monkeypatch.setattr(runner_module, "as_completed", interrupt)
    with pytest.raises(KeyboardInterrupt):
        runner_module.main([*args, "--merge", str(tmp_path)])
    data = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    entry = data["variants"]["opening-preview"]["variants"][0]
    assert [s["status"] for s in entry["repeats"]] == ["ok", "scheduled", "scheduled"]
    assert entry["resources"]["attempt_count"] == 6
    assert entry["resources"]["cost_cny_known"] == pytest.approx(0.3)
    assert entry["resources"]["cost_cny_unknown_count"] == 3
    assert entry["cost_cny_estimated"] is None
    assert len(data["current_outputs"]) == 1
    blind = (tmp_path / "blind.md").read_text(encoding="utf-8")
    assert "old-body" not in blind and "new-body" in blind
    reveal = json.loads((tmp_path / "blind-reveal.json").read_text(encoding="utf-8"))
    assert len(reveal["tasks"]["opening-preview"]) == 3


def test_legacy_cost_survives_repeated_checkpoints(tmp_path):
    data = _sample_run_data()
    for _ in range(3):
        runner_module._checkpoint(tmp_path, data)
        entry = data["variants"]["opening-preview"]["variants"][0]
        assert entry["resources"]["cost_cny_known"] == pytest.approx(0.0001)
        assert entry["resources"]["legacy_count"] == 1
        assert entry["cost_cny_estimated"] is None
        assert len(data["current_outputs"]) == 2
    assert len(list((tmp_path / "outputs").rglob("*.txt"))) == 2


@pytest.mark.parametrize("retry", [False, True])
def test_prompt_lab_sdk_observation_retains_request_and_resources(monkeypatch, tmp_path, retry):
    import json

    from app.common import llm_client
    from app.common.llm_observation import observe_http_progress

    source = {"STORYFORGE_LLM_API_KEY": "opaque-local-secret",
              "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1",
              "STORYFORGE_LLM_MODEL": "fixture-model", "STORYFORGE_LLM_TEMPERATURE": "0.4",
              "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "1",
              "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "2"}
    monkeypatch.setattr(runner_module, "resolved_llm_env", lambda: source)
    calls = []

    def stream(env, payload, **kwargs):
        calls.append(payload)
        if retry:
            observe_http_progress({"phase": "retry_started"})
        yield {"type": "done", "content": "fixture text", "prompt_tokens": 10,
               "completion_tokens": 5, "token_usage": 15, "token_usage_source": "provider_usage",
               "latency_ms": 7, "finish_reason": "stop"}

    monkeypatch.setattr(llm_client, "_raw_stream_chat_completions", stream)
    assert runner_module.main(["--task", "opening-preview", "--variants", "baseline", "--repeat", "2",
                               "--out", str(tmp_path)]) == 0
    data = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    entry = data["variants"]["opening-preview"]["variants"][0]
    assert len(calls) == 2
    for sample in entry["repeats"]:
        assert sample["model"] == "fixture-model"
        assert sample["parameters"]["temperature"] == calls[0]["temperature"] == 0.4
        assert sample["token_usage"] == 15
        assert sample["cost_cny_estimated"] == pytest.approx(0.000020)
    assert entry["resources"]["cost_cny_known"] == pytest.approx(0.000040)
    assert entry["resources"]["cost_cny_complete"] is not retry
    assert entry["resources"]["unaccounted_retry_count"] == (2 if retry else 0)
    assert "opaque-local-secret" not in json.dumps(data)


def test_default_output_directory_is_chosen_once(monkeypatch, tmp_path):
    calls = []

    def default_path():
        calls.append(1)
        return tmp_path / f"run-{len(calls)}"

    monkeypatch.setattr(runner_module, "_default_out_dir", default_path)
    assert runner_module.main(["--task", "opening-preview", "--variants", "baseline", "--dry-run"]) == 0
    assert len(calls) == 1
    assert (tmp_path / "run-1" / "run-metadata.json").exists()


@pytest.mark.parametrize("flag", ["--repeat", "--jobs"])
def test_invalid_counts_rejected_before_dispatch(monkeypatch, tmp_path, flag):
    monkeypatch.setattr(runner_module, "call_llm_streamed", lambda *a, **k: pytest.fail("no call expected"))
    with pytest.raises(SystemExit, match="positive"):
        runner_module.main([flag, "0", "--out", str(tmp_path)])
    assert not (tmp_path / "run-metadata.json").exists()


def test_partial_failed_sample_counts_alongside_success(monkeypatch, tmp_path):
    import json

    from app.common.llm_client import LLMError
    from app.platform.ai_sdk import TokenUsage

    source = {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "1", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "2"}
    monkeypatch.setattr(runner_module, "resolved_llm_env", lambda: source)
    calls = []

    def call(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise LLMError("partial", usage=TokenUsage(input_tokens=10, output_tokens=5, source="provider_usage"))
        return {"content": "success", "prompt_tokens": 10, "completion_tokens": 5,
                "latency_ms": 1, "cost_cny_estimated": 0.000020}

    monkeypatch.setattr(runner_module, "call_llm_streamed", call)
    assert runner_module.main(["--task", "opening-preview", "--variants", "baseline", "--repeat", "2",
                               "--jobs", "1", "--out", str(tmp_path)]) == 1
    data = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    entry = data["variants"]["opening-preview"]["variants"][0]
    assert entry["prompt_tokens"] == 20 and entry["completion_tokens"] == 10
    assert entry["cost_cny_estimated"] == pytest.approx(0.000040)
    assert entry["resources"]["success_count"] == 1
    assert entry["resources"]["attempt_count"] == 2
    assert len(data["current_outputs"]) == 1


def test_configuration_failure_does_not_invent_paid_call(monkeypatch, tmp_path):
    import json

    from app.common.llm_client import LLMConfigError

    def invalid():
        raise LLMConfigError("invalid config")

    monkeypatch.setattr(runner_module, "resolved_llm_env", invalid)
    assert runner_module.main(["--task", "opening-preview", "--variants", "baseline", "--out", str(tmp_path)]) == 1
    data = json.loads((tmp_path / "run-metadata.json").read_text(encoding="utf-8"))
    entry = data["variants"]["opening-preview"]["variants"][0]
    assert entry["repeats"][0]["no_model_call"] is True
    assert entry["cost_cny_estimated"] == 0
    assert entry["resources"]["cost_cny_unknown_count"] == 0


@pytest.mark.parametrize("status", [400, 503])
@pytest.mark.parametrize("attempt_limit", [1, 2])
def test_prompt_lab_resolved_environment_enforces_http_attempt_cap(monkeypatch, status, attempt_limit):
    from io import BytesIO
    from urllib import error

    from app.common import llm_client, llm_control

    monkeypatch.setattr(llm_control.time, "sleep", lambda _: pytest.fail("zero-delay retry must not sleep"))
    for key, value in {
        "STORYFORGE_LLM_API_KEY": "test-only-opaque-key",
        "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1",
        "STORYFORGE_LLM_MODEL": "attempt-cap-model",
        "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": str(attempt_limit),
        "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS": "0",
        "STORYFORGE_LLM_RETRY_JITTER_SECONDS": "0",
        "STORYFORGE_LLM_TEMPERATURE": "0.2",
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "2048",
    }.items():
        monkeypatch.setenv(key, value)
    sent = []

    def reject(req, **kwargs):
        sent.append(req)
        raise error.HTTPError(req.full_url, status, "fixture rejection", {}, BytesIO(b"{}"))

    monkeypatch.setattr(llm_client.request, "urlopen", reject)
    result = runner_module._call_once("self-authored fixture", TASKS["live-opening"])
    assert len(sent) == attempt_limit
    assert result["status"] == "failed"
    assert result["unaccounted_retry_count"] == attempt_limit - 1
    assert result["model"] == "attempt-cap-model"
    assert result["parameters"]["max_tokens"] == 2048
    assert result["cost_cny_estimated"] is None
