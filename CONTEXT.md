# StoryForge Context

## Project

StoryForge is a Desktop IDE-first AI writing workbench for long-form fiction. The product direction is an author-facing writing IDE: authors open a local novel project, ask an Agent to review or revise files, inspect a diff, and either confirm or explicitly authorize project-scoped automatic write-back while keeping version history.

## Current Truth

- **Desktop IDE** under `apps/desktop` is the only product. There is no server.
- **TS engine** under `packages/engine` is the business truth source: agent tool loop, revision / continuation / drafting, IDE commands, knowledge proposals, chapter checks, cross-chapter consistency, semantic judging, and the model-call protocol. It runs in-process inside the desktop WebView; the UI reaches it only through `apps/desktop/frontend/src/lib/api`.
- **Rust host** under `apps/desktop/src-tauri` owns local side effects: project-scoped file reads and atomic writes, the SQLite engine database, model egress (the API key never leaves Rust), shadow-git snapshots, and the close handshake. It starts no backend process.
- **Python backend retired (2026-10-16).** The FastAPI app under `apps/api`, the OpenAPI contract, and the Docker stack were deleted after every module moved to the TS engine (last revision: `5e6f8e58`). Behaviour recorded from Python during the migration is frozen as golden fixtures in `packages/engine/golden/`.
- **Frozen contracts:** stream frames in `packages/engine/golden/agent-ws.schema.json`; the data shapes exchanged between engine and UI in `apps/desktop/frontend/src/lib/api/contracts.ts`.
- **BookRun** (whole-book generation and export) was retired on 2026-10-09; **Web** has exited. Do not reintroduce either as a product entry.

## Domain Glossary

- **Novel project**: a local writing workspace opened by the Desktop IDE; project-level data lives in its `.storyforge/` folder.
- **Manuscript file**: a user-authored chapter file inside a novel project; reading order is path order.
- **Agent conversation**: a project-scoped session in which the author asks for review, revision, drafting, or project assistance.
- **Agent run**: one execution of the agent tool loop, recorded with its event stream in the engine database.
- **Issue**: a stable review finding produced by the Agent, often targeted by later revision.
- **Proposed patch**: an Agent-produced edit; the engine never writes it directly to a manuscript file.
- **Diff confirmation**: the per-patch user approval required by the default `ask` profile; explicitly selected project-scoped `auto` / `full` profiles may skip the click but not guarded write-back.
- **Guarded write-back**: snapshot before write → atomic write → version record, refusing writes when the file drifted on disk.
- **Version record**: local evidence of a write-back so the author can audit and undo changes.
- **Canon**: author-declared facts and invariants under `.storyforge/canon/`, with derived caches the Agent may read but not write.
- **Knowledge proposal**: an Agent-suggested addition to project knowledge, reviewed by the author before it is materialized.
- **Chapter check**: a check run on a drafted chapter, recorded under its session as check history.
- **Judge**: semantic review logic that evaluates generated or revised text; its findings are advisory.
- **Legacy import**: the one-time read-only import of the Python-era database into the engine database.

## 界面用词

2026-10-30 作者定。界面文案（按钮、提示、报错、读屏标签）统一用下面的说法，代码标识符不跟着改。前端由 `apps/desktop/frontend/tests/ui-terminology.test.ts` 守住：含中文的字符串里出现「不再用」一栏的词就红。

| 指什么 | 界面上叫 | 不再用 | 代码里 |
| --- | --- | --- | --- |
| 作者打开的那本书 | 作品（磁盘上的目录叫「作品文件夹」） | 项目、项目目录 | project / projectPath |
| 帮作者写、改、审的那个 | AI | Agent | agent |
| AI 给出、等作者接受的改动 | 修订 | 补丁 | patch / proposed patch |

- 「修改」只当普通动词用（未保存修改、修订里的修改块）；指 AI 给的那份改动时说「修订」。
- 作者 10-30 也定了、还没改完的：「写回 / 写盘 / 落盘」统一说「写进文件」，「diff」统一说「对比」；「正文」指章节的文字，「手稿」只当左栏那个视图的名字，「稿件」按句子分（指章节说「正文」，指任意打开的文件说「文件」），「稿子」随「写进文件」去掉。「原稿」（修订前的原文）和「候选稿」是别的意思，照旧。
- 还没改到的地方：引擎写给模型的提示词、工具说明与工具反馈（模型会照着说「补丁」「写盘」「diff」）；Rust 宿主会露给作者的报错（冒烟自检信息不改）；前端测试替身 `src/lib/writeback-receipt-fixture.ts`（照抄宿主原话，随宿主一起改）。

## Architecture Rules

- Business decisions belong in the TS engine; the UI must not invent business conclusions or import the engine except through `lib/api`.
- Durable side effects go through Rust host commands injected into the engine as ports; the engine does not touch the disk or the network directly.
- Engine database schema changes are append-only migrations in `packages/engine/src/store/schema.ts`.
- Tests and callers should cross meaningful module interfaces, not private implementation details.
- Missing data should surface as an explicit error, not a fake fallback object.
- Real provider secrets stay encrypted on the local machine and never enter committed logs, docs, the WebView, or evidence.
