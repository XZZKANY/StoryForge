from __future__ import annotations

import logging

from app.domains.story_memory.arbitration import (  # noqa: F401  facade re-export
    _build_conflict,
    _ranges_overlap,
    apply_arbitration_decision,
    arbitrate_proposal,
    detect_memory_conflicts,
)
from app.domains.story_memory.atoms import (  # noqa: F401  facade re-export
    _is_active,
    _memory_atom_default_order,
    _memory_atom_embedding,
    _memory_atom_embedding_text,
    _record_to_atom,
    atoms_active_at_chapter,
    create_memory_atom,
    get_active_memory_atoms,
    list_memory_atoms,
)
from app.domains.story_memory.errors import (  # noqa: F401  facade re-export
    ForeshadowLifecycleConflictError,
    ForeshadowLifecycleTransitionError,
    StoryMemoryInputError,
)
from app.domains.story_memory.extract import (  # noqa: F401  facade re-export
    _append_chapter_summary_atom,
    _append_collection_atoms,
    _bool_value,
    _confidence,
    _first_text,
    _mapping_items,
    _memory_extract_atom,
    _memory_extract_atom_payloads,
    _optional_positive_int,
    write_memory_extract_atoms,
)
from app.domains.story_memory.foreshadow_lifecycle import (  # noqa: F401  facade re-export
    _FORESHADOW_ALLOWED_TRANSITIONS,
    _FORESHADOW_ENTITY_TYPE,
    _FORESHADOW_FACT_TYPE,
    _FORESHADOW_LIFECYCLE_KIND,
    _dump_lifecycle_snapshot,
    _ensure_foreshadow_transition_allowed,
    _foreshadow_source_ref,
    _load_lifecycle_snapshot,
    _require_lifecycle_refs,
    _resolve_foreshadow_target,
    apply_foreshadow_lifecycle_transition,
    list_foreshadow_lifecycle,
)
from app.domains.story_memory.recall import (  # noqa: F401  facade re-export
    DEFAULT_MEMORY_PGVECTOR_DIMENSIONS,
    DEFAULT_MEMORY_VECTOR_CANDIDATE_MULTIPLIER,
    DEFAULT_MEMORY_VECTOR_MIN_CANDIDATES,
    MemoryRecallScore,
    _append_term,
    _apply_memory_pgvector_candidate_order,
    _get_active_memory_atom_candidates,
    _keyword_memory_score,
    _load_memory_atom_candidates,
    _memory_atom_matches_scene,
    _memory_pgvector_dimensions,
    _memory_query_embedding,
    _memory_recall_sort_key,
    _memory_vector_candidate_limit,
    _pgvector_literal,
    _positive_int_env,
    _scene_memory_terms,
    _score_scene_memory_atoms,
    _semantic_memory_scores,
    _term_rank,
    recall_scene_memory_atoms,
)

logger = logging.getLogger(__name__)
