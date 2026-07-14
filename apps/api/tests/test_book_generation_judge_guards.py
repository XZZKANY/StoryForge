from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.book_generation import (
    BookGenerationError,
    _apply_word_count_floor,
    _assert_no_missing_chapters,
    _build_judge_payload,
    _count_approved_chapters,
    _finalize_scene_decision,
    _record_model_run,
    _strip_reasoning_leak,
)
from app.domains.book_runs.book_generation_judge import _record_summary_judge
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.deterministic import CONFLICT_ONLY_FACT_PREFIX, deterministic_judge_fallback
from app.domains.story_state.service import commit_story_state_changes


def _seed_gate_fixture(
    session: Session,
    *,
    content: str,
    word_min: int = 600,
    word_max: int = 1600,
) -> tuple[BookRun, Chapter, Scene]:
    """搭一套最小 book/blueprint/chapter/draft-scene/book_run，用于直接验证门禁函数。"""

    book = Book(title="门禁测试", status="draft", premise="验证门禁。")
    session.add(book)
    session.commit()
    session.refresh(book)
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="验证门禁。",
        tone="克制",
        target_word_count=12000,
        target_chapter_count=10,
        chapter_word_count_min=word_min,
        chapter_word_count_max=word_max,
        status="locked",
        metadata_={},
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    chapter = Chapter(book_id=book.id, ordinal=1, title="第一章", status="planned")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="正文", status="draft", content=content)
    session.add(scene)
    session.commit()
    session.refresh(scene)
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="running",
        current_chapter_index=1,
        total_chapters=10,
        progress={},
        checkpoint=[],
        token_budget=800000,
        tokens_used=0,
        chapter_budget=10,
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    return book_run, chapter, scene


