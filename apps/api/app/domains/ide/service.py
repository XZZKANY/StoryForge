from __future__ import annotations

from app.domains.ide._coerce import _int_or_none  # noqa: F401  facade re-export
from app.domains.ide.command_registry import (  # noqa: F401  facade re-export
    _BUILTIN_COMMANDS,
    IdeCommandDefinition,
    IdeCommandExecutionError,
    IdeCommandNotFoundError,
    _accepted_command_result,
    execute_ide_command_by_id,
)
