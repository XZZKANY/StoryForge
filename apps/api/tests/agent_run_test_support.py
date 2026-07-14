from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent


def _seed_agent_run(session: Session, public_id: str = "run-low-level-events") -> AgentRun:
    run = AgentRun(
        public_id=public_id,
        session_id=f"session-{public_id}",
        goal="验证 AgentRun 底层事件顺序。",
        scope={},
        permission_profile="risk_confirm",
        budget={},
        status="running",
        root_plan=[],
        current_step=None,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def _stored_run_events(session: Session, run: AgentRun) -> list[AgentRunEvent]:
    return list(session.query(AgentRunEvent).filter_by(run_id=run.id).order_by(AgentRunEvent.sequence, AgentRunEvent.id))


def _stored_run_artifacts(session: Session, run: AgentRun) -> list[AgentArtifact]:
    return list(session.query(AgentArtifact).filter_by(run_id=run.id).order_by(AgentArtifact.id))


def _seed_chapter_review_scene_packet(session: Session) -> dict[str, int | str]:
    from app.domains.books.models import Book, Chapter, Scene
    from app.domains.continuity.models import ScenePacket

    content = "林岚举起左臂，旁人看见左臂完好无损。作者直接解释这说明她早已摆脱旧伤。"
    book = Book(title="灯塔余烬", status="draft", premise="林岚在港口追查灯塔信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content=content)
    session.add(scene)
    session.flush()
    packet = ScenePacket(
        scene_id=scene.id,
        status="assembled",
        packet={
            "必须包含事实": ["左臂受伤"],
            "风格规则": ["克制"],
            "证据链接": [{"source_ref": "asset://character/lin-lan#v1", "rationale": "角色资产要求左臂仍受伤。"}],
        },
        version=1,
    )
    session.add(packet)
    session.commit()
    return {"scene_packet_id": packet.id, "content": content}
