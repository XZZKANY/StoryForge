from __future__ import annotations

import pytest

from app.domains.context_compiler.schemas import ContextBlock, ContextCompileRequest, WorkflowStateReference
from app.domains.context_compiler.service import compile_context


def test_context_compiler_keeps_required_blocks_and_drops_low_priority_when_budget_is_full() -> None:
    """上下文编译器优先保留硬约束，并记录被裁剪证据的原因。"""

    compiled = compile_context(
        ContextCompileRequest(
            novel_id=1,
            chapter_id=8,
            scene_id=3,
            token_budget=90,
            memory_revision=4,
            timeline_revision=5,
            score_threshold=0.4,
            blocks=[
                ContextBlock(
                    block_id="goal",
                    kind="scene_goal",
                    title="场景目标",
                    content="林岚必须在谈判中隐瞒左臂旧伤。",
                    source_ref="scene:3",
                    token_count=20,
                    priority="required",
                    injection_position="scene",
                ),
                ContextBlock(
                    block_id="immutable-eye",
                    kind="immutable_fact",
                    title="不可变事实",
                    content="林岚左臂旧伤在第十二章前不能公开。",
                    source_ref="memory:m1",
                    token_count=25,
                    priority="required",
                    injection_position="memory",
                ),
                ContextBlock(
                    block_id="retrieval-good",
                    kind="retrieval_chunk",
                    title="检索证据",
                    content="旧协议要求谈判者不得暴露舰队伤员。",
                    source_ref="retrieval:1:1",
                    token_count=30,
                    priority="medium",
                    injection_position="evidence",
                    score=0.9,
                ),
                ContextBlock(
                    block_id="retrieval-bad",
                    kind="retrieval_chunk",
                    title="弱相关证据",
                    content="港口天气晴朗，海鸥很多。",
                    source_ref="retrieval:2:1",
                    token_count=20,
                    priority="low",
                    injection_position="evidence",
                    score=0.2,
                ),
                ContextBlock(
                    block_id="style",
                    kind="style_rule",
                    title="风格规则",
                    content="保持克制，不用作者旁白解释。",
                    source_ref="style:1",
                    token_count=25,
                    priority="low",
                    injection_position="style",
                    score=0.8,
                ),
            ],
        )
    )

    injected_ids = [block.block_id for block in compiled.injected_blocks]
    dropped = {block.block_id: block.reason for block in compiled.dropped_blocks}
    assert "goal" in injected_ids
    assert "immutable-eye" in injected_ids
    assert "retrieval-good" in injected_ids
    assert "retrieval-bad" in dropped
    assert "score_threshold" in dropped["retrieval-bad"]
    assert "style" in dropped
    assert "预算" in dropped["style"]
    assert compiled.budget_report.used_tokens == 75
    assert compiled.budget_report.truncated is True
    assert compiled.compiled_context_id.startswith("ctx_")


def test_context_compiler_rejects_required_blocks_larger_than_budget() -> None:
    """必保留上下文超过预算时应先拆场景，而不是静默裁剪硬约束。"""

    with pytest.raises(ValueError, match="必保留上下文"):
        ContextCompileRequest(
            novel_id=1,
            chapter_id=1,
            scene_id=1,
            token_budget=10,
            blocks=[
                ContextBlock(
                    block_id="must",
                    kind="immutable_fact",
                    title="硬约束",
                    content="死亡角色不能重新登场。",
                    source_ref="memory:m2",
                    token_count=20,
                    priority="required",
                )
            ],
        )


def test_workflow_state_reference_stores_ids_not_full_story_payloads() -> None:
    """workflow checkpoint 只保存引用，避免 LangGraph State 随全文线性膨胀。"""

    state = WorkflowStateReference(
        job_id="job-1",
        novel_id=1,
        chapter_id=2,
        scene_id=3,
        compiled_context_id="ctx_abc",
        outline_revision=1,
        memory_revision=2,
        timeline_revision=3,
        model_run_ids=["run-1"],
        artifact_ids=["artifact-1"],
        current_step="draft_writer",
    )

    dumped = state.model_dump()
    assert "compiled_context_id" in dumped
    assert "full_novel" not in dumped
    assert "all_chapters" not in dumped
    assert "all_memory_atoms" not in dumped