def test_book_generation_judge_payload_uses_story_state_required_facts(session: Session) -> None:
    """Q4：Judge payload 应从 story_state 当前态投影注入冲突-only 已知事实。"""

    book_run, _first_chapter, _first_scene = _seed_gate_fixture(
        session,
        content="林岚左臂受伤。",
        word_min=1,
    )
    commit_story_state_changes(
        session,
        book_id=book_run.book_id,
        book_run_id=book_run.id,
        chapter_index=1,
        prose="林岚左臂受伤。",
        changes=[
            {
                "change_type": "character.status",
                "entity_kind": "character",
                "entity_id": "林岚",
                "canonical_name": "林岚",
                "surface_forms": ["林岚", "左臂受伤"],
                "payload": {"status": "左臂受伤"},
            }
        ],
    )
    chapter = Chapter(
        book_id=book_run.book_id,
        blueprint_id=book_run.blueprint_id,
        ordinal=2,
        title="第二章",
        status="planned",
        summary="验证真相源注入。",
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="矛盾正文",
        status="draft",
        content="林岚左臂完好无损，仍然照常完成谈判。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    packet = ScenePacket(scene_id=scene.id, packet={"book_run_id": book_run.id})
    session.add(packet)
    session.commit()
    session.refresh(packet)

    payload = _build_judge_payload(session, scene, packet)
    issues = deterministic_judge_fallback(payload)

    assert f"{CONFLICT_ONLY_FACT_PREFIX}左臂受伤" in payload.required_facts
    assert payload.evidence_links[0]["source"] == "story_state_ledger"
    assert [issue.category for issue in issues] == ["setting_conflict"]
    assert issues[0].matched_text == "左臂完好无损"


def test_conflict_only_story_state_fact_does_not_require_restatement(session: Session) -> None:
    """已知事实只查直接矛盾，不要求每章机械复述。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="林岚沉默地走进港口。", word_min=1)
    packet = ScenePacket(scene_id=scene.id, packet={"book_run_id": book_run.id})
    payload = _build_judge_payload(session, scene, packet).model_copy(
        update={"required_facts": [f"{CONFLICT_ONLY_FACT_PREFIX}左臂受伤"]}
    )

    assert deterministic_judge_fallback(payload) == []


def test_deterministic_judge_flags_forbidden_draft_system_terms(session: Session) -> None:
    """API 真实 judge 自包含检测系统/流程词，不依赖 workflow ForbiddenDraftTermsFilter。"""

    _book_run, _chapter, scene = _seed_gate_fixture(
        session,
        content="林岚推开门，像进入 Phase 测试 workflow，等待模型给出答案。",
        word_min=1,
    )
    packet = ScenePacket(scene_id=scene.id, packet={})
    payload = _build_judge_payload(session, scene, packet)

    issues = deterministic_judge_fallback(payload)

    forbidden_issues = [issue for issue in issues if issue.category == "forbidden_draft_term"]
    assert [issue.matched_text for issue in forbidden_issues] == ["Phase", "测试", "workflow", "模型"]
    assert all(issue.severity == "high" for issue in forbidden_issues)


def test_word_count_floor_caps_score_for_short_chapter(session: Session) -> None:
    """正文低于蓝图下限时，字数硬门禁应把分数压到批准阈值以下并记结构性问题。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="太短的占位正文。", word_min=600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score < 70
    assert any(item["category"] == "word_count_violation" for item in issues)


def test_count_approved_chapters_excludes_unapproved() -> None:
    """计数失真回归：处理过但未批准的章（如失控被拒批）不应计入产出章数，
    避免 run 报「30/30 completed」却丢章而 failure_count=0 误导审计。"""

    completed = [
        {"chapter_index": 1, "approved": True},
        {"chapter_index": 2, "approved": True},
        {"chapter_index": 3, "approved": False},  # 失控/截断被拒批，仅处理未产出
        {"chapter_index": 4, "approved": True},
    ]
    assert _count_approved_chapters(completed) == 3
    assert len(completed) == 4  # 处理数仍是 4，与产出数 3 区分


def test_count_approved_chapters_empty_is_zero() -> None:
    assert _count_approved_chapters([]) == 0


def test_strip_reasoning_leak_removes_paired_think_block() -> None:
    """成对 <think>…</think> 整段剥掉，只留正文。"""

    raw = "<think>我先规划一下本章节奏</think>林岚走进码头，海风很冷。"
    assert _strip_reasoning_leak(raw) == "林岚走进码头，海风很冷。"


def test_strip_reasoning_leak_handles_orphan_closing_tag() -> None:
    """第29章真实事故形态：开标签被上游吞掉，只剩 </think>，其前的推理草稿
    与重写的第一遍正文都应丢弃，只保留最后一个闭合标签之后的成稿。"""

    raw = "审计链又多了一环，准备重写。</think>林岚的冲锋舟切开夜色里的海面。"
    assert _strip_reasoning_leak(raw) == "林岚的冲锋舟切开夜色里的海面。"
    assert "</think>" not in _strip_reasoning_leak(raw)


def test_strip_reasoning_leak_keeps_last_segment_with_multiple_closings() -> None:
    """多个闭合标签时只保留最后一段，避免中间的推理残体混入。"""

    raw = "草稿A</think>草稿B</think>最终正文。"
    assert _strip_reasoning_leak(raw) == "最终正文。"


def test_strip_reasoning_leak_orphan_closing_tag_is_case_insensitive() -> None:
    """大小写变体 </Think> 与小写同语义：切到最后一个闭合标签之后。

    回归背景：旧实现 search 大小写不敏感、rfind 却大小写敏感，遇变体时
    rfind 返回 -1，切片退化为 cleaned[7:]，静默砍掉正文前 7 个字符。"""

    raw = "推理草稿。</Think>林岚推开值房的门。"
    assert _strip_reasoning_leak(raw) == "林岚推开值房的门。"


def test_strip_reasoning_leak_mixed_case_never_decapitates_content() -> None:
    """变体闭合标签在末尾时按同一语义丢弃其前全部内容、返回空串，
    由调用方抛「仅含思维链」明确报错——绝不允许旧实现那种砍头式静默损坏。"""

    raw = "# 第三章 晨渡\n\n正文段落。</THINK>"
    assert _strip_reasoning_leak(raw) == ""


def test_strip_reasoning_leak_preserves_clean_content() -> None:
    """无泄漏的干净正文除首尾空白外原样保留。"""

    raw = "  林岚点了点头。她没追问。  "
    assert _strip_reasoning_leak(raw) == "林岚点了点头。她没追问。"


def test_strip_reasoning_leak_removes_orphan_opening_tag() -> None:
    """有开无闭的孤立 <think> 标记本身抹掉，不让标签裸露在成稿里。"""

    raw = "<think>正文其实从这里开始，标记本不该出现。"
    assert _strip_reasoning_leak(raw) == "正文其实从这里开始，标记本不该出现。"


def test_word_count_floor_passes_chapter_within_bounds(session: Session) -> None:
    """正文落在区间内时，字数门禁不动分数也不加问题。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 900, word_min=600, word_max=1600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score == 100
    assert issues == []


def test_word_count_floor_over_target_within_runaway_factor_passes(session: Session) -> None:
    """超目标上限但在失控线（上限 × 2.5）内的密实正文应通过，不再误伤偏长好内容。"""

    # word_max=1600 → 失控线 4000；2400 字超目标上限但远低于失控线。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 2400, word_min=600, word_max=1600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score == 100
    assert issues == []


def test_word_count_floor_caps_score_for_runaway_chapter(session: Session) -> None:
    """正文超过失控线（上限 × 2.5）时，仍判失控并压分拒批，保留防重复/失控护栏。"""

    # word_max=1600 → 失控线 4000；4500 字判失控。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 4500, word_min=600, word_max=1600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score < 70
    assert any(item["category"] == "word_count_violation" for item in issues)


def test_word_count_floor_accepts_chapter_just_under_target_floor(session: Session) -> None:
    """ch8/ch12 回归：完整但略短于蓝图下限（下限×容差以上）的章不再被硬拒，
    否则 1990/2000 这种近下限好章会被判死、导出时丢成空洞。"""

    # 下限 2000 → 截断下限 1600；1990 字完整正文应通过。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 1990, word_min=2000, word_max=2500)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score == 100
    assert issues == []


def test_word_count_floor_still_rejects_truncated_chapter_below_tolerance(session: Session) -> None:
    """容差之下（下限×容差以下）的明显截断仍硬拒，保留防截断护栏不被容差架空。"""

    # 下限 2000 → 截断下限 1600；1200 字判截断。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 1200, word_min=2000, word_max=2500)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score < 70
    assert any(item["category"] == "word_count_violation" for item in issues)


def test_record_summary_judge_does_not_mark_subthreshold_as_passed(session: Session) -> None:
    """汇总 Judge 记录：分数未达批准阈值时不得误标「章节通过」（ch8/ch12 score=69 却记通过的回归）。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 900)
    packet = ScenePacket(scene_id=scene.id, job_run_id=None, status="assembled", packet={}, version=1)
    session.add(packet)
    session.commit()
    session.refresh(packet)

    sub = _record_summary_judge(session, scene, packet, 69)
    assert sub.issue_type != "phase9b_real_judge_pass"
    assert "章节通过" not in sub.description
    assert "未通过" in sub.description

    ok = _record_summary_judge(session, scene, packet, 100)
    assert ok.issue_type == "phase9b_real_judge_pass"
    assert "章节通过" in ok.description


