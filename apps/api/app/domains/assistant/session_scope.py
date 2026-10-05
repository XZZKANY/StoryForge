"""Canonical project ownership checks shared by writing and live chat."""

from __future__ import annotations

import os
from pathlib import Path

from app.common.exceptions import ConflictError
from app.domains.assistant.models import AssistantSession


def assert_session_project_matches(assistant_session: AssistantSession, project_root: str | None) -> None:
    owned = assistant_session.project_path
    if not owned and not project_root:
        return  # Projectless conversations remain projectless.
    if not owned or not project_root:
        raise ConflictError("Assistant 会话归属未绑定当前项目，请新建项目会话。")
    try:
        matches = os.path.normcase(str(Path(owned).resolve())) == os.path.normcase(str(Path(project_root).resolve()))
    except (OSError, ValueError):
        matches = False
    if not matches:
        raise ConflictError("Assistant 会话归属冲突，请使用当前项目的会话。")
