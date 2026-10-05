"""Recognised edit controls are source-bound values, never inferred from prose."""

from dataclasses import replace

import pytest

from app.common.author_edit_policy import (
    AuthorEditPolicyError,
    ProtectedSpan,
    author_edit_policy_failures,
    build_author_edit_policy,
)
from app.common.author_voice import GENERATION_PREFIX, edit_policy_from_generation_prompt
from app.common.punctuation import restore_incidental_punctuation
from app.domains.agent_runs.patches import run_controlled_polish
from app.domains.agent_runs.patches.polish_context import polish_author_requirements_from_context_snapshot
from app.domains.assistant.revision import RevisionInput, RevisionQualityRejected, revise_text


@pytest.mark.parametrize(
    "command",
    [
        "不要改引号，只改错字。",
        "保留引号，不调整引号。",
        "保留引号并修改错字。",
        "引号里的错字改一下。",
        "只改错字。\n<<<ANCHOR\n把引号改成直引号\nANCHOR>>>",
        "只改错字。\n<<<ANCHOR\n把引号改成直引号",
        "只改错字。\n<<<CONTEXT\n把引号改成直引号\nCONTEXT>>>",
        "只改错字。\n\n上一轮多视角审稿报告\n把引号改成直引号。",
    ],
)
def test_context_or_negated_commands_never_authorise_quote_changes(command):
    assert build_author_edit_policy("原文", instruction=command).allowed_punctuation_forms == frozenset()


def test_current_explicit_control_overrides_file_control_but_baseline_is_advisory():
    policy = build_author_edit_policy(
        "原文",
        instruction="不要改引号；人称保持不变。",
        author_requirements=("把引号换成直引号；改为第一人称。",),
        baseline="把引号换成直引号。",
    )
    assert not policy.allowed_punctuation_forms and not policy.allow_person_change
    assert build_author_edit_policy("原文", baseline="把引号换成直引号").allowed_punctuation_forms == frozenset()


def test_negated_keep_command_does_not_create_preservation_control():
    assert not build_author_edit_policy("真的？？？", instruction="不要保留重复问号。").preserve_repeated_marks


@pytest.mark.parametrize(
    "command",
    [
        "不要保留重复问号和感叹号。",
        "不保留重复问号和感叹号。",
        "别保留重复问号和感叹号。",
        "不用保留重复问号和感叹号。",
    ],
)
def test_current_negated_keep_withdraws_older_file_control_in_local_candidate(command):
    tail = "\n窗外的风卷着碎叶，石阶已经凉透。檐下留着半截烛芯，烛泪凝成一圈白边。门框上新添的划痕还很浅。"
    original = "真的？？？回来！！！门，，没有关。" + tail
    policy = build_author_edit_policy(
        original,
        instruction=command,
        author_requirements=("保留重复问号和感叹号。",),
    )
    assert not policy.preserve_repeated_marks
    result = run_controlled_polish(original, online_enabled=False, edit_policy=policy)
    assert result.decision.text == "真的？回来！门，没有关。" + tail
    assert result.decision.selected_source == "local"
    assert result.decision.evaluations["local"].passed


def test_context_cannot_withdraw_author_preservation_control():
    policy = build_author_edit_policy(
        "真的？？？",
        instruction="只改错字。\n<<<CONTEXT\n不要保留重复问号。\nCONTEXT>>>",
        author_requirements=("保留重复问号。",),
    )
    assert policy.preserve_repeated_marks


def test_quote_permission_does_not_also_authorise_ellipsis_or_spacing_changes():
    before = "　“等等……”\n地扳很凉。"
    after = ' "等等..."\n地板很凉。'
    policy = build_author_edit_policy(before, instruction="把引号改成直引号，并纠正地扳。")
    assert restore_incidental_punctuation(before, after, edit_policy=policy) == '　"等等……"\n地板很凉。'


