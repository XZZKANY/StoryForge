# Domain Docs

How engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/architecture/`** for StoryForge architecture plans and module decisions.
- **`docs/internal/current-phase.md`** for current project truth.
- **`docs/adr/`** if it exists in the future.

If any of these files do not exist, proceed silently. Do not flag their absence unless the task specifically asks for documentation cleanup.

## File structure

This is a single-context repo:

```text
/
├── CONTEXT.md
├── CLAUDE.md
├── docs/
│   ├── agents/
│   ├── architecture/
│   └── internal/
├── apps/
│   ├── api/
│   ├── desktop/
│   └── workflow/
└── packages/
    └── shared/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept needed is not in the glossary yet, either reconsider the term or note it for a later docs update.

## Flag architecture conflicts

If output contradicts an existing architecture decision under `docs/architecture/`, surface it explicitly rather than silently overriding it.
