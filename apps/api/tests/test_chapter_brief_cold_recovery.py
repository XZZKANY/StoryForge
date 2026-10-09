"""Restart the public Brief confirmation path without replacing its source baseline."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from test_chapter_brief_source_binding import begin
from test_continue_knowledge_recovery import knowledge_entry

from app.db.base import Base
from app.domains.agent_runs.fs import render_knowledge_entry
from app.domains.assistant import service as assistant_service


@pytest.mark.parametrize("drift", ["none", "new_selection"])
def test_fresh_process_confirms_only_the_original_brief_sources(tmp_path, monkeypatch, drift):
    project = tmp_path / "novel"
    materials = project / ".资料"
    materials.mkdir(parents=True)
    (materials / "原规则.md").write_text(
        render_knowledge_entry(knowledge_entry(title="写第一章的门锁规则")), encoding="utf-8"
    )
    target = project / "第001章.md"
    target.write_text("", encoding="utf-8")
    database = tmp_path / "brief.sqlite3"
    engine = create_engine(f"sqlite+pysqlite:///{database}", poolclass=NullPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(assistant_service, "chat_reply", lambda *_args, **_kwargs: {"reply": '{"goal":"建立冲突"}'})
    try:
        with Session(engine) as worker:
            _, initial = begin(worker, project, target, {"project_root": str(project), "files": []})
            assert initial["runtime_interruption"]["status"] == "paused"
    finally:
        engine.dispose()
    if drift == "new_selection":
        (materials / "新规则.md").write_text(
            render_knowledge_entry(
                knowledge_entry(
                    id="pk_00000000-0000-4000-8000-000000000002",
                    title="写第一章门锁的新限制",
                    claim="写第一章门锁时，门后的人还没有离开。",
                )
            ),
            encoding="utf-8",
        )
    cold = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8",
            "-c",
            """
import json,sys
sys.path.insert(0,'tests')
from chapter_check_test_support import chapter_check_reply
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from app import models
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
from app.domains.agent_runs.service import AgentRuntimeError,handle_agent_control_message
from app.domains.assistant import service as assistant_service
calls=[]
def writer(_source, *, system_prompt,user_prompt):
    calls.append('writer')
    return {'content':'一'*1800}
assistant_service.missing_llm_env=lambda: []
assistant_service.resolved_llm_env=lambda: {'STORYFORGE_LLM_MODEL':'fake-model'}
assistant_service._call_llm_streamed=writer
assistant_service.chat_reply=lambda _session, **kwargs: chapter_check_reply(kwargs['user_message'],[])
engine=create_engine(sys.argv[1])
with Session(engine) as session:
    pending=session.scalars(select(AgentArtifact).where(AgentArtifact.kind==RUNTIME_PENDING_CALL_ARTIFACT_KIND)).one()
    try:
        control=handle_agent_control_message(session,public_id='brief-source-run',session_id='session-brief-source-run',control_type='resume_run',payload={'chapter_brief':pending.payload['chapter_brief']})
        result={'resumed':control.resumed_result is not None,'requires_confirmation':control.resumed_result['proposed_patch']['requires_confirmation']}
    except AgentRuntimeError as exc:
        result={'resumed':False,'error':str(exc)}
    print('BRIEF_JSON='+json.dumps({**result,'writer_calls':len(calls)}))
engine.dispose()
""",
            f"sqlite+pysqlite:///{database}",
        ],
        capture_output=True,
        encoding="utf-8",
        timeout=40,
    )
    assert cold.returncode == 0, cold.stderr
    result = json.loads(
        next(line.split("=", 1)[1] for line in cold.stdout.splitlines() if line.startswith("BRIEF_JSON="))
    )
    if drift == "none":
        assert result["resumed"] and result["requires_confirmation"] and result["writer_calls"] == 1
    else:
        assert not result["resumed"] and result["writer_calls"] == 0
        assert "来源" in result["error"] and "变化" in result["error"]
    assert target.read_text(encoding="utf-8") == ""
