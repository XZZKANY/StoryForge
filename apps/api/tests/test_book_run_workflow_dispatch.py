from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.blueprints.models import BookBlueprint
from app.domains.blueprints.service import trigger_chapter_plan
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import (
    BookRunBlockedError,
    apply_book_run_progress,
    build_book_run_workflow_dispatch,
    resume_book_run,
    retry_book_run_from_checkpoint,
)
from app.domains.books.models import Book, Chapter
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.story_memory.schemas import ForeshadowLifecycleTransition, MemoryAtom
from app.domains.story_memory.service import apply_foreshadow_lifecycle_transition, create_memory_atom
from app.domains.timeline.schemas import TimelineEventCreate
from app.domains.timeline.service import create_timeline_event


def seed_dispatchable_book_run(
    session_factory: sessionmaker[Session],
    *,
    target_chapter_count: int = 2,
    metadata: dict | None = None,
) -> int:
    """创建已生成章节计划的 running BookRun，供 workflow dispatch 使用。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="林岚在雾港追查失真的灯塔信号。",
            tone="克制悬疑",
            target_word_count=4500,
            target_chapter_count=target_chapter_count,
            chapter_word_count_min=1000,
            chapter_word_count_max=1800,
            status="locked",
            version=2,
            metadata_=metadata or {},
        )
        session.add(blueprint)
        session.commit()
        trigger_chapter_plan(session, blueprint.id)
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=target_chapter_count,
            progress={"completed_chapters": []},
            checkpoint=[],
            token_budget=1000,
            tokens_used=0,
            time_budget_sec=300,
            elapsed_time_sec=0,
            chapter_budget=target_chapter_count,
            estimated_cost=0.0,
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        return book_run.id


def _book_run_scope(session: Session, book_run_id: int) -> tuple[BookRun, BookBlueprint]:
    book_run = session.get(BookRun, book_run_id)
    assert book_run is not None
    blueprint = session.get(BookBlueprint, book_run.blueprint_id)
    assert blueprint is not None
    return book_run, blueprint


def _seed_longform_context(session: Session, book_run_id: int) -> None:
    book_run, blueprint = _book_run_scope(session, book_run_id)
    chapters = (
        session.query(Chapter)
        .filter(Chapter.book_id == book_run.book_id, Chapter.blueprint_id == blueprint.id)
        .order_by(Chapter.ordinal)
        .all()
    )
    assert len(chapters) >= 2
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id=f"readiness-world-rule:{book_run.book_id}",
            novel_id=book_run.book_id,
            entity_type="world_rule",
            entity_id="灯塔规约",
            fact_type="rule",
            value="所有跨卷航线必须遵守灯塔许可。",
            source_ref=f"blueprint:{blueprint.id}:longform-readiness",
            immutable=True,
        ),
    )
    character = Asset(
        book_id=book_run.book_id,
        scene_id=None,
        asset_type="character",
        lineage_key=f"readiness-character:{book_run.book_id}",
        name="林岚",
        status="active",
        payload={"身份": "调查员"},
        version=1,
    )
    session.add(character)
    session.commit()
    session.refresh(character)
    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book_run.book_id,
            character_id=character.id,
            canonical_name="林岚",
            aliases=["林调查员"],
            voice_traits={"语气": "克制"},
            forbidden_traits={"禁止": ["忘记灯塔许可"]},
        ),
    )
    create_timeline_event(
        session,
        TimelineEventCreate(
            project_id=1,
            book_id=book_run.book_id,
            volume_id=1,
            chapter_id=chapters[0].id,
            time_order=10,
            summary="林岚发现灯塔许可与跨卷航线有关。",
            evidence_refs=[f"chapter:{chapters[0].id}:summary"],
            payload={"kind": "longform_readiness"},
        ),
    )
    apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=book_run.book_id,
            foreshadow_id="灯塔许可",
            target_state="planted",
            chapter_id=chapters[0].id,
            volume_id=1,
            evidence_refs=[f"chapter:{chapters[0].id}:signal"],
            transition_reason="第一卷开端埋下灯塔许可伏笔。",
        ),
    )


def test_build_book_run_workflow_dispatch_payload(session_factory: sessionmaker[Session]) -> None:
    """API 应生成 workflow worker 可消费的 BookRun dispatch payload。"""

    book_run_id = seed_dispatchable_book_run(session_factory)

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.book_run_id == book_run_id
    assert dispatch.start_chapter_index == 1
    assert dispatch.total_chapters == 2
    assert dispatch.existing_checkpoint == []
    assert dispatch.token_budget == 1000
    assert dispatch.time_budget_sec == 300
    assert dispatch.chapter_budget == 2
    assert [chapter.chapter_index for chapter in dispatch.chapters] == [1, 2]
    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 2}},
    ]
    assert all(chapter.chapter_id > 0 for chapter in dispatch.chapters)
    assert dispatch.chapters[0].chapter_goal


def test_workflow_dispatch_includes_generated_locked_narrative_plan(
    session_factory: sessionmaker[Session],
) -> None:
    """缺少 metadata narrative_plan 时，dispatch 应从章节计划生成锁定的轻量默认计划。"""

    book_run_id = seed_dispatchable_book_run(session_factory, target_chapter_count=3)

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    payload = dispatch.model_dump()
    assert payload["narrative_plan"]["locked"] is True
    assert payload["narrative_plan"]["source"] == "generated_default"
    assert payload["narrative_plan"]["generated"] is True
    assert [beat["chapter_index"] for beat in payload["narrative_plan"]["chapter_beats"]] == [1, 2, 3]
    assert all(beat["beat"] for beat in payload["narrative_plan"]["chapter_beats"])
    assert payload["entity_budget"] == {
        "key_characters": 5,
        "core_locations": 3,
        "core_evidence": 3,
        "major_reversals": 2,
    }
    assert payload["phase_policy"] == {
        "phases": [
            {"name": "setup", "chapter_range": {"start": 1, "end": 1}},
            {"name": "investigation", "chapter_range": {"start": 2, "end": 2}},
            {"name": "reversal", "chapter_range": {"start": 3, "end": 3}},
            {"name": "resolution", "chapter_range": {"start": 3, "end": 3}},
        ]
    }
    assert payload["beat_sheet_gate"] == {
        "status": "pass",
        "locked": True,
        "chapter_count": 3,
        "source": "generated_default",
    }


def test_workflow_dispatch_scales_default_phase_policy_to_target_chapter_count(
    session_factory: sessionmaker[Session],
) -> None:
    """默认阶段边界应按实际章数缩放，避免 18 章长跑仍携带 25-30 章阶段。"""

    book_run_id = seed_dispatchable_book_run(session_factory, target_chapter_count=18)

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.phase_policy == {
        "phases": [
            {"name": "setup", "chapter_range": {"start": 1, "end": 4}},
            {"name": "investigation", "chapter_range": {"start": 5, "end": 9}},
            {"name": "reversal", "chapter_range": {"start": 10, "end": 14}},
            {"name": "resolution", "chapter_range": {"start": 15, "end": 18}},
        ]
    }


def test_workflow_dispatch_sanitizes_locked_metadata_narrative_plan(
    session_factory: sessionmaker[Session],
) -> None:
    """dispatch 只传递锁定 NarrativePlan 的结构化摘要，不能泄露正文、草稿或 prompt。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=3,
        metadata={
            "narrative_plan": {
                "locked": True,
                "premise": "雾港灯塔信号被人伪造。",
                "truth": "真正的信号来自旧港沉船。",
                "protagonist_arc": "林岚从孤证执念转向协作求证。",
                "antagonist_motive": "沈砚隐藏事故责任。",
                "allowed_entities": {
                    "characters": ["林岚", "沈砚"],
                    "locations": ["雾港灯塔"],
                    "evidence": ["失真电报码"],
                    "extra_notes": "SHOULD_NOT_LEAK",
                },
                "major_reversals": [
                    {"chapter_index": 2, "summary": "沈砚提供的证词反向指向自己。", "draft": "SHOULD_NOT_LEAK"},
                ],
                "chapter_beats": [
                    {"chapter_index": 1, "beat": "发现灯塔信号失真。", "prompt": "SHOULD_NOT_LEAK"},
                    {"chapter_index": 2, "beat": "证词出现反转。", "full_prose": "SHOULD_NOT_LEAK"},
                    {"chapter_index": 3, "beat": "公开旧港沉船真相。", "draft_text": "SHOULD_NOT_LEAK"},
                ],
                "full_prose": "SHOULD_NOT_LEAK",
                "draft": "SHOULD_NOT_LEAK",
                "prompt": "SHOULD_NOT_LEAK",
            }
        },
    )

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    payload = dispatch.model_dump()
    assert payload["narrative_plan"] == {
        "locked": True,
        "source": "metadata",
        "generated": False,
        "premise": "雾港灯塔信号被人伪造。",
        "truth": "真正的信号来自旧港沉船。",
        "protagonist_arc": "林岚从孤证执念转向协作求证。",
        "antagonist_motive": "沈砚隐藏事故责任。",
        "allowed_entities": {
            "characters": ["林岚", "沈砚"],
            "locations": ["雾港灯塔"],
            "evidence": ["失真电报码"],
        },
        "major_reversals": [{"chapter_index": 2, "summary": "沈砚提供的证词反向指向自己。"}],
        "chapter_beats": [
            {"chapter_index": 1, "beat": "发现灯塔信号失真。"},
            {"chapter_index": 2, "beat": "证词出现反转。"},
            {"chapter_index": 3, "beat": "公开旧港沉船真相。"},
        ],
    }
    serialized = dispatch.model_dump_json()
    assert "SHOULD_NOT_LEAK" not in serialized
    assert "full_prose" not in serialized
    assert "draft_text" not in serialized
    assert "prompt" not in serialized