def test_missing_chapter_guard_blocks_completed_on_gap(session: Session) -> None:
    """缺章护栏：completed_chapters 存在未批准章时拒绝标 completed，并把 run 落为 failed。"""

    book_run, _chapter, _scene = _seed_gate_fixture(session, content="字" * 900)
    completed = [
        {"chapter_index": 1, "approved": True},
        {"chapter_index": 2, "approved": False},  # 被门禁判死，导出会丢成空洞
        {"chapter_index": 3, "approved": True},
    ]
    with pytest.raises(BookGenerationError, match="缺章护栏"):
        _assert_no_missing_chapters(session, book_run.id, 3, completed, 1234)
    session.refresh(book_run)
    assert book_run.status == "failed"


def test_missing_chapter_guard_passes_when_all_approved(session: Session) -> None:
    """全部章批准产出时护栏放行，不抛错、不改 run 状态。"""

    book_run, _chapter, _scene = _seed_gate_fixture(session, content="字" * 900)
    completed = [{"chapter_index": index, "approved": True} for index in range(1, 4)]
    _assert_no_missing_chapters(session, book_run.id, 3, completed, 0)
    session.refresh(book_run)
    assert book_run.status == "running"


def test_finalize_scene_decision_refuses_subthreshold_chapter(session: Session) -> None:
    """门禁后置：评分低于阈值的章节不批准、不进上下文、不进导出。"""

    from app.domains.book_runs.book_context import clear_book_context_cache, get_book_context

    book_run, chapter, scene = _seed_gate_fixture(session, content="字" * 900)
    clear_book_context_cache(chapter.book_id)
    approved = _finalize_scene_decision(session, chapter, scene, 40)
    assert approved is False
    session.refresh(scene)
    session.refresh(chapter)
    assert scene.status == "needs_revision"
    assert chapter.status != "approved"
    context = get_book_context(session, chapter.book_id)
    assert all(ch.chapter_id != chapter.id for ch in context.approved_chapters)


