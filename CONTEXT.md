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

2026-10-30 作者定。界面文案（按钮、提示、报错、读屏标签）统一用下面的说法，代码标识符不跟着改。前端由 `apps/desktop/frontend/tests/ui-terminology.test.ts` 守住：含中文的字符串里出现「不再用」一栏的词就红（英文词按整词、不分大小写查）；个别文件按词豁免，原因写在测试里。

| 指什么 | 界面上叫 | 不再用 | 代码里 |
| --- | --- | --- | --- |
| 作者打开的那本书 | 作品（磁盘上的目录叫「作品文件夹」） | 项目、项目目录 | project / projectPath |
| 帮作者写、改、审的那个 | AI | Agent | agent |
| AI 给出、等作者接受的改动 | 修订 | 补丁 | patch / proposed patch |
| 把修订存进文件 | 写进文件（名词用法说「写入」：写入回执、写入记录） | 写回、写盘、落盘 | writeback |
| 修订前后的比较 | 对比 | diff | diff |
| 章节的文字 / 当前打开的任意文件 | 正文 / 文件 | 稿件、稿子 | manuscript / file |

- 「手稿」只当左栏那个视图的名字；「原稿」（修订前的原文）和「候选稿」是别的意思，照旧。
- 「修改」只当普通动词用（未保存修改、修订里的修改块）；编辑器自己存盘叫「保存」，不叫写进文件。
- Rust 宿主会露给作者的报错也按这张表说（`main.rs` 冒烟自检的诊断信息不改）；前端测试替身照抄宿主原话，两边要逐字一致。
- 引擎喂给对话模型的系统提示词、工具说明、工具反馈，以及会显示给作者的引擎消息，也按这张表说（模型会照着说）。产字与评稿提示词（`craftPromptClause`，修订 / 起草 / 续写 / 审稿 / 章纲模板）没改，改它们要先有对比证据（CLAUDE.md §4）；识别作者输入的匹配词新旧说法都认；只给开发看的运行日志与角色目录不改。

## Architecture Rules

- Business decisions belong in the TS engine; the UI must not invent business conclusions or import the engine except through `lib/api`.
- Durable side effects go through Rust host commands injected into the engine as ports; the engine does not touch the disk or the network directly.
- Engine database schema changes are append-only migrations in `packages/engine/src/store/schema.ts`.
- Tests and callers should cross meaningful module interfaces, not private implementation details.
- Missing data should surface as an explicit error, not a fake fallback object.
- Real provider secrets stay encrypted on the local machine and never enter committed logs, docs, the WebView, or evidence.
