from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.assistant.models import AssistantMessage, AssistantSession


def seed_history(session: Session, count: int = 16, *, project_path: str | None = None) -> tuple[AssistantSession, AgentRun]:
    conversation = AssistantSession(
        title="保真压缩", task_type="ide_agent_orchestration", project_path=project_path,
        messages=[AssistantMessage(
            role="user" if i % 2 == 0 else "assistant",
            content=f"消息{i}：" + ("不要杀死林岚，否决悲剧结局。" if i == 0 else "保留悬念，待确认修改。"),
        ) for i in range(count)],
    )
    session.add(conversation)
    session.commit()
    run = AgentRun(
        public_id=f"run-compaction-{conversation.id}", session_id="compaction",
        assistant_session_id=conversation.id, goal="审稿", scope={}, budget={}, root_plan=[],
    )
    session.add(run)
    session.commit()
    return conversation, run


class SummaryProvider:
    def __init__(self, *, finish_reason: str = "stop", invalid_ref: bool = False) -> None:
        self.finish_reason = finish_reason
        self.invalid_ref = invalid_ref
        self.requests = []

    def complete(self, request):  # noqa: ANN001, ANN201
        from app.platform.ai_sdk import ChatResponse, TokenUsage

        self.requests.append(request)
        data = json.loads(request.messages[-1].content)
        return ChatResponse(
            content=json.dumps({"entries": [{
                "category": "unfinished", "text": "继续核验作者约束与待确认修改。",
                "source_id": "message:999999" if self.invalid_ref else source["key"],
                "quote": source["content"][:24],
            } for source in data["new_sources"]]}, ensure_ascii=False),
            finish_reason=self.finish_reason,
            usage=TokenUsage(input_tokens=100, output_tokens=30, source="provider"),
        )


def persist_checkpoint(session: Session, conversation: AssistantSession, run: AgentRun) -> AgentArtifact:
    from app.domains.agent_runs.compaction import create_compaction_checkpoint

    payload = create_compaction_checkpoint(session, conversation.id, provider=SummaryProvider(), model="fake")
    assert payload is not None
    artifact = AgentArtifact(run_id=run.id, kind="system_compaction", payload=payload)
    session.add(artifact)
    session.commit()
    return artifact

