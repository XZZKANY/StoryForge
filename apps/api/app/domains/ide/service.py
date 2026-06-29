from __future__ import annotations

from app.domains.ide._coerce import (  # noqa: F401  facade re-export
    _context_href,
    _int_or_none,
    _string_or_none,
)
from app.domains.ide.artifact_preview import (  # noqa: F401  facade re-export
    _artifact_preview_content,
    _artifact_trace,
    _book_run_id_from_lineage,
    _first_chapter_trace,
    get_artifact_preview,
)
from app.domains.ide.command_registry import (  # noqa: F401  facade re-export
    _BUILTIN_COMMANDS,
    IdeCommandDefinition,
    IdeCommandExecutionError,
    IdeCommandNotFoundError,
    _accepted_command_result,
    _attach_persistent_audit_event,
    _execute_bookrun_command,
    _execute_judge_approve_command,
    _execute_judge_repair_command,
    _execute_judge_run_command,
    _optional_reason,
    _required_book_run_id,
    _resolve_audit_workspace_id,
    execute_ide_command_by_id,
)
from app.domains.ide.context_snapshot import (  # noqa: F401  facade re-export
    _context_block_ref,
    get_context_snapshot,
)
from app.domains.ide.run_events import (  # noqa: F401  facade re-export
    _tokens_remaining,
    build_run_events,
    encode_sse_event,
)
from app.domains.ide.story_memory_query import (  # noqa: F401  facade re-export
    _conflict_ids_by_memory,
    _memory_active_at,
    _story_memory_conflict,
    _story_memory_item,
    query_story_memory,
)
from app.domains.ide.workspace_reads import (  # noqa: F401  facade re-export
    _diagnostic_severity,
    get_workspace_tree,
    list_diagnostics_for_scene,
    read_ide_scene,
)