def test_workflow_dispatch_includes_lightweight_planning_refs(
    session_factory: sessionmaker[Session],
) -> None:
    """dispatch 每章只携带 planning arc 的轻量引用，不能泄露完整规划对象。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=5,
        metadata={
            "planning_arcs": [
                {
                    "arc_id": "旧港信号",
                    "title": "旧港信号真相",
                    "target_chapters": [1, 2, 3],
                    "payoff_chapter": 3,
                },
                {
                    "arc_id": "灯塔许可",
                    "title": "灯塔许可代价",
                    "target_chapters": [4],
                    "payoff_chapter": 4,
                },
            ],
        },
    )

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.chapters[0].planning_refs is not None
    assert dispatch.chapters[0].planning_refs.model_dump() == {
        "arc_ids": ["旧港信号"],
        "arc_completion_ratio": 0.8,
    }
    assert dispatch.chapters[3].planning_refs is not None
    assert dispatch.chapters[3].planning_refs.model_dump() == {
        "arc_ids": ["灯塔许可"],
        "arc_completion_ratio": 0.8,
    }
    assert dispatch.chapters[4].planning_refs is None
    assert "planning_arcs" not in dispatch.model_dump_json()


def test_workflow_dispatch_ignores_corrupt_planning_summary_refs(
    session_factory: sessionmaker[Session],
) -> None:
    """损坏的 planning_summary 不应让 dispatch 抛错或输出异常 refs。"""

    with session_factory() as session:
        book = Book(title="损坏摘要作品", status="draft", premise="测试损坏规划摘要。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="测试损坏规划摘要。",
            tone="克制",
            target_word_count=3000,
            target_chapter_count=3,
            chapter_word_count_min=800,
            chapter_word_count_max=1200,
            status="locked",
            version=1,
            metadata_={
                "planning_summary": {
                    "schema_version": 1,
                    "arc_completion_ratio": "坏比例",
                    "chapter_arc_links": {
                        "1": "不是列表",
                        "2": ["有效弧线"],
                    },
                },
            },
        )
        session.add(blueprint)
        session.flush()
        for index in range(1, 4):
            session.add(
                Chapter(
                    book_id=book.id,
                    blueprint_id=blueprint.id,
                    ordinal=index,
                    title=f"第 {index} 章",
                    status="planned",
                    summary=f"第 {index} 章目标",
                    required_beats=[],
                )
            )
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=3,
            progress={"completed_chapters": []},
            checkpoint=[],
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        book_run_id = book_run.id

        dispatch = build_book_run_workflow_dispatch(session, book_run_id)
        blueprint.metadata_ = {
            "planning_summary": {
                "schema_version": 1,
                "arc_completion_ratio": -0.5,
                "chapter_arc_links": {"2": ["有效弧线"]},
            },
        }
        session.commit()
        negative_dispatch = build_book_run_workflow_dispatch(session, book_run_id)
        blueprint.metadata_ = {
            "planning_summary": {
                "schema_version": 1,
                "arc_completion_ratio": 2.5,
                "chapter_arc_links": {"2": ["有效弧线"]},
            },
        }
        session.commit()
        capped_dispatch = build_book_run_workflow_dispatch(session, book_run_id)
        blueprint.metadata_ = {"planning_summary": {"arc_completion_ratio": 0.5, "chapter_arc_links": "坏链接"}}
        session.commit()
        corrupt_links_dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.chapters[0].planning_refs is None
    assert dispatch.chapters[1].planning_refs is not None
    assert dispatch.chapters[1].planning_refs.model_dump() == {
        "arc_ids": ["有效弧线"],
        "arc_completion_ratio": 0.0,
    }
    assert negative_dispatch.chapters[1].planning_refs is not None
    assert negative_dispatch.chapters[1].planning_refs.arc_completion_ratio == 0.0
    assert capped_dispatch.chapters[1].planning_refs is not None
    assert capped_dispatch.chapters[1].planning_refs.arc_completion_ratio == 1.0
    assert all(chapter.planning_refs is None for chapter in corrupt_links_dispatch.chapters)


def test_longform_volume_dispatch_requires_context_readiness(
    session_factory: sessionmaker[Session],
) -> None:
    """长篇/分卷 dispatch 必须先具备四类上下文证据，不能只靠扩章节数。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=5,
        metadata={"volume_count": 2, "longform_context_required": True},
    )

    with session_factory() as session, pytest.raises(BookRunBlockedError) as exc_info:
        build_book_run_workflow_dispatch(session, book_run_id)

    message = str(exc_info.value)
    assert "长篇上下文门禁未满足" in message
    assert "Story Memory" in message
    assert "Character Bible" in message
    assert "Timeline" in message
    assert "Foreshadow" in message


