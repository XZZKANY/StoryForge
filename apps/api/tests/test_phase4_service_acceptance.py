from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import create_artifact, list_artifacts
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.evaluations.schemas import EvaluationCaseCreate, EvaluationRunCreate
from app.domains.evaluations.service import create_evaluation_case, create_evaluation_run, list_evaluation_runs
from app.domains.exports.service import build_epub_export, build_markdown_export
from app.domains.jobs.models import JobRun
from app.domains.jobs.service import sync_job_run_with_runtime
from app.domains.model_runs.service import list_model_runs, record_runtime_model_run
from app.domains.prompt_packs.schemas import PromptPackCreate, PromptPackUpdate
from app.domains.prompt_packs.service import create_prompt_pack, get_prompt_pack_history, update_prompt_pack
from app.domains.retrieval.schemas import RetrievalRefreshRunCreate, RetrievalSearchCreate, RetrievalSourceCreate
from app.domains.retrieval.service import (
    create_retrieval_refresh_run,
    create_retrieval_source,
    search_retrieval,
)
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet
from app.domains.series.models import Series
from app.domains.workspaces.models import Workspace


def test_phase4_retrieval_prompt_runtime_service_flow(session: Session) -> None:
    """检索、Scene Packet 自动检索、Prompt Pack、模型运行日志和任务桥接可以串联验证。"""

    workspace = Workspace(title="Phase4 服务验收", slug="phase4-service", status="active", seat_limit=4)
    series = Series(title="星海纪元", status="active", description="远航舰队系列。")
    session.add_all([workspace, series])
    session.flush()

    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。", workspace_id=workspace.id)
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content=None)
    session.add(scene)
    session.flush()
    character = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan-phase4",
        name="林岚",
        status="active",
        payload={"关系": "信任副官", "必须包含事实": ["左臂受伤"]},
        version=1,
    )
    style = Asset(
        book_id=book.id,
        scene_id=None,
        asset_type="style_rule",
        lineage_key="style-restraint-phase4",
        name="克制文风",
        status="active",
        payload={"规则": "保持克制而具画面感"},
        version=1,
    )
    job = JobRun(book_id=book.id, scene_id=scene.id, job_type="generation_runtime", status="queued", progress={})
    session.add_all([character, style, job])
    session.commit()

    source = create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            series_id=series.id,
            source_type="reference_doc",
            title="港口谈判资料",
            content_text="灯塔信号每七分钟重复一次。林岚必须隐藏伤势。旧协议决定谈判窗口。",
            payload={"origin": "upload"},
        ),
    )
    assert source.chunk_count >= 1

    refresh_run = create_retrieval_refresh_run(session, RetrievalRefreshRunCreate(source_id=source.id))
    assert refresh_run.chunk_count >= 1

    hits = search_retrieval(
        session,
        RetrievalSearchCreate(book_id=book.id, query="灯塔信号 旧协议", limit=3),
    )
    assert hits
    assert hits[0].book_id == book.id
    assert hits[0].series_id == series.id
    assert hits[0].rank == 1
    assert hits[0].score >= hits[-1].score

    packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚在港口谈判中争取维修窗口。",
            active_asset_ids=[character.id, style.id],
            token_budget=220,
            user_intent="优先利用检索资料，不手工传 retrieval_snippets。",
            retrieval_snippets=[],
        ),
    )
    assert packet.packet["检索命中"]
    retrieval_evidence = [link for link in packet.evidence_links if link.evidence_type == "retrieval_hit"]
    assert retrieval_evidence
    assert retrieval_evidence[0].score is not None
    assert retrieval_evidence[0].rank == 1

    prompt_pack = create_prompt_pack(
        session,
        PromptPackCreate(
            workspace_id=workspace.id,
            book_id=book.id,
            pack_type="draft_writer",
            name="克制写作包",
            payload={"system": "保持克制", "forbidden": ["作者直接解释"], "scenes": ["谈判"]},
        ),
    )
    updated_pack = update_prompt_pack(
        session,
        prompt_pack.id,
        PromptPackUpdate(
            payload={"system": "保持克制而具画面感", "forbidden": ["作者直接解释"], "scenes": ["谈判", "复盘"]}
        ),
    )
    assert updated_pack.version == 2
    assert [item.version for item in get_prompt_pack_history(session, prompt_pack.id)] == [1, 2]

    model_run = record_runtime_model_run(
        session,
        workspace_id=workspace.id,
        book_id=book.id,
        scene_id=scene.id,
        job_run_id=job.id,
        prompt_pack_id=updated_pack.id,
        provider_name="mock-provider",
        model_name="storyforge-writer",
        capability="llm",
        latency_ms=180,
        token_usage=96,
        input_summary="生成港口谈判场景。",
        output_summary="模型返回首稿摘要。",
        payload={"resolved_provider": "mock-provider"},
    )
    assert model_run.prompt_pack_id == updated_pack.id
    assert len(list_model_runs(session, job_run_id=job.id)) == 1

    updated_job = sync_job_run_with_runtime(
        session,
        job_run_id=job.id,
        thread_id="phase4-thread",
        current_node="draft_writer",
        status="running",
        approval_status="pending",
        provider_execution={"provider_name": "mock-provider", "model_name": "storyforge-writer"},
    )
    assert updated_job.progress["thread_id"] == "phase4-thread"
    assert updated_job.progress["provider_execution"]["provider_name"] == "mock-provider"