def test_finalize_scene_decision_approves_passing_chapter(session: Session) -> None:
    """评分达标的章节批准、章节状态置 approved 并进上下文。"""

    from app.domains.book_runs.book_context import clear_book_context_cache, get_book_context

    book_run, chapter, scene = _seed_gate_fixture(session, content="字" * 900)
    clear_book_context_cache(chapter.book_id)
    approved = _finalize_scene_decision(session, chapter, scene, 100)
    assert approved is True
    session.refresh(scene)
    session.refresh(chapter)
    assert scene.status == "approved"
    assert chapter.status == "approved"
    context = get_book_context(session, chapter.book_id)
    assert any(ch.chapter_id == chapter.id for ch in context.approved_chapters)


def test_book_generation_truncates_long_model_run_summaries(session: Session) -> None:
    """长程 prompt 超过 ModelRun schema 上限时，只裁剪入库摘要，不阻断运行。"""

    book = Book(title="长摘要测试", status="draft", premise="验证长程 prompt 入库摘要。")
    session.add(book)
    session.commit()
    session.refresh(book)
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="验证长程 prompt 入库摘要。",
        tone="克制",
        target_word_count=35000,
        target_chapter_count=30,
        chapter_word_count_min=600,
        chapter_word_count_max=1600,
        status="locked",
        metadata_={},
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    chapter = Chapter(book_id=book.id, ordinal=21, title="真实生成 21", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="真实 LLM 正文", status="approved", content="正文")
    session.add(scene)
    session.commit()
    session.refresh(scene)
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="running",
        current_chapter_index=1,
        total_chapters=30,
        progress={},
        checkpoint=[],
        token_budget=800000,
        tokens_used=0,
        chapter_budget=30,
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    prompt = "prompt-start-" + ("甲" * 60000) + "-prompt-end"
    content = "content-start-" + ("乙" * 60000) + "-content-end"

    model_run = _record_model_run(
        session,
        book_run,
        scene,
        {
            "STORYFORGE_LLM_PROVIDER": "openai-compatible",
            "STORYFORGE_LLM_MODEL": "local-model",
        },
        {
            "prompt": prompt,
            "content": content,
            "latency_ms": 123,
            "token_usage": 456,
            "token_usage_source": "provider_usage",
        },
    )

    assert len(model_run.input_summary) <= 50000
    assert len(model_run.output_summary or "") <= 50000
    assert "prompt-start-" in model_run.input_summary
    assert "-prompt-end" in model_run.input_summary
    assert "content-start-" in (model_run.output_summary or "")
    assert "-content-end" in (model_run.output_summary or "")
    assert "摘要已截断" in model_run.input_summary
    assert model_run.payload["input_summary_original_length"] == len(prompt)
    assert model_run.payload["output_summary_original_length"] == len(content)
    assert model_run.payload["input_summary_truncated"] is True
    assert model_run.payload["output_summary_truncated"] is True
