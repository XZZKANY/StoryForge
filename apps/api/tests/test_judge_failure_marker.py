from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common import llm_client
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import JUDGE_SYSTEM_FAILURE_CATEGORY, create_judge_issues


def test_create_judge_issues_injects_failure_marker_when_semantic_judge_fails(session: Session, monkeypatch) -> None:
    """语义评审调用失败时，create_judge_issues 应注入 judge_system_failure 标记问题。"""

    book = Book(title="测试书", status="draft", premise="测试")
    session.add(book)
    session.commit()
    session.refresh(book)

    chapter = Chapter(book_id=book.id, ordinal=1, title="测试章节", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="测试场景",
        status="approved",
        content="这段正文没有违规内容。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)

    scene_packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"test": True},
        version=1,
    )
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    # 模拟语义评审调用失败（网络超时）
    def failing_llm_request(*args, **kwargs):
        raise RuntimeError("Server disconnected without sending a response.")

    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_MODEL", "gpt-5.4")

    monkeypatch.setattr(llm_client, "_request_chat_completions", failing_llm_request)

    payload = JudgeIssueCreate(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        content=scene.content or "",
        required_facts=[],
        style_rules=["保持克制悬疑语气"],
        evidence_links=[],
    )

    issues = create_judge_issues(session, payload)

    # 应该有且仅有一个 judge_system_failure 标记问题
    failure_markers = [issue for issue in issues if issue.issue_type == JUDGE_SYSTEM_FAILURE_CATEGORY]
    assert len(failure_markers) == 1, f"应有 1 个失败标记，实际 {len(failure_markers)}"

    marker = failure_markers[0]
    assert marker.severity == "high", "失败标记应为 high 严重性"
    assert "语义评审调用失败" in marker.description, "失败标记描述应说明调用失败"
    assert marker.payload.get("recommended_repair_mode") == "none", "失败标记不应被修复"
    assert marker.payload.get("judge_degraded") is True, "失败标记应携带 judge_degraded 元数据"


def test_create_judge_issues_no_failure_marker_when_api_key_missing(session: Session) -> None:
    """未配置 API Key 时不应注入失败标记（属于"未启用"而非失败）。"""

    book = Book(title="测试书", status="draft", premise="测试")
    session.add(book)
    session.commit()
    session.refresh(book)

    chapter = Chapter(book_id=book.id, ordinal=1, title="测试章节", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="测试场景",
        status="approved",
        content="这段正文没有违规内容。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)

    scene_packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"test": True},
        version=1,
    )
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    payload = JudgeIssueCreate(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        content=scene.content or "",
        required_facts=[],
        style_rules=["保持克制悬疑语气"],
        evidence_links=[],
    )

    issues = create_judge_issues(session, payload)

    # 未配置 API Key 时不应有失败标记
    failure_markers = [issue for issue in issues if issue.issue_type == JUDGE_SYSTEM_FAILURE_CATEGORY]
    assert len(failure_markers) == 0, "未配置 API Key 时不应有失败标记"
