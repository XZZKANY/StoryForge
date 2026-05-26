from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.quality.schemas import QualityDashboardQuery
from app.domains.quality.service import QualityDashboardInputError, build_quality_dashboard
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet
from app.domains.series.models import Series, SeriesMemory
from app.domains.style_packs.schemas import StylePackApplyCreate, StylePackCreate, StylePackUpdate
from app.domains.style_packs.service import apply_style_pack, create_style_pack, update_style_pack


def test_style_pack_service_flow_uses_latest_version_for_applied_rules(session: Session) -> None:
    """风格包应用时应复制最新版本，并让 Scene Packet 消费最新规则。"""

    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚走入港口。")
    session.add(scene)
    session.flush()
    character = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan",
        name="林岚",
        status="active",
        payload={"状态": "隐瞒伤势", "必须包含事实": ["左臂受伤"]},
        version=1,
    )
    session.add(character)
    session.commit()

    style_pack = create_style_pack(
        session,
        StylePackCreate(
            book_id=book.id,
            name="港口克制风格包",
            payload={
                "规则": "保持克制而具画面感",
                "禁用表达": ["作者直接解释"],
                "示例句": ["她把疼痛压回袖口。"],
            },
        ),
    )
    updated = update_style_pack(
        session,
        style_pack.id,
        StylePackUpdate(
            payload={
                "规则": "保持克制而具画面感",
                "禁用表达": ["旁白解释"],
                "示例句": ["她把解释压回沉默里。"],
            }
        ),
    )

    applied = apply_style_pack(
        session,
        style_pack.id,
        StylePackApplyCreate(book_id=book.id, scene_id=scene.id),
    )

    assert applied.asset_type == "style_rule"
    assert applied.payload["style_pack_id"] == updated.id
    assert applied.payload["style_pack_lineage_key"] == updated.lineage_key
    assert applied.payload["禁用表达"] == ["旁白解释"]

    packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚在谈判中隐藏伤势。",
            active_asset_ids=[character.id, applied.id],
            token_budget=180,
            user_intent="保持克制且具画面感。",
            retrieval_snippets=["港口广播比平时更刺耳。"],
        ),
    )

    assert packet.packet["风格规则"][0]["rule"] == "保持克制而具画面感"


def test_quality_dashboard_service_flow_and_missing_book_guard(session: Session) -> None:
    """质量看板服务聚合核心指标，并拒绝不存在的作品范围。"""

    series = Series(title="星海纪元", status="active", description="远航舰队系列。")
    session.add(series)
    session.flush()
    session.add_all(
        [
            SeriesMemory(
                series_id=series.id,
                memory_type="world_rule",
                lineage_key="rule-1",
                subject="灯塔信号",
                payload={"规则": "每七分钟重复一次"},
                version=1,
            ),
            SeriesMemory(
                series_id=series.id,
                memory_type="cross_book_constraint",
                lineage_key="constraint-1",
                subject="林岚旧伤",
                payload={"约束": "必须持续影响后续章节"},
                version=1,
            ),
        ]
    )
    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚隐瞒伤势。")
    session.add(scene)
    session.flush()

    open_issue = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=None,
        job_run_id=None,
        issue_type="setting_conflict",
        severity="high",
        status="open",
        description="正文遗漏左臂受伤事实。",
        payload={"span_start": 0, "span_end": 1},
    )
    resolved_issue = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=None,
        job_run_id=None,
        issue_type="style_drift",
        severity="medium",
        status="resolved",
        description="解释性短语过多。",
        payload={"span_start": 2, "span_end": 4},
    )
    session.add_all([open_issue, resolved_issue])
    session.flush()
    session.add_all(
        [
            RepairPatch(
                judge_issue_id=open_issue.id,
                scene_id=scene.id,
                status="accepted",
                patch={"target_span": "左臂完好无损", "replacement_text": "左臂仍然受伤"},
                rationale="修复设定冲突。",
                version=1,
            ),
            RepairPatch(
                judge_issue_id=resolved_issue.id,
                scene_id=scene.id,
                status="requires_rejudge",
                patch={"target_span": "旁白解释", "replacement_text": "她把解释压回沉默里"},
                rationale="修复文风漂移。",
                version=1,
            ),
            JobRun(book_id=book.id, scene_id=scene.id, job_type="batch_refinery", status="completed", progress={"total": 1}),
            JobRun(book_id=book.id, scene_id=scene.id, job_type="batch_refinery", status="partial_failed", progress={"total": 2}),
        ]
    )
    session.commit()

    dashboard = build_quality_dashboard(session, QualityDashboardQuery(book_id=book.id, series_id=series.id))
    assert dashboard.open_issue_count == 1
    assert dashboard.repair_acceptance_rate == 0.5
    assert dashboard.job_success_rate == 0.5
    assert dashboard.series_memory_count == 2
    assert "开放问题 1 条" in dashboard.open_issue_summary
    assert "修复采纳率 0.50" in dashboard.repair_acceptance_summary

    with pytest.raises(QualityDashboardInputError):
        build_quality_dashboard(session, QualityDashboardQuery(book_id=999))