def test_phase4_artifact_and_evaluation_service_flow(session: Session) -> None:
    """导出物、上传资料、工作流快照、评测报告与评测指标都能进入 Phase 4 闭环。"""

    workspace = Workspace(title="Phase4 制品验收", slug="phase4-artifact", status="active", seat_limit=2)
    session.add(workspace)
    session.flush()
    book = Book(title="灯塔余烬", status="approved", premise="林岚追查信号。", workspace_id=workspace.id)
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="approved", summary="林岚抵达港口。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="approved", content="林岚克制地完成港口谈判。")
    session.add(scene)
    session.commit()

    markdown = build_markdown_export(session, book.id)
    assert "# 灯塔余烬" in markdown

    epub_bytes = build_epub_export(session, book.id)
    with ZipFile(BytesIO(epub_bytes)) as epub:
        content = epub.read("OEBPS/content.xhtml").decode("utf-8")
    assert "灯塔余烬" in content

    create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace.id,
            book_id=book.id,
            artifact_type="upload",
            lineage_key="phase4-upload",
            name="灯塔港设定附件",
            storage_uri="memory://uploads/lighthouse-archive.txt",
            mime_type="text/plain",
            size_bytes=128,
            payload={"purpose": "reference"},
        ),
    )
    create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace.id,
            book_id=book.id,
            artifact_type="workflow_snapshot",
            lineage_key="phase4-runtime-snapshot",
            name="运行时断点快照",
            storage_uri="memory://workflow/phase4-thread/checkpoint.json",
            mime_type="application/json",
            size_bytes=256,
            payload={"thread_id": "phase4-thread", "current_node": "draft_writer"},
        ),
    )

    case = create_evaluation_case(
        session,
        EvaluationCaseCreate(
            workspace_id=workspace.id,
            book_id=book.id,
            case_name="港口谈判一致性基准",
            case_type="consistency",
            input_payload={"scene_count": 2},
            expected_payload={"open_loop_count": 1},
        ),
    )
    run = create_evaluation_run(
        session,
        EvaluationRunCreate(
            case_id=case.id,
            observed_payload={
                "scene_count": 2,
                "open_issue_count": 1,
                "repair_attempts": 2,
                "repair_accepted": 1,
                "suggestions_total": 4,
                "suggestions_accepted": 2,
                "open_loop_count": 1,
            },
        ),
    )
    assert run.metrics["consistency_error_rate"] == 0.5
    assert run.metrics["repair_success_rate"] == 0.5
    assert run.metrics["user_acceptance_rate"] == 0.5

    create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace.id,
            book_id=book.id,
            artifact_type="evaluation_report",
            lineage_key=f"evaluation-report:{run.id}",
            name="港口谈判评测报告",
            storage_uri=f"memory://evaluations/{run.id}/report.json",
            mime_type="application/json",
            size_bytes=512,
            payload={"evaluation_run_id": run.id, "metrics": run.metrics},
        ),
    )

    artifact_types = {artifact.artifact_type for artifact in list_artifacts(session, workspace_id=workspace.id, book_id=book.id)}
    assert {"export", "upload", "workflow_snapshot", "evaluation_report"}.issubset(artifact_types)
    assert len(list_evaluation_runs(session, workspace_id=workspace.id, book_id=book.id)) == 1