def test_longform_volume_dispatch_passes_after_context_readiness(
    session_factory: sessionmaker[Session],
) -> None:
    """补齐 Story Memory、Character Bible、Timeline 和伏笔状态后，分卷 dispatch 才可生成。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=5,
        metadata={"volume_count": 2, "longform_context_required": True},
    )

    with session_factory() as session:
        _seed_longform_context(session, book_run_id)
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.book_run_id == book_run_id
    assert [chapter.chapter_index for chapter in dispatch.chapters] == [1, 2, 3, 4, 5]
    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 3}},
        {"volume_index": 2, "chapter_range": {"start": 4, "end": 5}},
    ]


def test_single_volume_dispatch_does_not_require_longform_context(
    session_factory: sessionmaker[Session],
) -> None:
    """普通单卷短篇仍按章节计划生成 dispatch，不被长篇门禁误拦截。"""

    book_run_id = seed_dispatchable_book_run(session_factory, target_chapter_count=5, metadata={})

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.book_run_id == book_run_id
    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 5}},
    ]


def test_build_book_run_workflow_dispatch_uses_metadata_volume_plan(
    session_factory: sessionmaker[Session],
) -> None:
    """metadata.volume_plan 应优先成为 workflow 的稳定卷计划输入。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=5,
        metadata={
            "volume_count": 2,
            "volume_plan": [
                {"volume_index": 1, "chapter_range": {"start": 1, "end": 2}},
                {"volume_index": 2, "chapter_range": {"start": 3, "end": 99}},
            ],
        },
    )

    with session_factory() as session:
        _seed_longform_context(session, book_run_id)
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 2}},
        {"volume_index": 2, "chapter_range": {"start": 3, "end": 5}},
    ]


