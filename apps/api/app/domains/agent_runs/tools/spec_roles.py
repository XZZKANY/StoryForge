from __future__ import annotations

REVIEWER_ROLES = ("plot_reviewer", "character_reviewer", "prose_reviewer", "continuity_reviewer")
REVIEW_ALLOWED_ROLES = ("root_agent", *REVIEWER_ROLES, "repair_agent", "synthesizer")
CONTEXT_ALLOWED_ROLES = (*REVIEW_ALLOWED_ROLES, "context_explorer")
WRITE_ALLOWED_ROLES = ("root_agent", "repair_agent")
BOOKRUN_ALLOWED_ROLES = ("root_agent", "bookrun_agent")
