"""Phase 3 端到端验证测试。

验证从 dispatch payload（含 planning_refs）→ BookRun 执行
→ ArcConsistencyBarrier 自动介入的完整链路：
  - 弧线多章推进 → 到达 payoff 已 reinforced → 放行
  - 弧线在目标章被废弃 → 到期仍 planted → 阻断
"""

from __future__ import annotations

from typing import Any

from storyforge_workflow.orchestrators.book_run_adapter import (
    CapturingProgressSink,
    run_book_run_dispatch_payload,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest


def _dispatch_payload(*, chapters: list[dict[str, object]]) -> dict[str, object]:
    return {
        "book_run_id": 51,
        "book_id": 52,
        "blueprint_id": 53,
        "total_chapters": len(chapters),
        "start_chapter_index": 1,
        "existing_checkpoint": [],
        "token_budget": None,
        "time_budget_sec": None,
        "chapter_budget": len(chapters),
        "provider_fallback_pause_threshold": None,
        "chapters": [dict(ch) for ch in chapters],
        "volume_plan": None,
        "narrative_plan": _locked_narrative_plan(),
    }


def _locked_narrative_plan() -> dict[str, object]:
    return {
        "plan_id": "np-locked",
        "locked": True,
        "summary": "Phase 3 arc consistency test plan.",
        "chapter_beats": [
            {"chapter_index": 1, "beat": "setup"},
            {"chapter_index": 2, "beat": "payoff"},
            {"chapter_index": 3, "beat": "resolution"},
        ],
    }


def _always_pass_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    return NovelLoopPorts(
        compile_context=lambda novel_request: f"ctx-{novel_request.chapter_index}",
        generate_scene=lambda novel_request, context_id: f"第{novel_request.chapter_index}章正文。",
        record_model_run=lambda novel_request, draft: 500 + novel_request.chapter_index,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 600 + attempt},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 700 + novel_request.chapter_index,
        extract_memory=lambda novel_request, draft, approved_scene_id: [],
    )


def _fail_chapter_ports(fail_at_chapter: int) -> type:
    class _FailChapterPorts:
        def __init__(self, request: NovelLoopRequest):
            self.request = request

        def compile_context(self, novel_request: NovelLoopRequest) -> str:
            return f"ctx-{novel_request.chapter_index}"

        def generate_scene(self, novel_request: NovelLoopRequest, context_id: str) -> str:
            return f"第{novel_request.chapter_index}章正文。"

        def record_model_run(self, novel_request: NovelLoopRequest, draft: str) -> int:
            return 500 + novel_request.chapter_index

        def judge_scene(self, draft: str, attempt: int) -> dict[str, Any]:
            chapter_index = self.request.chapter_index
            if chapter_index == fail_at_chapter:
                return {"status": "reject", "judge_report_id": 600 + attempt, "issues": ["弧线未推进"]}
            return {"status": "pass", "judge_report_id": 600 + attempt}

        def repair_scene(self, draft: str, report: dict[str, Any], attempt: int) -> str:
            return draft

        def approve_scene(self, novel_request: NovelLoopRequest, draft: str, refs: Any) -> int | None:
            return None

    return _FailChapterPorts


def _ports_factory(fail_at_chapter: int):
    cls = _fail_chapter_ports(fail_at_chapter)

    def factory(request: NovelLoopRequest) -> NovelLoopPorts:
        instance = cls(request)
        return NovelLoopPorts(
            compile_context=instance.compile_context,
            generate_scene=instance.generate_scene,
            record_model_run=instance.record_model_run,
            judge_scene=instance.judge_scene,
            repair_scene=instance.repair_scene,
            approve_scene=instance.approve_scene,
            extract_memory=lambda novel_request, draft, approved_scene_id: [],
        )

    return factory


def test_phase3_end_to_end_arc_reinforced_across_three_chapters() -> None:
    """3 章全部 approved 且弧线得到推进 → BookRun 完成 → 弧线被 reinforced。"""

    payload = _dispatch_payload(
        chapters=[
            {
                "chapter_index": 1,
                "chapter_id": 201,
                "chapter_goal": "林岚抵达雾港。",
                "planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.67},
            },
            {
                "chapter_index": 2,
                "chapter_id": 202,
                "chapter_goal": "林岚发现信号规律。",
                "planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.67},
            },
            {
                "chapter_index": 3,
                "chapter_id": 203,
                "chapter_goal": "灯塔信号真相揭晓。",
                "planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.67},
            },
        ],
    )

    sink = CapturingProgressSink()
    result = run_book_run_dispatch_payload(payload, _always_pass_ports, sink)

    assert result.status == "completed"
    assert result.current_chapter_index == 3
    completed = result.progress["completed_chapters"]
    assert len(completed) == 3
    assert all(ch["status"] == "approved" for ch in completed)
    assert "consistency_conflict" not in result.progress
    # 进度链：initial → 每章 running → 最终 completed
    assert sink.payloads[-1]["status"] == "completed"
    assert any(p["status"] == "completed" for p in sink.payloads)


def test_phase3_end_to_end_arc_blocked_at_payoff_when_arc_chapter_fails() -> None:
    """弧线只在第 2 章有推进机会，该章废弃 → 到达第 2 章时 barrier 阻断。"""

    payload = _dispatch_payload(
        chapters=[
            {
                "chapter_index": 1,
                "chapter_id": 301,
                "chapter_goal": "林岚乘船抵达雾港。",
                "planning_refs": {"arc_ids": ["开篇钩子"], "arc_completion_ratio": 0.67},
            },
            {
                "chapter_index": 2,
                "chapter_id": 302,
                "chapter_goal": "林岚发现灯塔信号异常——这是灯塔许可弧线的唯一推进点。",
                "planning_refs": {"arc_ids": ["灯塔许可"], "arc_completion_ratio": 0.67},
            },
            {
                "chapter_index": 3,
                "chapter_id": 303,
                "chapter_goal": "灯塔事件收束。",
                "planning_refs": {"arc_ids": ["开篇钩子"], "arc_completion_ratio": 0.67},
            },
        ],
    )

    sink = CapturingProgressSink()
    result = run_book_run_dispatch_payload(payload, _ports_factory(fail_at_chapter=2), sink)

    # 第 2 章失败：judge 返回 reject → NovelLoop 不能 approve → arc 仍 planted
    # 到达第 2 章时该 arc 已到 payoff → barrier 阻断
    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    blocked = result.progress.get("blocked_chapter")
    assert blocked is not None

    conflict = result.progress.get("consistency_conflict")
    assert conflict is not None
    assert conflict["chapter_index"] == 2
    assert len(conflict["conflicts"]) == 1
    assert conflict["conflicts"][0]["kind"] == "arc_stalled"
    assert conflict["conflicts"][0]["arc_id"] == "灯塔许可"


def test_phase3_end_to_end_no_barrier_when_no_planning_refs() -> None:
    """dispatch 无 planning_refs → barrier 不介入 → 保持 Phase 2 行为不变。"""

    payload = _dispatch_payload(
        chapters=[
            {"chapter_index": 1, "chapter_id": 401, "chapter_goal": "独立第一章。"},
            {"chapter_index": 2, "chapter_id": 402, "chapter_goal": "独立第二章。"},
        ],
    )

    sink = CapturingProgressSink()
    result = run_book_run_dispatch_payload(payload, _always_pass_ports, sink)

    assert result.status == "completed"
    assert len(result.progress["completed_chapters"]) == 2
    assert "consistency_conflict" not in result.progress