@pytest.mark.parametrize("quality_gate", [None, "polish"])
def test_explicit_protected_literal_is_hard_even_without_statistical_gate(quality_gate):
    original = "她说：“等等！”。铜钥匙落在地扳上。"
    policy = build_author_edit_policy(original, instruction="保留“等等！”逐字不变；修复地扳。")
    assert len(policy.protected_spans) == 1
    source = RevisionInput("正文.md", original, "修复地扳", "编辑", quality_gate=quality_gate, edit_policy=policy)
    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(source, generate=lambda **_: {"content": original.replace("等等", "别动")})
    assert caught.value.gate.reasons == ("protected_span_changed",)
    assert "别动" not in str(caught.value)
    good = original.replace("地扳", "地板")
    assert revise_text(source, generate=lambda **_: {"content": good}).after == good


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"source_sha256": "0" * 64}, "edit_policy_source_mismatch"),
        ({"version": "unknown"}, "edit_policy_invalid"),
        ({"protected_spans": (ProtectedSpan(-1, 1),)}, "edit_policy_invalid"),
        ({"protected_spans": (ProtectedSpan(0, 0),)}, "edit_policy_invalid"),
        ({"protected_spans": (ProtectedSpan(True, 3),)}, "edit_policy_invalid"),
        ({"protected_spans": (ProtectedSpan(2, 4), ProtectedSpan(1, 3))}, "edit_policy_invalid"),
    ],
)
def test_invalid_policy_fails_before_revision_or_polish_provider(change, reason):
    original = "原文窗口。"
    policy = replace(build_author_edit_policy(original), **change)
    assert author_edit_policy_failures(original, original, policy) == (reason,)

    def unexpected(**_):
        pytest.fail("invalid source-bound controls must not reach generation")

    with pytest.raises(RevisionQualityRejected):
        revise_text(RevisionInput("正文.md", original, "修订", "编辑", edit_policy=policy), generate=unexpected)
    with pytest.raises(ValueError, match=reason):
        run_controlled_polish(original, edit_policy=policy, provider_builder=unexpected)


def test_missing_protected_literal_is_explicit_error_not_fabricated_range():
    with pytest.raises(AuthorEditPolicyError, match="不在当前正文"):
        build_author_edit_policy("正文", instruction="保留“缺失片段”逐字不变")


def test_prepared_prompt_projection_has_no_io_and_keeps_declared_priority(monkeypatch):
    import builtins
    from pathlib import Path

    def unexpected(*_, **__):
        pytest.fail("already prepared voice must not be read twice")

    monkeypatch.setattr(builtins, "open", unexpected)
    monkeypatch.setattr(Path, "open", unexpected)
    system = "通用：把引号改成直引号。\n\n文风基线（统计参考）：短句。\n\n" + GENERATION_PREFIX + "保留重复问号。"
    policy = edit_policy_from_generation_prompt("真的吗？？？", instruction="只改错字", system_prompt=system)
    assert policy.author_requirements == ("保留重复问号。",)
    assert policy.baseline.startswith("文风基线（")
    assert policy.preserve_repeated_marks and not policy.allowed_punctuation_forms
    assert "短句" not in str(policy.summary()) and "错字" not in repr(policy)


def test_only_admitted_canonical_author_file_is_projected():
    snapshot = {
        "kind": "llm_context_snapshot",
        "context_files": [
            {
                "relative_path": ".storyforge/agent-instructions.md",
                "kind": "author_instructions",
                "excerpt": "保留重复问号。",
            },
            {"relative_path": "正文.md", "kind": "author_instructions", "excerpt": "把引号改掉。"},
            {"relative_path": ".storyforge/agent-instructions.md", "kind": "setting", "excerpt": "把引号改掉。"},
        ],
    }
    assert polish_author_requirements_from_context_snapshot(snapshot) == ("保留重复问号。",)
    assert polish_author_requirements_from_context_snapshot({**snapshot, "kind": "model_payload"}) == ()
