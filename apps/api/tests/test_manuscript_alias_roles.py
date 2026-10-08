"""Canon role filtering must agree with existing resolved-role manuscript discovery."""

from __future__ import annotations

import errno
from pathlib import Path

import pytest
from agent_canon_test_support import _write_canon

from app.common.manuscript import iter_manuscript_files, previous_chapter_tail
from app.domains.agent_runs.canon_rebuild import chapter_ordinals
from app.domains.assistant import service
from app.domains.assistant.schemas import AssistantDraftRequest


def link(alias: Path, target: Path) -> None:
    alias.parent.mkdir(parents=True, exist_ok=True)
    try:
        alias.symlink_to(target)
    except NotImplementedError:
        pytest.skip("File symlink unavailable on this platform")
    except OSError as exc:
        if (
            exc.errno in {errno.EPERM, errno.EACCES, errno.ENOSYS, errno.ENOTSUP}
            or getattr(exc, "winerror", None) == 1314
        ):
            pytest.skip("File symlink unavailable on this filesystem")
        raise


def excluded_alias(root: Path, relative: str) -> Path:
    material = root / relative
    material.parent.mkdir(parents=True, exist_ok=True)
    material.write_text("REFERENCE_ONLY：这段是创作材料，不是已经发生的正文。")
    link(root / "正文/第000章.md", material)
    return root / "正文/第001章.md"


@pytest.mark.parametrize("relative", ["设定/世界.md", "灵感.md", ".storyforge/agent-instructions.md"])
def test_alias_to_non_manuscript_does_not_consume_a_canon_chapter(tmp_path, relative):
    target = excluded_alias(tmp_path, relative)
    target.write_text("第一章正文。")
    assert [p.relative_to(tmp_path).as_posix() for p in iter_manuscript_files(tmp_path)] == ["正文/第001章.md"]
    assert chapter_ordinals(str(tmp_path), "*.md") == {"正文/第001章.md": 1}
    assert previous_chapter_tail(str(tmp_path), str(target)) is None


@pytest.mark.parametrize("relative", ["设定/世界.md", "灵感.md", ".storyforge/agent-instructions.md"])
def test_actual_draft_uses_first_window_without_counting_reference_alias(session, tmp_path, monkeypatch, relative):
    target = excluded_alias(tmp_path, relative)
    _write_canon(
        tmp_path,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "铜钥匙", "holder": "FIRST_OWNER", "from_chapter": 1, "to_chapter": 1},
                    {"item": "铜钥匙", "holder": "LATER_OWNER", "from_chapter": 2},
                ]
            },
        },
    )
    calls = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})

    def writer(_source, *, system_prompt, user_prompt):
        calls.append({"system": system_prompt, "user": user_prompt})
        return {"content": "第一章正文。"}

    monkeypatch.setattr(service, "_call_llm_streamed", writer)
    service.draft_file_content(
        session, AssistantDraftRequest(file_path=str(target), project_root=str(tmp_path), instruction="写第一章。")
    )
    assert len(calls) == 1
    assert "FIRST_OWNER" in calls[0]["user"]
    assert "LATER_OWNER" not in calls[0]["user"]
    assert "REFERENCE_ONLY" not in calls[0]["user"]
    assert not target.exists()
