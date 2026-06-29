# StoryForge Context

## Project

StoryForge is a Desktop IDE-first AI writing workbench for long-form fiction. The product direction is "Cursor for Fiction": authors open a local novel project, ask an Agent to review or revise files, inspect a diff, confirm the write-back, and keep version history.

The project keeps a verifiable long-form generation pipeline, but that pipeline is a backend tool and heavy engine, not the primary product surface.

## Current Truth

- **Desktop IDE** is the main product experience under `apps/desktop`.
- **API** is the business truth source under `apps/api`.
- **Workflow** owns long-running generation, provider calls, checkpoints, and quality gates under `apps/workflow`.
- **BookRun** is the auditable whole-book generation run. It can generate, judge, repair, write memory, and export artifacts.
- **Desktop IDE Agent** is the local project assistant path: open file, review, targeted revision, proposed patch, diff confirmation, real write-back, version record.
- **OpenAPI contract** is the hard seam from API to clients. Backend route changes must refresh `packages/shared/src/contracts/storyforge.openapi.json`.
- **Web** has exited. Do not add or maintain `apps/web` as a product entry.

## Domain Glossary

- **Novel project**: a local writing workspace opened by the Desktop IDE.
- **Manuscript file**: a user-authored text file inside a novel project.
- **Agent conversation**: the Desktop IDE interaction where the user asks for review, revision, or project assistance.
- **Issue**: a stable review finding produced by the Agent, often targeted by later revision.
- **Proposed patch**: an Agent-produced edit that must be inspected before write-back.
- **Diff confirmation**: the user approval step before a proposed patch mutates a manuscript file.
- **Version record**: local evidence of a write-back so the author can audit changes.
- **BookRun**: a long-running generation workflow for a whole book or chapter batch.
- **ModelRun**: recorded evidence for a model invocation or model-backed step.
- **Provider Gateway**: the seam for real model providers and deterministic/mock providers.
- **Judge**: quality review logic that evaluates generated or revised text.
- **Repair**: targeted correction logic driven by Judge findings.
- **Story Memory**: persistent extracted facts for continuity.
- **Artifact**: exported Markdown, EPUB, audit report, or related output.
- **Audit evidence**: durable proof of inputs, steps, outputs, checks, and decisions.

## Architecture Rules

- API decisions belong in FastAPI routes, domain modules, and service logic; clients should not invent business conclusions.
- Desktop owns local file UX and confirmation ergonomics; it should call API or Tauri commands for durable effects.
- Workflow owns long tasks and model-provider uncertainty; API should keep transaction boundaries crisp.
- Tests and callers should cross meaningful module interfaces, not private implementation details.
- Missing data should surface as an explicit error, not a fake fallback object.
- Real provider secrets must stay in local environment variables and never enter committed logs or docs.