def test_build_book_run_workflow_dispatch_derives_even_volume_plan_from_volume_count(
    session_factory: sessionmaker[Session],
) -> None:
    """缺少 metadata.volume_plan 时，应按 volume_count 均分总章节。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=5,
        metadata={"volume_count": 2},
    )

    with session_factory() as session:
        _seed_longform_context(session, book_run_id)
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 3}},
        {"volume_index": 2, "chapter_range": {"start": 4, "end": 5}},
    ]


def test_build_book_run_workflow_dispatch_falls_back_single_volume_for_invalid_metadata(
    session_factory: sessionmaker[Session],
) -> None:
    """metadata 卷结构不合法时沿用宽松读取风格，回退为单卷计划。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=4,
        metadata={"volume_plan": [{"volume_index": 1, "chapter_range": {"start": 3, "end": 2}}]},
    )

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 4}},
    ]


def test_workflow_dispatch_after_resume_starts_after_latest_checkpoint(
    session_factory: sessionmaker[Session],
) -> None:
    """resume 后 dispatch 应从最新 checkpoint 下一章开始，并保留卷计划。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        target_chapter_count=5,
        metadata={"volume_count": 2},
    )
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
    }

    with session_factory() as session:
        _seed_longform_context(session, book_run_id)
        apply_book_run_progress(
            session,
            book_run_id,
            BookRunProgressUpdate(status="paused_by_budget", current_chapter_index=2, progress=progress),
        )
        resume_book_run(session, book_run_id)
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.start_chapter_index == 3
    assert [checkpoint["chapter_index"] for checkpoint in dispatch.existing_checkpoint] == [1, 2]
    assert [chapter.chapter_index for chapter in dispatch.chapters] == [3, 4, 5]
    assert [item.model_dump() for item in dispatch.volume_plan] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 3}},
        {"volume_index": 2, "chapter_range": {"start": 4, "end": 5}},
    ]


def test_workflow_dispatch_after_retry_prefers_retry_start_over_stale_resume(
    session_factory: sessionmaker[Session],
) -> None:
    """retry 后 dispatch 应使用 retry 起点，不能被陈旧 resume 字段带回旧章节。"""

    book_run_id = seed_dispatchable_book_run(session_factory, target_chapter_count=5)
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
        "resume_from_chapter_index": 2,
    }

    with session_factory() as session:
        apply_book_run_progress(
            session,
            book_run_id,
            BookRunProgressUpdate(status="paused_by_budget", current_chapter_index=2, progress=progress),
        )
        retry_book_run_from_checkpoint(session, book_run_id)
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.start_chapter_index == 3
    assert [chapter.chapter_index for chapter in dispatch.chapters] == [3, 4, 5]


def test_workflow_dispatch_endpoint_returns_payload(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """内部调度接口只返回 dispatch payload，不执行 workflow。"""

    book_run_id = seed_dispatchable_book_run(
        session_factory,
        metadata={
            "narrative_plan": {
                "locked": True,
                "premise": "接口返回轻量计划。",
                "truth": "只返回摘要。",
                "protagonist_arc": "从怀疑到验证。",
                "antagonist_motive": "隐藏事故。",
                "allowed_entities": {"characters": ["林岚"], "locations": ["雾港"], "evidence": ["电报码"]},
                "major_reversals": [{"chapter_index": 2, "summary": "证词反转。"}],
                "chapter_beats": [
                    {"chapter_index": 1, "beat": "发现异常。"},
                    {"chapter_index": 2, "beat": "揭露真相。"},
                ],
                "prompt": "SHOULD_NOT_LEAK",
            }
        },
    )

    response = client.get(f"/api/book-runs/{book_run_id}/workflow-dispatch")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["book_run_id"] == book_run_id
    assert payload["chapters"][0]["chapter_index"] == 1
    assert payload["chapters"][0]["chapter_goal"]
    assert payload["volume_plan"] == [
        {"volume_index": 1, "chapter_range": {"start": 1, "end": 2}},
    ]
    assert payload["narrative_plan"]["locked"] is True
    assert payload["narrative_plan"]["source"] == "metadata"
    assert payload["entity_budget"]["key_characters"] == 5
    assert payload["phase_policy"]["phases"][0] == {"name": "setup", "chapter_range": {"start": 1, "end": 1}}
    assert payload["beat_sheet_gate"] == {
        "status": "pass",
        "locked": True,
        "chapter_count": 2,
        "source": "metadata",
    }
    assert "SHOULD_NOT_LEAK" not in json.dumps(payload, ensure_ascii=False)


def test_workflow_dispatch_requires_chapter_plan(session_factory: sessionmaker[Session]) -> None:
    """缺少章节计划时拒绝生成 dispatch，避免 workflow 收到未知 chapter_id。"""

    with session_factory() as session:
        book = Book(title="未规划作品", status="draft", premise="缺少章节计划。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="缺少章节计划。",
            tone="克制",
            target_word_count=3000,
            target_chapter_count=1,
            chapter_word_count_min=800,
            chapter_word_count_max=1200,
            status="locked",
            version=1,
            metadata_={},
        )
        session.add(blueprint)
        session.flush()
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=1,
            progress={"completed_chapters": []},
            checkpoint=[],
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        book_run_id = book_run.id

        try:
            build_book_run_workflow_dispatch(session, book_run_id)
        except Exception as exc:
            assert "章节计划" in str(exc)
        else:
            raise AssertionError("缺少章节计划时必须拒绝生成 dispatch。")
