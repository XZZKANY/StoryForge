from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.common import author_voice
from app.common.llm_client import LLMError
from app.common.llm_config_file import LlmConfigError
from app.db.base import Base
from app.domains.assistant import service
from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
from app.domains.assistant.schemas import AssistantReviseRequest, AssistantSessionCreate


@pytest.fixture()
def revision_sessions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[sessionmaker[Session]]:
    # File SQLite gives observers separate connections, unlike the suite's StaticPool fixture.
    engine = create_engine(f"sqlite:///{tmp_path / 'revision.sqlite'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fixture-model"})
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    try:
        yield sessionmaker(bind=engine, expire_on_commit=False)
    finally:
        engine.dispose()


def _messages(session: Session) -> list[tuple[str, str]]:
    return [(row.role, row.content) for row in session.scalars(select(AssistantMessage).order_by(AssistantMessage.id))]


@pytest.mark.parametrize("existing", [False, True])
def test_revision_preserves_committed_message_and_evidence_order(revision_sessions, monkeypatch, existing):
    session_id = None
    if existing:
        with revision_sessions() as session:
            session_id = service.create_assistant_session(
                session, AssistantSessionCreate(title="existing", task_type="chat")
            ).id
    request = AssistantReviseRequest(
        file_path="draft.md", content="原文。", instruction="修订第一句", assistant_session_id=session_id
    )
    counts = {"commit": 0, "model": 0}
    engine = revision_sessions.kw["bind"]
    event.listen(engine, "commit", lambda _conn: counts.__setitem__("commit", counts["commit"] + 1))
    seen_ids = []
    usage = {
        "prompt_tokens": 0,
        "completion_tokens": None,
        "token_usage": {"cache_hit_tokens": 0},
        "cost_cny_estimated": 0.0,
        "cost_breakdown": {"input": 0},
        "token_usage_source": "provider",
        "latency_ms": 7,
    }

    def generate(source, *, system_prompt, user_prompt):
        counts["model"] += 1
        assert source["STORYFORGE_LLM_MODEL"] == "fixture-model"
        assert "修订第一句" in user_prompt
        # User/running-tool commits retain their order; the final-source receipt
        # adds one short committed transaction before the provider call.
        assert counts["commit"] == 3
        with revision_sessions() as observer:
            assert _messages(observer) == [("user", request.instruction)]
            tool = observer.scalars(select(AssistantToolCall)).one()
            assert (tool.tool_name, tool.status) == ("assistant.revise", "running")
            assert tool.input_summary["generation_sources"]["request"] == {
                "system_sha256": hashlib.sha256(system_prompt.encode()).hexdigest(),
                "user_sha256": hashlib.sha256(user_prompt.encode()).hexdigest(),
            }
            seen_ids.append(tool.id)
        return {"content": "修订后的正文。", **usage, "reasoning_leak_stripped": True, "native_body": "not-evidence"}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    with revision_sessions() as session:
        result = service.revise_file_content(session, request)
    assert counts == {"commit": 5, "model": 1}
    assert result.model_dump() == {
        "before": "原文。",
        "after": "修订后的正文。",
        "summary": "已按指令修订 draft.md，修订后约 7 字。",
        "model": "fixture-model",
        "latency_ms": 7,
        "completion_tokens": None,
        "assistant_session_id": result.assistant_session_id,
    }
    if existing:
        assert result.assistant_session_id == session_id
    with revision_sessions() as observer:
        assert observer.scalar(select(func.count()).select_from(AssistantSession)) == 1
        assert _messages(observer) == [("user", request.instruction), ("assistant", result.summary)]
        tool = observer.scalars(select(AssistantToolCall)).one()
        assert tool.id == seen_ids[0]
        assert tool.status == "completed"
        assert tool.output_summary == {"after_chars": 7, **usage, "reasoning_leak_stripped": True}


@pytest.mark.parametrize("failure", ["model", "quality", "preparation"])
def test_revision_failure_survives_outer_rollback(revision_sessions, monkeypatch, failure):
    original = "他推开门。他看见灯。他没有出声。他转身离开。他走进雨里。"
    request = AssistantReviseRequest(file_path="draft.md", content=original, instruction="润色", quality_gate="polish")
    calls = []

    def generate(*_args, **_kwargs):
        calls.append(True)
        if failure == "model":
            raise LLMError("fixture upstream failure")
        return {"content": original.replace("他", "我")}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    if failure == "preparation":

        def fail_preparation(*_args):
            raise LLMError("fixture preparation failure")

        monkeypatch.setattr(service, "build_generation_system_prompt", fail_preparation)
    error = service.AssistantReviseQualityGateError if failure == "quality" else service.AssistantReviseError
    with revision_sessions() as session:
        with pytest.raises(error):
            service.revise_file_content(session, request)
        session.rollback()
    assert len(calls) == (0 if failure == "preparation" else 1)
    with revision_sessions() as observer:
        assert _messages(observer) == [("user", request.instruction)]
        tool = observer.scalars(select(AssistantToolCall)).one()
        assert (tool.tool_name, tool.status) == ("assistant.revise", "failed")
        if failure == "quality":
            gate = tool.output_summary["quality_gate"]
            assert gate["passed"] is False
            assert gate["version"] == "polish-gates-v2"
            assert "narrative_person_changed" in gate["reasons"]
            assert "candidate_chars" in gate["metrics"]
        else:
            assert tool.output_summary == {
                "cost_cny_estimated": None,
                "cost_breakdown": {},
            }
            assert "failure" in tool.error_message


