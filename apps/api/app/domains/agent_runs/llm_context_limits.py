"""Snapshot selection and legacy Assistant bundle delivery budgets."""

SNAPSHOT_VERSION = 1
SELECTED_FILE_TEXT_LIMIT = 12000
CONTEXT_FILE_TEXT_LIMIT = 2000
MEMORY_TEXT_LIMIT = 800
REVIEW_TEXT_LIMIT = 600
MAX_CONTEXT_FILES = 8
MAX_REVIEW_ISSUES = 12
MAX_STORY_MEMORY_ITEMS = 8
# AssistantContextBundle's existing limits; structured knowledge has a 4000-char retrieval budget.
PROMPT_EXCERPT_TEXT_LIMIT = 4000
MAX_PROMPT_CONTEXT_FILES = 12