@pytest.mark.parametrize("failure", ["missing_config", "broken_config", "missing_session"])
def test_revision_preflight_failure_has_no_new_records(revision_sessions, monkeypatch, failure):
    def unexpected_model(*_args, **_kwargs):
        pytest.fail("preflight must not invoke generation")

    monkeypatch.setattr(service, "_call_llm_streamed", unexpected_model)
    if failure == "missing_config":
        monkeypatch.setattr(service, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_MODEL"])
        error = service.AssistantLlmNotConfiguredError
    elif failure == "broken_config":

        def broken_config():
            raise LlmConfigError("fixture broken config")

        monkeypatch.setattr(service, "resolved_llm_env", broken_config)
        error = LlmConfigError
    else:
        error = service.AssistantSessionNotFoundError
    request = AssistantReviseRequest(
        file_path="draft.md",
        content="原文",
        instruction="修订",
        assistant_session_id=999 if failure == "missing_session" else None,
    )
    with revision_sessions() as session:
        with pytest.raises(error):
            service.revise_file_content(session, request)
        session.rollback()
    with revision_sessions() as observer:
        for model in (AssistantSession, AssistantMessage, AssistantToolCall):
            assert observer.scalar(select(func.count()).select_from(model)) == 0


def test_revision_prepares_author_context_at_original_side_effect_boundary(revision_sessions, monkeypatch, tmp_path):
    project = tmp_path / "project"
    (project / ".storyforge").mkdir(parents=True)
    (project / ".storyforge" / "agent-instructions.md").write_text("作者约束：保留冷静语气。", encoding="utf-8")
    phases = []

    def constraints(root, file_path):
        phases.append("canon")
        with revision_sessions() as observer:
            assert observer.scalar(select(func.count()).select_from(AssistantSession)) == 0
        assert root == str(project)
        return "场景约束：周眠怕水。"

    def style(base, root):
        phases.append("style")
        with revision_sessions() as observer:
            assert observer.scalars(select(AssistantToolCall.status)).one() == "running"
        return base + "\n文风基线：短句。"

    def generate(_source, *, system_prompt, user_prompt):
        phases.append("generate")
        assert system_prompt.index("未点名") < system_prompt.index("文风基线") < system_prompt.index("作者约束")
        assert "只输出修订后的完整正文" in system_prompt
        metadata = re.search(r"\n\n### Context Sources\n- 类型：context_sources\n<<<CONTEXT\n(.*?)\nCONTEXT>>>", user_prompt, re.DOTALL)
        assert metadata is not None
        refs = [json.loads(line) for line in metadata[1].splitlines() if line.startswith("{")]
        assert len(refs) == 1 and refs[0]["relative_path"] == "人物/周眠.md"
        assert refs[0]["source_state"] == "current" and refs[0]["disposition"] == "delivered"
        assert user_prompt.replace(metadata[0], "", 1) == (
            "项目：港口\n文件：draft.md\n修订指令：修订窗口\n\n"
            "\n项目上下文摘录：这些文件来自同一小说项目，请用于保持大纲、人物、设定与正文连贯；"
            "如果摘录与当前文件冲突，优先保留明确的当前文件事实，并在修订中避免扩大矛盾。\n"
            "### 人物/周眠.md\n- 类型：character\n<<<CONTEXT\n周眠怕水。\nCONTEXT>>>\n"
            "\n场景约束：周眠怕水。\n"
            + "\n本次编辑政策（writer、后处理与本地候选共用）：\n"
            + json.dumps(
                {
                    "version": "author-edit-v1",
                    "source_sha256": "5bb9640bda412c45f4b69c5c05c01f3a16c2d9c80323848e3506a4e5400c08b5",
                    "author_requirement_count": 1,
                    "baseline_present": False,
                    "allowed_punctuation_forms": [],
                    "preserve_repeated_marks": False,
                    "allow_person_change": False,
                    "protected_span_count": 0,
                },
                ensure_ascii=False,
            )
            + "\n作者声明的声音与保留要求：\n作者约束：保留冷静语气。\n当前真实作者要求：\n修订窗口\n"
            + "以下是待修订的正文，请按指令修订后整体返回，只返回你收到的这段：\n<<<FILE\n原文窗口。\nFILE>>>"
        )
        return {"content": "修订窗口。"}

    monkeypatch.setattr(service, "_scene_constraints", constraints)
    monkeypatch.setattr(author_voice, "append_style_baseline_to_system_prompt", style)
    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    (project / "人物").mkdir()
    (project / "人物/周眠.md").write_text("周眠怕水。", encoding="utf-8")
    request = AssistantReviseRequest(
        file_path="draft.md",
        content="原文窗口。",
        instruction="修订窗口",
        project_name="港口",
        project_root=str(project),
        context_bundle={
            "project_root": str(project),
            "current_file": "draft.md",
            "files": [
                {
                    "path": str(project / "人物/周眠.md"),
                    "relative_path": "人物/周眠.md",
                    "kind": "character",
                    "title": "周眠",
                    "excerpt": "周眠怕水。",
                }
            ],
            "budget": {"ignored": True},
        },
    )
    with revision_sessions() as session:
        service.revise_file_content(session, request)
    assert phases == ["canon", "style", "generate"]
