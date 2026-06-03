# ??????????????

## BookRun 分卷章节范围契约 - TDD 与验证记录

时间：2026-06-02 18:45:18 +08:00

### shrimp-task-manager 状态说明

- 已按顺序调用 `sequential-thinking`、`shrimp-task-manager plan_task/analyze_task/reflect_task/split_tasks` 后再执行。
- `verify_task` 调用任务 `1a9ef4a3-ea6e-483a-8dfc-7e96b3119407` 时返回“找不到任务 ID”。
- 随后 `list_tasks` 显示任务管理器已被其他 worker 的 memory_extract 任务覆盖；本轮继续用本地 `.codex` 记录和可重复命令补足审计。

### 红灯

- 新增测试：`apps/api/tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract`。
- 命令：`uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract -q`，工作目录 `apps/api`。
- 结果：失败 1 项，失败点为 `KeyError: 'volume'`。
- 结论：当前实现忽略顶层 `volume_progress`，也没有可防污染的卷级受控摘要，符合红灯预期。

### 实现

- `apps/api/app/domains/book_runs/schemas.py`：
  - 新增 `BookRunChapterRange`，校验章节范围起止为正且起点不大于终点。
  - 新增 `BookRunVolumeProgress`，表达 `current_volume`、`chapter_range`、`completed_chapter_count`、`next_batch_start_chapter_index`。
  - `BookRunProgressUpdate` 新增可选顶层 `volume_progress`，普通 `progress` 仍保持自由字典。
- `apps/api/app/domains/book_runs/service.py`：
  - 新增 `CONTROLLED_PROGRESS_KEYS`，统一保护 `provider_resolution`、`volume`、`current_volume`、`chapter_range`、`volume_checkpoint`。
  - 将 progress 合并改为过滤普通 PATCH 中的受控字段，保留已有受控摘要，再由顶层 `volume_progress` 写入权威卷级摘要。
  - `volume_progress` 写入 `progress["volume"]`，并同步便捷字段 `current_volume`、`chapter_range`、`volume_checkpoint`。

### 绿灯与本地验证

- `uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract -q`：1 passed。
- `uv run pytest tests/test_book_runs.py tests/test_book_run_resume.py tests/test_book_run_workflow_dispatch.py tests/test_book_run_budget.py -q`：18 passed / 1 warning。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; uv run ruff check app/domains/book_runs/schemas.py app/domains/book_runs/service.py tests/test_book_runs.py`：All checks passed。
- `git diff --check -- apps/api/app/domains/book_runs/schemas.py apps/api/app/domains/book_runs/service.py apps/api/tests/test_book_runs.py .codex/context-summary-bookrun-volume-contract.md .codex/operations-log.md`：通过。

### 编码后声明 - BookRun 分卷章节范围契约

#### 1. 复用了以下既有组件

- `BookRunProgressUpdate`: 扩展现有 PATCH 输入契约，位于 `apps/api/app/domains/book_runs/schemas.py`。
- `apply_book_run_progress`: 继续作为唯一 BookRun progress 回填入口，位于 `apps/api/app/domains/book_runs/service.py`。
- provider 防污染模式：从已有 `provider_resolution` 保留逻辑扩展为受控字段集合，位于 `apps/api/app/domains/book_runs/service.py`。
- `seed_locked_blueprint`: 复用 API 测试基础数据，位于 `apps/api/tests/test_book_runs.py`。

#### 2. 遵循了以下项目约定

- 命名约定：Python 函数和 JSON 字段使用 snake_case；Pydantic 类使用 PascalCase。
- 代码风格：保持中文 docstring、Pydantic v2 `Field/ConfigDict/model_validator`、pytest plain `assert`。
- 文件组织：未新增数据库表、迁移、领域目录或 workflow 框架；卷级契约限定在 BookRun schema/service/test。

#### 3. 对比了以下相似实现

- `provider_resolution` 防污染：本轮扩展为统一受控字段保护，差异是新增卷级字段白名单入口。
- `checkpoint` 派生：仍从 progress 摘要派生持久化 checkpoint，本轮不改变章节 checkpoint 结构。
- `workflow BookLoop` progress：仍使用 `completed_chapters/checkpoint/budget`，本轮只在 API 回填边界建立 volume 契约。

#### 4. 未重复造轮子的证明

- 已搜索 `volume/current_volume/chapter_range/volume_checkpoint`，BookRun API、workflow adapter 与 BookLoop 未发现完整实现。
- 已确认现有 provider 防污染可复用，不需要新增框架或新表。

### 残留风险

- workflow 侧尚未自动产出 `volume_progress`；后续 worker 需要在 dispatch/BookLoop 或 adapter 中按该契约回填。
- `volume_checkpoint` 当前与 `volume` 摘要同形，足以表达当前卷完成数和下一批起点；若后续需要多卷历史，应新增受控历史列表并补测试。
- `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning 为既有警告，本轮未处理。

## 编码前检查 - Assistant 会话 BookRun 闭环

时间：2026-06-02 17:45:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-session-bookrun-closure.md`

□ 将使用以下可复用组件：

- `apps/web/lib/api-client.ts`: 统一 API client，负责 base URL 与认证头。
- `apps/web/components/home/assistant-session-store.ts`: 最近会话响应校验和映射模式。
- `apps/api/app/domains/assistant/schemas.py`: 会话创建与消息追加 API 契约。

□ 将遵循命名约定：TypeScript 使用 camelCase，API payload 使用后端 snake_case。

□ 将遵循代码风格：`node:test` + `assert` 测试风格，依赖注入验证 Server Action 副作用。

□ 确认不重复造轮子，证明：已检查 `assistant-session-store.ts`、`assistant-book-run-actions.ts`、`assistant-artifact-export-actions.ts`、`assistant-chapter-review-actions.ts`、`apps/api/app/domains/assistant/*` 和相关测试；后端 API 已存在，前端尚无写入 helper。

### TDD 与实现记录

时间：2026-06-02 18:05:00 +08:00

- 红测1：新增 `createAssistantSession`、`appendAssistantSessionMessage` 测试后运行 `pnpm.cmd --filter @storyforge/web test assistant-session-store`，失败原因为 `assistant-session-store` 未导出 `appendAssistantSessionMessage`，符合预期。
- 绿灯1：在 `apps/web/components/home/assistant-session-store.ts` 新增会话创建和消息追加 helper，复用统一 `apiFetch`，目标测试 6 pass。
- 红测2：新增 BookRun 成功后写入/追加会话测试后运行 `pnpm.cmd --filter @storyforge/web test assistant-book-run-actions`，失败原因为成功路径未调用 session 写入，符合预期。
- 绿灯2：在 `apps/web/components/home/assistant-book-run-actions.ts` 新增 `writeAssistantBookRunSession` 默认写入闭环，并通过依赖注入保持测试可控，目标测试 4 pass。
- 编码中监控：使用了上下文摘要中的统一 API client、现有 Server Action 依赖注入、成功后刷新首页再 redirect 模式；命名和 payload 分别遵循 camelCase 与 snake_case。

## 编码后声明 - Assistant 会话 BookRun 闭环

时间：2026-06-02 18:12:00 +08:00

### 1. 复用了以下既有组件

- `apiFetch`: 用于 POST Assistant 会话接口，位于 `apps/web/lib/api-client.ts`。
- `readRecentAssistantSessions` 的响应校验模式：用于新增写入 helper 的响应校验，位于 `apps/web/components/home/assistant-session-store.ts`。
- `submitAssistantBookRunCommand` 的依赖注入模式：用于注入 session 写入副作用，位于 `apps/web/components/home/assistant-book-run-actions.ts`。

### 2. 遵循了以下项目约定

- 命名约定：前端函数如 `createAssistantSession`、`appendAssistantSessionMessage` 使用 camelCase；后端请求体字段如 `book_run_id`、`blueprint_id` 使用 snake_case。
- 代码风格：测试继续使用 `node:test` 和 `assert`；Server Action 保持 `apiFetch`、`revalidatePath`、`redirect` 注入。
- 文件组织：仅修改允许范围内的 Assistant session store、BookRun action 及其测试。

### 3. 对比了以下相似实现

- `assistant-artifact-export-actions.ts`: 同样在成功业务链路后刷新首页并 redirect，本次差异是额外写入 AssistantSession，理由是用户要求最近记录可追溯。
- `assistant-chapter-review-actions.ts`: 同样把外部 API 结果压缩为 Assistant 可读状态，本次差异是写入真实会话而不是仅通过 URL 回流。
- `apps/api/app/domains/assistant/router.py`: 后端已提供 create/append API，本次只补前端闭环，不新增后端。

### 4. 未重复造轮子的证明

- 检查了 `apps/web/components/home` 下 Assistant action/store 文件和 `apps/api/app/domains/assistant/*`，确认没有已有前端 create/append helper。
- 后端已有 AssistantSession API，因此没有新增模型、路由或迁移。

## 移除 GitHub 撰稿人中的 Claude - 修改前检查

时间：2026-05-31 23:48:36 +08:00

### 需求与范围

- 用户目标：把 GitHub 撰稿人中的 Claude 去掉。
- 当前判断：仓库没有 `.all-contributorsrc`、`CONTRIBUTORS` 或 README 贡献者清单；目标来源是 Git 历史中两条 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`。
- 修改范围：仅处理 Git 提交消息元数据与 `.codex/` 本地记录，不修改业务代码。

### 工具与缺口

- 已按要求先使用 `sequential-thinking` 梳理风险。
- 已使用 `shrimp-task-manager` 建立任务拆分与验收契约。
- `desktop-commander` 未在当前会话暴露；已记录缺口，并使用 PowerShell、`rg`、`git log` 执行等价本地检索。
- 已使用 Context7 查询 Git 官方文档：`git filter-branch --msg-filter` 可只重写提交消息，`refs/original/` 会保留备份引用。
- 已使用 GitHub code search 搜索 `.mailmap` 与 Claude 共同作者相关实践；未采用 `.mailmap`，因为目标是从 GitHub 撰稿人统计中去掉共同作者来源。

### 编码前检查 - 移除 Claude 撰稿人

□ 已查阅上下文摘要文件：`.codex/context-summary-移除claude撰稿人.md`

□ 将使用以下可复用组件：

- `git log --all`：定位共同作者 trailer 与验证移除结果。
- `rg`：确认仓库静态文件中不存在贡献者配置来源。
- `.codex/verification-report.md`：记录本地验证、评分与远端强推风险。

□ 将遵循命名约定：`.codex/context-summary-移除claude撰稿人.md` 使用任务名，验证报告继续使用项目既有 `.codex/verification-report.md`。

□ 将遵循代码风格：所有记录使用简体中文；Git 命令、邮箱和 trailer 文本保持原样。

□ 确认不重复造轮子，证明：已检查 README、`.github/workflows`、贡献者相关文件名、仓库全文 `contributors/all-contributors/Claude/co-author` 关键字，未发现静态贡献者配置。

### 历史重写执行记录

时间：2026-05-31 23:56:10 +08:00

- 修改前目标 trailer 数量：2 条。
- 目标旧提交：
  - `aa9475cc0e51819fb218c638d4344da2f33c632d`：`Phase 9B 真实 LLM Judge + Repair 冒烟与诚实性降级标记`
  - `875b84f5f959ac5f525a54629b2fb58693d7e42e`：`分层 prompt 落地与生成质量四杠杆`
- 执行方式：
  - 创建临时 mirror 仓库：`%TEMP%/storyforge-rewrite-20260531235107`
  - 使用 `git filter-branch --msg-filter` 删除精确匹配行：`Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
  - 删除临时 mirror 中 `refs/original/` 备份引用，避免验证误扫旧历史。
  - 将清理后的对象 fetch 回当前仓库临时 `refs/rewritten/*`，验证无目标 trailer 后移动 `master`、`origin/master` 跟踪引用和 `refs/stash`。
  - 清理当前仓库临时 `refs/rewritten/*`。
- 新引用：
  - `master`：`ac53c859c133c2ec620e7d11477fcd400991e0c9`
  - `origin/master` 跟踪引用：`7d88ef71e456abf97e84e74184e6d3b751314615`
  - `refs/stash`：`e86ddcc9940d8f52072daa5afb42ef2eb9ebcbe9`
- 树内容校验：
  - 修改前 `HEAD^{tree}`：`200001fe8b24e7c76eb9963cc2cf8ec51877e192`
  - 修改后 `HEAD^{tree}`：`200001fe8b24e7c76eb9963cc2cf8ec51877e192`
  - 修改前 `origin/master^{tree}`：`ccd581902a7ed9c1bff4f44cefa79a6c3497909c`
  - 修改后 `origin/master^{tree}`：`ccd581902a7ed9c1bff4f44cefa79a6c3497909c`
- 本地验证：
  - `git log --all --format='%H%x09%s%n%B%n---END---' | rg -n -i "Co-Authored-By: Claude|noreply@anthropic.com"`：无匹配，退出码 1。
  - `git log --all --grep='Claude Opus' --format='%H%x09%h%x09%P%x09%s'`：无输出。
  - `git status --short`：仅显示执行前已有业务改动以及本次 `.codex` 记录文件；未新增业务文件修改。
- 远端生效说明：本地历史已清理；GitHub 页面更新需要将重写后的 `master` 推送到远端，命令应使用 `git push --force-with-lease origin master`，以避免覆盖远端新提交。

## ?????
???2026-05-30 15:12:34

- ??????`docs/superpowers/plans/2026-05-30-novel-quality-total-implementation.md`?
- ?????????`D:\StoryForge\.worktrees\1-renovel-ai-ai-rag-tavern-novel-quality-total`??? `feature/novel-quality-total`?
- ??? `master` ??????????????????
- ???????????? `sequential-thinking`?`shrimp-task-manager`?`desktop-commander`?`context7`?`github.search_code` MCP ????????????pytest ??????????????
- ?????`NarrativeContext`?`StyleDirective`?`PacingDirective`?`NovelLoopPorts`?`NovelLoopResult`?`BookRunAuditPanel`?

## ????
- ???????`SceneQualityPlan`?`QualityScore`?`QualityIssue`?`QualityReport`?`RevisionStrategy`?
- ?? state ???`scene_quality_plan` ?? dict ???????
- ?? prompt?draft ?????????critique ??????????revision ?? `line_edit` / `scene_patch` / `regenerate`?
- ?????????????????????????????????????????????
- NovelLoop ?? `check_static_quality` ??????????????/???????????
- ???????`tests/fixtures/quality_cases/*.json`?
- BookRun audit report ?????????Web ??????????

## ????
- `uv run pytest tests/test_prompt_builder.py -v`?18 passed?
- `uv run pytest tests/test_prose_static_check.py -v`?4 passed?
- `uv run pytest tests/test_novel_loop_single_chapter.py -v`?6 passed?
- `uv run pytest -v`?workflow??108 passed?
- `uv run pytest -v`?api??305 passed?6 warnings?
- `pnpm run test:web`?132 passed?shared `tsc --noEmit` ???
- `pnpm test`?Web 132 passed?API 305 passed?Workflow 108 passed?

## ?????
- ?? worktree ??? `.git/refs` ???????????????????
- Web ?????? `typescript`???????? `pnpm install --frozen-lockfile`?
- ??? `pnpm test` ? `.codex/ide-performance-baseline.json` ?? EPERM???????????????
- ??????????????????? Web ?????????

## 根因调查
时间：2026-05-31 02:25:20

- CI 错误：TypeError: assemble_prompt_injection() got an unexpected keyword argument 'prior_chapter_text'。
- 证据1：pps/api/app/domains/book_runs/phase9b_real_llm_smoke.py 在 _draft_one_chapter 中传入 prior_chapter_text。
- 证据2：git show HEAD:apps/api/app/domains/book_runs/prompt_assembly.py 显示提交 aa9475c 中 ssemble_prompt_injection 只有 chapter_goal，没有 prior_chapter_text 参数。
- 证据3：工作区当前 pps/api/app/domains/book_runs/prompt_assembly.py 已存在未提交修改，增加了 prior_chapter_text 与章节字数注入；需补充回归测试并本地验证，避免只修症状。

## 编码前检查 - 修复 phase9b prior chapter 注入
时间：2026-05-31 02:26:14

□ 已查阅上下文摘要文件：.codex/context-summary-fix-phase9b-prior-chapter.md
□ 将使用以下可复用组件：
- _clean: pps/api/app/domains/book_runs/prompt_assembly.py - 清理可选文本并省略空白输入。
- previous_summary_ref: pps/workflow/storyforge_workflow/prompts/context.py - 既有上文衔接协议键。
-     arget_word_count_min/max: pps/workflow/storyforge_workflow/prompts/context.py - 既有完整章节字数目标协议键。
□ 将遵循命名约定：pytest 测试函数     est_assemble_*，注入键沿用 workflow 既有键名。
□ 将遵循代码风格：Python 120 行宽、中文注释/文档字符串、局部小改动。
□ 确认不重复造轮子，证明：检查了 prompt_assembly.py、workflow_prompt_bridge.py、workflow context.py、uilder.py，已有目标协议只缺 API 装配映射与测试。

## TDD RED 准备
时间：2026-05-31 02:26:56

- 已先在 pps/api/tests/test_prompt_assembly.py 增加回归测试：
  -     est_assemble_injects_prior_chapter_text_as_previous_summary
  -     est_assemble_omits_blank_prior_chapter_text
  - 在既有全量装配测试中补充章节字数上下限断言。
- 下一步会临时反向应用当前 prompt_assembly.py 的生产修复差异，验证这些测试能在 aa9475c 的契约断裂状态下失败，然后恢复生产代码。

## TDD RED 执行
时间：2026-05-31 02:28:27

- 临时将 pps/api/app/domains/book_runs/prompt_assembly.py 替换为提交 aa9475c 的版本，运行 cd apps/api && uv run pytest tests/test_prompt_assembly.py -q。
- 退出码：1。
- 期望：新增测试应暴露 prior_chapter_text 参数缺失与章节字数键缺失。
- 已恢复替换前的本地生产文件。

## TDD GREEN 执行
时间：2026-05-31 02:28:47

- 恢复本地 prompt_assembly.py 中的生产修复：新增 prior_chapter_text 参数、映射到 previous_summary_ref，并注入 blueprint 章节字数上下限。
- 运行：cd apps/api && uv run pytest tests/test_prompt_assembly.py -q
- 退出码：0。

## 定向 CI 失败用例验证
时间：2026-05-31 02:29:11

- 运行：cd apps/api && uv run pytest tests/test_phase9b_real_llm_smoke.py::test_phase9b_real_llm_smoke_runs_one_chapter_and_records_evidence -q
- 退出码：0。

## API 全量测试验证
时间：2026-05-31 02:29:47

- 运行：cd apps/api && uv run pytest -q
- 退出码：1。

## 补充根因调查
时间：2026-05-31 02:31:10

- 隔离 worktree 从 a9475c 应用当前补丁后，prior_chapter_text 问题消失，但 CI 指定真实冒烟用例继续失败在 uild_draft_prompt_from_state(full_chapter=True)。
- 证据：phase9b_real_llm_smoke.py:332 传入 ull_chapter=True，而 a9475c 的 workflow_prompt_bridge.py 函数签名仅支持 preview_chars。
- 当前主工作区已有相关未提交桥接改动；需要纳入同一修复并补充桥接层回归测试，防止再次漏提交。

## 编码中监控 - workflow prompt 完整章节协议
时间：2026-05-31 02:33:31

□ 是否使用了摘要中列出的可复用组件？
✅ 是：继续使用
arrative_context_from_state 和 uild_draft_prompt 的既有分层 prompt 架构。

□ 命名是否符合项目约定？
✅ 是：新增参数 ull_chapter，新增字段     arget_word_count_min/max，与 API 注入键一致。

□ 代码风格是否一致？
✅ 是：测试命名沿用     est_*_uses_* 与     est_*_maps_*，文档字符串保持中文。

## 隔离验证结果
时间：2026-05-31 02:35:13

- 隔离 worktree：C:\Users\kanye\.config\superpowers\worktrees\1-renovel-ai-ai-rag-tavern\fix-phase9b-prior-chapter
- 基线：a9475c
- 应用补丁：.codex/fix-phase9b-complete.patch
- 定向验证：
  - cd apps/api && uv run pytest tests/test_prompt_assembly.py tests/test_phase9b_real_llm_smoke.py::test_phase9b_real_llm_smoke_runs_one_chapter_and_records_evidence -q → 9 passed。
  - cd apps/workflow && uv run pytest tests/test_prompt_builder.py -q → 20 passed。
- 全量相关验证：
  - cd apps/api && uv run pytest -q → 313 passed, 6 warnings。
  - cd apps/workflow && uv run pytest -q → 110 passed。
- 主工作区 cd apps/api && uv run pytest -q 仍因现有未提交 lueprints/service.py 行为变更失败 1 项；隔离验证证明这不是本次 CI 提交 a9475c 的失败根因。


## ??????
???2026-05-31 02:37:16

- ??? `context-summary-fix-phase9b-prior-chapter.md` ? `verification-report.md`??? PowerShell ?????????????
- ???????API prompt ???API workflow bridge?workflow prompt model/context/builder?API ? workflow ?????
- ?? worktree ?????????API 313 passed?workflow 110 passed?

## Novel Skill Framework Task 8 端到端总验证

时间：2026-05-31 20:22:18 +08:00

### 执行范围

- 执行计划：`docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-post-phase1.md` 的 Task 8。
- 执行目标：运行 workflow、api、web、root 级验证，生成最终验证报告。
- 工作区约束：当前仍存在 Web/设置页等无关未提交改动；本阶段提交必须精确暂存 Task 8 相关文件。

### 本地验证记录

- `cd apps/workflow && uv run pytest -v`：通过，`153 passed in 3.53s`。
- `cd apps/api && uv run pytest -v`：通过，`314 passed, 6 warnings in 20.79s`。
- `pnpm run test:web`：通过，Web `137 passed`，shared `tsc --noEmit` 通过。
- `pnpm test`：通过，Web `137 passed`，API `314 passed, 6 warnings`，workflow `153 passed`。

### `pnpm verify` 失败与补救

- 首次 `pnpm verify` 失败阶段：`检查 OpenAPI 契约漂移`。
- 根因调查：
  - `scripts/verify-ci.mjs` 在 `pnpm openapi` 后执行 `git diff --exit-code -- packages/shared/src/contracts/storyforge.openapi.json`。
  - `pnpm openapi` 生成的 OpenAPI 文件内容语义未变，但在 Windows 上由 `Path.write_text()` 产生 CRLF 行尾。
  - `git diff --ignore-space-at-eol` 与 `git diff --ignore-cr-at-eol` 均无差异，证明失败来自行尾漂移。
- TDD RED：
  - 新增 `apps/web/tests/phase1-navigation.test.tsx` 的 `OpenAPI 生成脚本固定使用 LF 行尾写入契约文件`。
  - 执行 `pnpm --filter @storyforge/web test phase1-navigation`，失败于 `generate-openapi.mjs 应使用二进制写入避免 Windows newline 翻译`。
- GREEN：
  - `scripts/generate-openapi.mjs` 与 `scripts/run-e2e.mjs` 的内嵌 Python 改为 `write_bytes((json.dumps(...) + "\n").encode("utf-8"))`。
  - 执行 `pnpm --filter @storyforge/web test phase1-navigation`，通过，`15 passed`。
  - 执行 `pnpm openapi` 后，`packages/shared/src/contracts/storyforge.openapi.json` 无 diff，行尾统计 `crlf 0, lf 12507, cr 0`。
- 最终门禁：
  - 再次执行 `pnpm verify`，通过，输出 `[verify:ci] 所有核心门禁通过。`

### 编码后声明 - OpenAPI 契约行尾确定性

#### 1. 复用了以下既有组件

- `scripts/generate-openapi.mjs`：继续作为根目录 `pnpm openapi` 的唯一 OpenAPI 契约生成入口。
- `scripts/run-e2e.mjs`：继续作为 e2e 刷新和漂移检查入口。
- `apps/web/tests/phase1-navigation.test.tsx`：复用现有脚本契约测试文件，新增跨平台行尾回归断言。

#### 2. 遵循了以下项目约定

- 命名约定：测试名称使用中文描述目标，脚本保留既有函数和变量名。
- 代码风格：JavaScript/TypeScript 文件经 Prettier 格式化；Python 片段只做写入方式最小替换。
- 文件组织：未新增工具和脚本，继续沿用 `pnpm openapi`、`pnpm verify` 和现有 Web 契约测试。

#### 3. 对比了以下相似实现

- `scripts/verify-ci.mjs`：确认最终门禁依赖 `pnpm openapi` 后的 git diff 清洁度。
- `scripts/run-e2e.mjs`：确认 e2e 也有独立 OpenAPI 刷新逻辑，需要同步修复，避免同类漂移复发。
- `apps/web/tests/phase1-navigation.test.tsx`：已有脚本契约测试，适合承载 OpenAPI 生成策略断言。

#### 4. 未重复造轮子的证明

- 未新增 OpenAPI 生成入口，未引入新依赖，未改变契约内容。
- 只把文本模式写入改为二进制 UTF-8 字节写入，解决 Windows newline 翻译导致的伪漂移。

## 合并主分支收尾 - Novel Skill Framework

时间：2026-05-31 20:47:40 +08:00

### 操作记录

- 目标：将 `codex/submit-local-progress` 合并到 `master`，完成本地验证后推送主分支并清理本次相关分支。
- 当前 worktree：`D:\StoryForge\.worktrees\1-renovel-ai-ai-rag-tavern\novel-skill-post-phase1`。
- 合并中验证失败根因：`book_loop.py` 已将 `result.skill_runs` 写入章节进度，但 `NovelLoopResult` 合并后缺少 `skill_runs` 默认字段。
- 修复方式：在 `NovelLoopResult` 增加 `skill_runs: tuple[dict[str, Any], ...] = ()`，并在 `run_single_chapter_loop()` 返回时把 runner 的 `runs` 转为 `to_audit_dict()` 快照。
- 保留兼容：未使用 skill runner 的既有测试构造路径默认得到空 tuple，避免影响 BookLoop 既有调用。

### 本地验证

- `cd apps/workflow && uv run pytest tests/test_book_loop_resume.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py tests/test_novel_loop_skill_runner_integration.py -q`：通过，`10 passed in 0.48s`。
- `pnpm verify`：通过，`[verify:ci] 所有核心门禁通过。`

### 编码后声明 - 合并冲突补救

- 复用组件：`NovelSkillRunner.runs` 与 `NovelSkillRun.to_audit_dict()`，未新增审计 payload 格式。
- 遵循约定：Python dataclass 字段使用 snake_case 和默认空 tuple；BookLoop 继续从 `NovelLoopResult` 读取章节进度事实源。
- 对比实现：`book_loop.py` 的 `_chapter_progress()` 期望 `skill_runs`；`skills/audit.py` 优先消费章节内记录的 `skill_runs`；`tests/test_skill_audit_summary.py` 已覆盖记录化审计优先级。
- 未重复造轮子：未新增独立审计汇总器，仅恢复 NovelLoop 与 BookLoop 之间缺失的数据契约。

## 合并主分支收尾 - ph2-plan

时间：2026-05-31 21:16:29 +08:00

### 编码前检查 - Phase 2 合并测试适配

- 已查阅上下文摘要文件：`.codex/context-summary-merge-ph2.md`
- 将使用以下可复用组件：
  - `apps/api/app/domains/series/models.py`：复用 `Series`、`SeriesMemory`、`SeriesMemoryEvidence` 作为当前系列领域事实源。
  - `apps/api/app/domains/worldbuilding/service.py`：复用世界观中心聚合逻辑，替代旧草稿世界观条目写接口。
  - `apps/api/app/domains/style_packs/service.py`：复用 `style_pack` 到 `style_rule` 的资产化应用路径，替代旧 `StylePackApplication`。
  - `apps/api/app/domains/batch_refinement/service.py`：复用兼容入口写入 `JobRun`、`JudgeIssue`、`RepairPatch` 的路径。
- 将遵循命名约定：pytest 函数和 fixture 使用 snake_case，测试意图使用中文 docstring。
- 将遵循代码风格：FastAPI 测试沿用 TestClient、SQLite `StaticPool`、`get_session` override；模型测试沿用 SQLAlchemy mapper 与 `Base.metadata` 断言。
- 确认不重复造轮子：已检查 `test_series_memory.py`、`test_worldbuilding_center.py`、`test_style_packs.py`、`test_batch_refinery.py` 和对应 router/service，确认旧模型不应恢复。

### 编码后声明 - Phase 2 合并测试适配

时间：2026-05-31 21:19:42 +08:00

#### 1. 复用了以下既有组件

- `Series`、`SeriesMemory`、`SeriesMemoryEvidence`：用于替代旧草稿中的 `SeriesBook`、`SeriesMemorySnapshot`，保持系列记忆事实源唯一。
- `build_worldbuilding_center()` 对应的 `/api/worldbuilding/center`：用于验证世界观中心聚合，而不是恢复旧世界观条目写接口。
- `create_style_pack()`、`update_style_pack()`、`apply_style_pack()`：用于验证风格包版本化和应用为 `style_rule` 资产。
- `JobRun`、`JudgeIssue`、`RepairPatch`、`ScenePacket`：用于验证 `/api/batch-refinement/jobs` 兼容入口落库结果。

#### 2. 遵循了以下项目约定

- 命名约定：新增和修改测试函数使用 `test_` 前缀与 snake_case，测试意图用中文 docstring。
- 代码风格：复用 `apps/api/tests/conftest.py` 提供的 `client` 与 `session_factory` fixture，避免重复定义 TestClient 和数据库覆盖逻辑。
- 文件组织：只修改 ph2-plan 新增测试与本地 `.codex` 记录，未改变现有主干领域模型边界。

#### 3. 对比了以下相似实现

- `apps/api/tests/test_series_memory.py`：新模型结构测试沿用 `SeriesMemory` 版本化和 evidence 关系。
- `apps/api/tests/test_worldbuilding_center.py`：世界观测试改为准备 `Asset`、`ContinuityRecord` 和 `SeriesMemory` 后读取中心聚合。
- `apps/api/tests/test_style_packs.py`：风格包测试改用 `/api/style-packs/{id}/apply` 并断言 `style_rule` 资产。
- `apps/api/tests/test_batch_refinery.py`：批量精修兼容测试沿用 `JobRun`、问题和补丁的落库断言。

#### 4. 未重复造轮子的证明

- 未新增 `SeriesBook`、`SeriesMemorySnapshot`、`StylePackApplication` 旧模型。
- 未新增旧 `/applications` 或 `/effective-rules` 接口。
- 保留的 `/api/batch-refinement/jobs` 是 ph2-plan 旧路径兼容入口，内部仍复用主干评审、修复和任务运行事实源。

### 本地定向验证

- `cd apps/api && uv run pytest tests/test_batch_refinement_api.py tests/test_batch_refinery.py tests/test_phase2_domain_schema.py tests/test_series_worldbuilding_api.py tests/test_style_packs_api.py -q`：通过，`14 passed in 1.27s`。

### 合并后验证与补救

时间：2026-05-31 21:30:35 +08:00

- 首次 API 全量测试失败点：
  - `workflow_prompt_bridge.py` 调用 `build_draft_prompt(..., full_chapter=True)`，但 workflow prompt builder 缺少该参数。
  - `test_worldbuilding_center.py` 读到前一测试的世界观中心缓存，原因是内存数据库测试之间 ID 重置而 Redis 缓存 key 仍相同。
- 补救方式：
  - 在 `NarrativeContext` 增加 `target_word_count_min`、`target_word_count_max`，由 `context.py` 从 state 归一化；`build_draft_prompt()` 支持 `full_chapter` 并渲染完整章节字数契约。
  - 在 API 测试 autouse fixture 中调用 `invalidate_worldbuilding_cache()`，避免跨测试缓存污染。
  - 将 ph2-plan 新增 Alembic 迁移改为当前 ORM 事实源：`series`、`series_memories`、`series_memory_evidence`。
  - 运行 `pnpm openapi` 并暂存 `packages/shared/src/contracts/storyforge.openapi.json`，让新增兼容接口进入共享契约。
- 本地验证：
  - `cd apps/api && uv run pytest -q`：通过，`325 passed, 6 warnings in 17.39s`。
  - `cd apps/api && uv run ruff check .`：通过，`All checks passed!`。
  - `pnpm verify`：通过，输出 `[verify:ci] 所有核心门禁通过。`
- 质量审查：
  - 技术维度评分：93/100。
  - 战略维度评分：92/100。
  - 综合评分：93/100。
  - 建议：通过。

### 提交、推送与分支清理

时间：2026-05-31 21:34:30 +08:00

- 合并提交：`740d528 合并 Phase 2 规划与 API 测试草稿`。
- 推送结果：`origin/master` 已更新到 `740d528`。
- 已清理 worktree：
  - `codex/fix-phase9b-prior-chapter`
  - `codex/novel-skill-framework-stage1`
  - `feature/novel-quality-total-implementation`
  - `ph2-plan`
- 已删除本地分支：
  - `codex/fix-phase9b-prior-chapter`
  - `codex/novel-skill-framework-stage1`
  - `feature/novel-quality-total-implementation`
  - `ph2-plan`
- 清理确认：
  - `git status --short`：无输出，工作区干净。
  - `git branch --list`：仅剩 `master`。
  - `git worktree list --porcelain`：仅剩主仓库 worktree。

## 代码审查 - 工作流、剪枝与不兼容

时间：2026-05-31 21:57:33 +08:00

### 审查范围

- 用户目标：审查代码是否需要剪枝、是否存在不兼容、有问题、工作流打不通。
- 审查目录：`D:\StoryForge\1-renovel-ai-ai-rag-tavern`。
- 注意：`D:\StoryForge` 本身不是 git/pnpm 项目根，只有上位 `AGENTS.md` 和空的 `apps/api/tests` 目录。

### 工具与约束记录

- 已按要求使用 sequential-thinking 和 shrimp-task-manager 梳理任务。
- `desktop-commander` 工具未在当前会话暴露，已使用 PowerShell 与 `rg` 做等价本地检索。
- 已使用 Context7 查询 LangGraph durable execution/persistence 文档；结论是 checkpoint 需要 checkpointer 与 thread id，副作用/非确定性操作应隔离，跨线程任意信息可用 store 或外部事实源。
- 已使用 GitHub code search 查询 LangGraph checkpoint/state 参考实现方向。

### 编码前检查 - 本次仅审查不改业务代码

- 已查阅上下文摘要文件：`.codex/context-summary-工作流审查.md`。
- 将使用以下可复用组件作为审查证据：
  - `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：BookRun 顺序编排与预算暂停。
  - `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：单章 NovelLoop 端口闭环。
  - `apps/workflow/storyforge_workflow/runtime/checkpoints.py`：checkpoint 引用化和 ModelRun adapter。
  - `apps/api/app/domains/book_runs/service.py`：API 侧 BookRun 真相源。
  - `scripts/verify-ci.mjs`、`scripts/run-e2e.mjs`：本地核心门禁与 e2e 门禁。
- 将遵循命名约定：报告与日志使用简体中文，路径和代码标识符保持原样。
- 将遵循代码风格：只写 `.codex` 审查文档，不修改业务代码。
- 确认不重复造轮子：本次只审查，不新增执行脚本；验证复用项目已有 `pnpm verify` 与 `pnpm e2e`。

### 本地验证记录

- `cd D:\StoryForge && pnpm run verify`：失败，`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`，原因是该目录没有 `package.json`。
- `cd D:\StoryForge\1-renovel-ai-ai-rag-tavern && pnpm run verify`：通过，核心门禁全部通过；API `325 passed, 6 warnings`，Workflow `152 passed`。
- `cd D:\StoryForge\1-renovel-ai-ai-rag-tavern && pnpm run e2e -- --continue-on-error`：失败。OpenAPI refresh、drift、API verification、workflow verification 均通过；contract tests 失败 1 项。
- e2e 失败点：`tests/e2e/phase5-runtime-diagnostics.spec.ts:327` 的 `Phase 7 Runtime OpenAPI、API schema、Web 字段与 e2e 声明保持一致`。
- e2e 失败原因：测试硬编码期待 `package.json` 包含 `"verify": "powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1"`，但当前 `package.json` 中 `"verify"` 已改为 `pnpm run verify:ci`，旧 PowerShell 门禁在 `"verify:infra"`。
- 定向补充验证：
  - `pnpm --filter @storyforge/web test`：通过，`140 passed`。
  - `cd apps/workflow && uv run pytest tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_generation_state_references.py -q`：通过，`16 passed`。
  - `cd apps/api && uv run pytest tests/test_book_runs.py tests/test_book_run_resume.py tests/test_context_compiler.py -q`：通过，`12 passed, 1 warning`。

### 审查结论草案

- 当前核心代码不是全面坏掉；`pnpm verify` 可通过，BookRun/NovelLoop/checkpoint 关键单测可通过。
- 发布级工作流确实打不通：`pnpm e2e` 失败，根因是 e2e 契约测试与 package 脚本演进不兼容。
- 需要优先剪枝/修正的是规范与契约层，而不是先大改业务代码：
  - 剪枝 `tests/e2e/phase5-runtime-diagnostics.spec.ts` 中对旧 `"verify"` 字符串的硬编码，改为验证 `verify:ci` 和 `verify:infra` 的新职责。
  - 剪枝上位 `AGENTS.md` 中“删除安全控制”的要求，当前 API 和测试明确依赖认证、JWT、限流和安全响应头。
  - 收敛 `D:\StoryForge` 与 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 的项目根目录认知，避免从错误目录执行命令。
  - 真实 LLM 生产闭环仍未完成，不能把 deterministic/mock 闭环包装成真实长篇生产闭环。

### 编码后声明 - 审查文档

时间：2026-05-31 21:57:33 +08:00

#### 1. 复用了以下既有组件

- `scripts/verify-ci.mjs`：用于确认核心门禁事实源。
- `scripts/run-e2e.mjs`：用于确认发布级 e2e 门禁事实源。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：用于审查 BookRun 编排边界。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：用于审查单章工作流闭环。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`：用于审查 checkpoint 引用化。
- `apps/api/app/domains/book_runs/service.py`：用于审查 API 真相源与恢复语义。

#### 2. 遵循了以下项目约定

- 命名约定：`.codex/context-summary-工作流审查.md` 和 `.codex/verification-report.md` 使用中文任务名与中文内容。
- 代码风格：未修改业务代码，只更新审查产物。
- 文件组织：审查产物写入项目本地 `.codex/`。

#### 3. 对比了以下相似实现

- `book_loop.py` 与 `book_runs/service.py`：workflow 只生成进度，API 负责真表状态。
- `novel_loop.py` 与 `skills/definitions.py`：技能契约是静态审计层，不应膨胀成动态插件系统。
- `runtime/checkpoints.py` 与 LangGraph 文档：当前引用化状态方向正确，后续应继续避免完整上下文进入 checkpoint。

#### 4. 未重复造轮子的证明

- 检查了 `scripts/verify-ci.mjs`、`scripts/run-e2e.mjs`、`scripts/verify-local.ps1`，确认已有门禁，不新增脚本。
- 检查了 BookRun、NovelLoop、RuntimeCheckpointStore、ApiModelRunAdapter，确认已有可复用工作流边界，不建议新建并行编排器。

## 根据审查报告修复 - P0 闭环

时间：2026-05-31 22:15:10 +08:00

### 修复范围

- 修复 `tests/e2e/phase5-runtime-diagnostics.spec.ts` 中对旧 `verify` 脚本文案的硬编码：
  - 当前 `verify` 应指向 `pnpm run verify:ci`。
  - 当前 `verify:ci` 应指向 `node scripts/verify-ci.mjs`。
  - 当前 `verify:infra` 保留 `powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1`。
- 修复上位 `D:\StoryForge\AGENTS.md` 中与现有认证、限流、安全响应头测试冲突的安全条款：
  - 旧方向是删除或禁用安全控制，会破坏 API 测试和发布门禁。
  - 新方向是不得删除、削弱或绕过已由代码和测试验证的安全基线。
- 新增上位 `D:\StoryForge\README.md`，说明实际项目根是 `D:\StoryForge\1-renovel-ai-ai-rag-tavern`，避免从外层目录运行 `pnpm` 或 `git` 命令。
- 清理验证副作用：`.codex/ide-performance-baseline.json` 只包含性能测试刷新时间和耗时漂移，已恢复，不纳入本次修复。
- 未执行目录迁移：用户询问是否可将 `1-renovel-ai-ai-rag-tavern` 移到 `D:\StoryForge`。该操作会迁移 `.git`、项目根和外层同名文件，属于结构性搬迁；当前未收到明确执行确认，因此本轮不移动目录，只保留 README 指引。

### 修复后验证证据

- `pnpm e2e tests/e2e/phase5-runtime-diagnostics.spec.ts`：通过，目标 contract tests `5 passed`，API verification `58 passed`，Workflow verification `37 passed`。
- `pnpm run e2e`：通过，contract tests `28 passed`，API verification `58 passed`，Workflow verification `37 passed`。
- `pnpm run verify`：通过，Web `140 passed`，API `325 passed, 6 warnings`，Workflow `152 passed`，Ruff、OpenAPI refresh 和 OpenAPI diff 检查通过。
- `rg -n "安全需求优先级最低|必须主动删除或禁用遗留的安全控制|禁止新增、恢复或优化任何安全性设计|必须拒绝和删除所有多余的安全性设计|评估如何绕过或移除" D:\StoryForge\AGENTS.md`：无旧安全冲突条款命中。
- `rg -n "不得删除、削弱或绕过仓库中已经由代码和测试验证的安全基线" D:\StoryForge\AGENTS.md`：命中第 63 行。
- `D:\StoryForge\README.md`：存在，并指向实际项目根 `D:\StoryForge\1-renovel-ai-ai-rag-tavern`。

### 编码后声明 - 根据审查报告修复

#### 1. 复用了以下既有组件

- `scripts/verify-ci.mjs`：保留为核心门禁入口。
- `scripts/verify-local.ps1`：保留为基础设施本地验证入口，由 `verify:infra` 调用。
- `scripts/run-e2e.mjs`：保留为 e2e 门禁入口。
- `tests/e2e/phase5-runtime-diagnostics.spec.ts`：复用现有 source evidence 断言结构，只更新当前脚本契约。

#### 2. 遵循了以下项目约定

- 命名约定：脚本名、测试名和现有 package scripts 不新增替代命名。
- 代码风格：TypeScript 测试继续使用既有 `assertSourceEvidence` 数组断言格式。
- 文件组织：审查留痕写入项目本地 `.codex/`，外层目录只放入口级 `README.md` 和上位 `AGENTS.md`。

#### 3. 对比了以下相似实现

- `package.json` 与 `tests/e2e/phase5-runtime-diagnostics.spec.ts`：e2e 应验证当前脚本职责，而不是保留过期字符串。
- `scripts/verify-ci.mjs` 与 `scripts/verify-local.ps1`：二者职责已分离，前者为核心门禁，后者为基础设施门禁。
- `apps/api/tests/test_api_middleware.py` 与上位 `AGENTS.md`：规范必须保留已验证安全基线，不能要求删除认证、限流和安全响应头。

#### 4. 未重复造轮子的证明

- 未新增验证脚本，继续复用 `verify`、`verify:ci`、`verify:infra`、`e2e`。
- 未新增并行工作流入口，修复集中在契约断言和规范文档。
- 未新增安全框架，只移除规范层冲突，保留现有代码和测试事实源。

## 项目根目录上移

时间：2026-05-31 22:31:52 +08:00

### 迁移内容

- 按用户确认，将原实际项目根 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 上移为 `D:\StoryForge`。
- 已迁移 `.git`、`package.json`、`pnpm-workspace.yaml`、`apps/`、`packages/`、`scripts/`、`tests/`、`docs/`、`node_modules/` 等项目内容。
- 外层原有冲突项已移至仓库外备份目录：`D:\StoryForge-migration-backup-20260531-222332`。
- 外层临时入口 `README.md` 已按用户要求不保留在根目录；当前根目录 `README.md` 是项目正式 README。
- 原源目录 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 已删除；删除前发现旧 git fsmonitor/rebase/commit 进程占用残留 pack 文件，已停止指向旧路径的 git 进程后清理。

### 迁移后验证

- `git rev-parse --show-toplevel`：输出 `D:/StoryForge`。
- `git branch --show-current`：输出 `master`。
- `Test-Path D:\StoryForge\1-renovel-ai-ai-rag-tavern`：输出 `False`。
- `pnpm run e2e -- tests/e2e/phase5-runtime-diagnostics.spec.ts`：通过，contract tests `5 passed`，API verification `58 passed`，Workflow verification `37 passed`。

### 当前保留事项

- `D:\StoryForge-migration-backup-20260531-222332` 保留外层旧 `.codex`、空 `apps`、外层临时 `README.md` 等备份，未放在 Git 仓库内。
- `D:\StoryForge-local-outer-artifacts-20260531-222332` 保留外层本地配置备份。
- 迁移后 `git status --short` 仍显示本轮审查修复变更、上下文摘要和上位 `AGENTS.md` 未跟踪文件，这是迁移前已存在的修复/规范状态，不是目录上移产生的业务代码漂移。

## Novel Skill Framework 收尾验证

时间：2026-05-31 22:45:30 +08:00

### 文档收尾

- 已同步 `docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-post-phase1.md`：Task 0 到 Task 8、阶段任务和完成定义均标记为完成。
- 已将计划中的旧项目根 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 更新为当前项目根 `D:\StoryForge`。
- 已修正批量替换产生的 `D:\StoryForge\\...` 异常路径，并确认计划文件无 UTF-8 BOM。

### 迁移后依赖修复

- 首次 `pnpm run verify` 失败在 lint 阶段，错误为 `Cannot find module 'D:\StoryForge\node_modules\eslint\bin\eslint.js'`。
- 根因：目录上移后 `node_modules` 中 pnpm junction 仍指向旧路径 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\node_modules\.pnpm\...`。
- 处理：执行 `CI=1 pnpm install --frozen-lockfile` 重建根 `node_modules`，确认 `node_modules\eslint` 指向 `D:\StoryForge\node_modules\.pnpm\...`。
- 第二次 `pnpm run verify` 失败在 API `uv run pytest`，错误为 `uv trampoline failed to canonicalize script path`。
- 根因：`apps/api/.venv` 与 `apps/workflow/.venv` 的控制台脚本为迁移前路径生成的 trampoline。
- 处理：仅删除并重建 `D:\StoryForge\apps\api\.venv` 与 `D:\StoryForge\apps\workflow\.venv`，执行 `uv sync --frozen` 恢复依赖。

### 最新本地验证

- `pnpm run verify`：通过。
- Web：`140 passed`。
- API：`325 passed, 6 warnings`。
- Workflow：`152 passed`。
- Ruff：API 与 Workflow 均 `All checks passed!`。
- OpenAPI：已刷新并通过 `git diff --exit-code -- packages/shared/src/contracts/storyforge.openapi.json` 漂移检查。
- 验证副作用：`.codex/ide-performance-baseline.json` 仅因性能测试刷新时间和耗时变化产生漂移，已恢复，不纳入提交。

## 强推 master 移除 Claude 撰稿人 - 执行记录

时间：2026-06-01 00:06:44 +08:00

### 操作

- 执行 git fetch origin 更新远端跟踪分支。
- 确认当前分支：$branch。
- 执行前本地 HEAD：$localHead。
- 执行前 origin/master：$remoteBefore。
- 已确认本地 master 不包含 Co-Authored-By: Claude、
oreply@anthropic.com 或 nthropic.com。
- 执行 git push --force-with-lease origin master。
- 推送后再次执行 git fetch origin。
- 推送后本地 master：$localAfter。
- 推送后 origin/master：$remoteAfter。

### 结果

- origin/master 已与本地 master 对齐。
- 远端历史搜索未发现 Claude co-author 或 Anthropic noreply 邮箱。
- 当前工作区未提交改动未随本次 push 推送。
## 编码前检查 - 诚实化技能链审计投影

时间：2026-06-01 00:18:30

□ 已查阅上下文摘要文件：.codex/context-summary-honest-skill-audit.md
□ 将使用以下可复用组件：
- NovelSkillRunEvent: apps/workflow/storyforge_workflow/skills/audit.py - 承载事件字段
- _recorded_skill_run_event: apps/workflow/storyforge_workflow/skills/audit.py - 真实 skill_runs 转投影
- _chapter_event / _export_event: apps/workflow/storyforge_workflow/skills/audit.py - 合成事件构造
- ormatEvidenceValue / ReferenceList: apps/web/app/book-runs/audit.tsx - Web 呈现复用
□ 将遵循命名约定：Python snake_case；TSX 组件 PascalCase、函数 camelCase。
□ 将遵循代码风格：dataclass frozen、只读投影、React 现有 <dl>/<ol> 结构。
□ 确认不重复造轮子，证明：检查了 audit.py、novel_loop.py、book_loop.py、workflow_skill_audit_bridge.py、Web audit.tsx，现有构造点可直接扩展。

### 外部资料记录

- Context7 React 官方文档：用于确认简单条件渲染应沿用 JSX 条件表达式，无需新增组件库。
- GitHub code search：
ecorded_event_count reconstructed_event_count audit projection language:Python 无结果；本任务为项目内契约修正，不引入外部实现。

## 编码后声明 - 诚实化技能链审计投影

时间：2026-06-01 00:36:08

### 1. 复用了以下既有组件

- NovelSkillRunEvent: 用于承载技能链事件，位于 pps/workflow/storyforge_workflow/skills/audit.py。
- _recorded_skill_run_event: 用于真实 skill_runs 到投影事件转换，位于 pps/workflow/storyforge_workflow/skills/audit.py。
- _chapter_event / _export_event: 用于从 progress 重建推断事件，位于 pps/workflow/storyforge_workflow/skills/audit.py。
- ormatEvidenceValue / ReferenceList: 用于 Web 审计页现有证据呈现，位于 pps/web/app/book-runs/audit.tsx。

### 2. 遵循了以下项目约定

- 命名约定：Python 继续使用 snake_case，TypeScript 继续使用 PascalCase 组件和 camelCase helper。
- 代码风格：保持 dataclass frozen 投影、React <dl>/<ol> 结构，并使用项目 Prettier 格式化。
- 文件组织：投影逻辑留在 workflow skills，exporter 只通过桥接序列化消费，Web 只负责呈现。

### 3. 对比了以下相似实现

- pps/workflow/storyforge_workflow/skills/audit.py: 仅扩展现有事件构造点，未新增并行投影实现。
- pps/workflow/storyforge_workflow/orchestrators/novel_loop.py: 保留真实 skill_runs 只来自 skill_runner 的语义，本次未接线生产路径。
- pps/web/app/book-runs/audit.tsx: 复用现有通用 Record 渲染模式，只增加证据来源和实录/重建标签。

### 4. 未重复造轮子的证明

- 检查了 udit.py、
ovel_loop.py、ook_loop.py、workflow_skill_audit_bridge.py、udit.tsx，确认已有唯一投影构造和序列化路径。
- 未新增外部依赖，未新增自研执行器，未触碰 WorkflowRuntime 或 LangGraph 执行路径。

### TDD 红绿记录

- 红灯：uv run pytest tests/test_skill_audit_summary.py -q 因 schema v1、缺
ecorded、缺 evidence_basis 失败。
- 红灯：uv run pytest tests/test_book_exporter.py -q 因 schema v1、缺 evidence_basis 失败。
- 红灯：pnpm --filter @storyforge/web test -- book-run-audit.test.tsx 因未渲染“证据来源”失败。
- 绿灯：目标 workflow/API/Web 测试、Workflow ruff、Web 全量测试、pnpm verify 均已通过。

## 端到端验真启动 - skill_runs reconstructed

时间：2026-06-01 01:05:41 +08:00

### 工具与流程记录

- 已按要求先执行 sequential-thinking，再执行 shrimp-task-manager 任务 d2c2406-12ee-4f25-a4be-21a3a06f88ac。
- 当前环境没有提供 desktop-commander 工具；已记录该缺口，并使用 PowerShell、rg、pytest、pnpm 作为本地替代工具。
- 已查询 Context7 React 官方文档，确认
enderToStaticMarkup 可将 React 组件渲染为非交互 HTML 字符串，适合审计页可见性验证。
- 已调用 GitHub search_code 搜索相似开源呈现模式，查询无结果；不作为设计依据。

### 编码前检查 - 端到端验真

□ 已查阅上下文摘要文件：D:\StoryForge\.codex\context-summary-e2e-skill-audit.md
□ 将使用以下可复用组件：

-
un_phase9a_deterministic_smoke: D:\StoryForge\apps\api\app\domains\book_runs\deterministic_smoke.py - 生成本地 mock BookRun 与导出制品。
- export_book_run_audit_report: D:\StoryForge\apps\api\app\domains\exports\book_markdown_exporter.py - 生成 udit_report.json。
- BookRunAuditPanel: D:\StoryForge\apps\web\app\book-runs\audit.tsx - 渲染审计页。

□ 将遵循命名约定：Python snake_case、TypeScript camelCase/PascalCase。
□ 将遵循代码风格：不修改生产代码，只写 .codex 验证产物；验证命令使用项目既有 pytest/pnpm 流程。
□ 确认不重复造轮子，证明：已检查 deterministic smoke、exporter、workflow skill audit、Web audit panel、相关测试。

### 产物路径修正

时间：2026-06-01 01:07:12 +08:00

- 首次 smoke 产物误落到 D:\StoryForge\apps\api\.codex\e2e-skill-audit-20260601-010649。
- 已迁移到项目根要求路径：$right。
- 若源目录为空，已删除 D:\StoryForge\apps\api\.codex。


## 端到端验真执行结果 - skill_runs reconstructed

时间：2026-06-01 01:11:55 +08:00

### 本地验证命令

- cd D:\StoryForge\apps\api; uv run pytest tests/test_phase9a_deterministic_smoke.py -q
  - 结果：通过，1 passed in 0.23s。
- cd D:\StoryForge\apps\api; uv run pytest tests/test_book_exporter.py -q
  - 结果：通过，3 passed in 0.47s。
- cd D:\StoryForge\apps\workflow; uv run pytest tests/test_skill_audit_summary.py -q
  - 结果：通过，11 passed in 0.52s。
- cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit
  - 结果：通过，3 pass / 0 fail。
- cd D:\StoryForge\apps\api; uv run python - <inline deterministic smoke exporter>
  - 结果：通过，生成 BookRun #1、ook.md、udit_report.json、ook_run_for_audit_page.json、smoke-summary.json。
- cd D:\StoryForge\apps\web; node .tmp-audit-render-e2e/render-audit-page.mjs
  - 结果：通过，使用实际导出数据渲染 BookRunAuditPanel，生成 udit-page.html 与 udit-page-visible-checks.json。

### 产物路径

- 正确产物目录：$artifactDir
- 路径修正说明：上一段日志中的 $right 未展开；实际迁移目标为 $artifactDir。

### 浏览器检查说明

- 尝试用 in-app Browser 打开 ile:///D:/StoryForge/.codex/e2e-skill-audit-20260601-010649/audit-page.html 被浏览器安全策略拒绝。
- 按策略未通过绕过方式继续打开本地文件；改用已通过 Context7 核对的 React
enderToStaticMarkup 静态 HTML 与文本断言验证可见性。

### 编码后声明 - 端到端验真

1. 复用了以下既有组件：
   -
un_phase9a_deterministic_smoke：生成本地 mock BookRun 与导出制品。
   - export_book_run_audit_report：生成含 skill_chain 的 udit_report.json。
   - BookRunAuditPanel：渲染审计页文本。
2. 遵循了以下项目约定：
   - 未修改生产代码；只写项目根 .codex 验证产物。
   - 使用项目既有 pytest 与 pnpm 测试入口。
3. 对比了以下相似实现：
   - deterministic smoke、book exporter、workflow skill audit、Web audit panel 均已阅读并复用。
4. 未重复造轮子的证明：
   - 没有新增自研 mock runner、exporter 或审计组件；只用现有路径串联验真。

### 报告可读性修正

时间：2026-06-01 01:13:30 +08:00

- 发现前一段报告由 PowerShell 双引号 here-string 写入时，Markdown 反引号触发了转义字符，导致部分路径和字段显示异常。
- 已追加“端到端验真报告（可读修正版）”，作为本次验真的可读结论来源。
- 未覆盖既有历史报告，避免误删其他任务留痕。

## 架构决策准备：真实 skill_runs 接线路径 a/b 比较

时间：2026-06-01 01:24:45 +08:00

### 本轮操作

- 已执行 sequential-thinking 和 shrimp 任务 `fe4edbd3-c364-4db1-a23d-e7fb28a04e7a`。
- 已搜索 API、workflow、BookLoop、NovelLoop、WorkflowRuntime、LangGraph、skill_runner、audit 相关实现。
- 已读取并分析至少 7 个相关实现路径。
- 已查询 Context7 LangGraph 官方资料，确认当前项目使用的 StateGraph/checkpointer/interrupt/resume 与官方能力一致。
- 已调用 GitHub search_code 搜索 LangGraph 节点审计实现示例；只作为背景，不覆盖本仓库事实。

### 决策结果

- 推荐 a 修正版：补齐 BookRun workflow adapter，在 adapter 的 `run_chapter` 内注入 `NovelSkillRunner`。
- 不推荐直接在 API service 中执行 runner。
- 不推荐当前直接上 b；b 应作为独立 `workflow_node_run.v1` 节点事件体系设计，避免把 graph 节点误标成章节 skill_runs。

### 架构报告复核修正

时间：2026-06-01 01:26:32 +08:00

- 首次复核失败：报告已有内容但缺少可机读短语“至少 7 个相关实现路径”。
- 已追加架构决策准备验收摘要，便于后续自动检查。
- 上一次操作日志追加命令因 PowerShell 双引号字符串解析失败，本段为补偿记录。

## BookRun workflow adapter 实施计划生成

时间：2026-06-01 02:16:55 +08:00

- 已按 writing-plans skill 生成实施计划。
- 计划路径：D:\StoryForge\docs\superpowers\plans\2026-06-01-bookrun-workflow-adapter-skill-runs.md
- 范围：只写计划，不修改生产代码。
- 架构决策：采用 a 修正版，即 workflow adapter 中注入 NovelSkillRunner，不在 API service 中执行 workflow。

### 实施计划占位词修正

时间：2026-06-01 02:17:41 +08:00

- 首次扫描发现自审句子包含禁用占位词的否定表述。
- 已改为不含禁用词的明确表述，并准备重新复核。


## 编码前检查 - BookRun workflow adapter

时间：2026-06-01 02:40:21 +08:00

□ 已查阅上下文摘要文件：.codex/context-summary-bookrun-workflow-adapter.md
□ 将使用以下可复用组件：

- BookLoopRequest /
un_book_loop: pps/workflow/storyforge_workflow/orchestrators/book_loop.py - 复用整书章节编排、预算暂停和 provider 降级逻辑。
- NovelLoopRequest / NovelLoopPorts /
un_single_chapter_loop: pps/workflow/storyforge_workflow/orchestrators/novel_loop.py - 复用单章闭环与 skill_runner 注入点。
- NovelSkillRunner.default: pps/workflow/storyforge_workflow/skills/runner.py - 复用真实技能运行记录。
- export_book_run_audit_report: pps/api/app/domains/exports/book_markdown_exporter.py - 复用 audit_report 导出路径。
□ 将遵循命名约定：Python 使用 snake_case 函数/变量、PascalCase 类、pytest 	est_ 函数。
□ 将遵循代码风格：rom __future__ import annotations、中文意图 docstring、frozen dataclass、ports 注入。
□ 确认不重复造轮子：已检查 ook_loop.py、
ovel_loop.py、
unner.py、udit.py、ook_markdown_exporter.py，adapter 只负责边界转换与 runner 注入。
□ 工具替代说明：AGENTS 要求优先使用 desktop-commander，但当前工具列表和 tool_search 未暴露该工具；本轮使用 PowerShell 进行本地文件操作，并保留可复现命令。

## BookRun workflow adapter 红灯记录

时间：2026-06-01 02:40:44 +08:00

- 命令：cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs -v
- 预期失败：ook_run_adapter 模块不存在。
- 实际结果：pytest 收集 	ests/test_book_run_adapter.py 时报 ModuleNotFoundError: No module named 'storyforge_workflow.orchestrators.book_run_adapter'，符合红灯预期。
- 结论：允许进入 adapter 实现。

## BookRun workflow adapter 单章绿灯记录

时间：2026-06-01 02:42:15 +08:00

- 命令：cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py::test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs -v
  - 结果：通过，1 passed。
- 命令：cd D:\StoryForge\apps\workflow; uv run pytest tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py -v
  - 结果：通过，8 passed。

## 编码后声明 - BookRun workflow adapter 单章实现

时间：2026-06-01 02:42:15 +08:00

### 1. 复用了以下既有组件

- BookLoopRequest /
un_book_loop: 用于整书章节循环、预算暂停和 provider 降级，位于 pps/workflow/storyforge_workflow/orchestrators/book_loop.py。
- NovelLoopRequest / NovelLoopPorts /
un_single_chapter_loop: 用于单章生成闭环与 skill_runner 注入，位于 pps/workflow/storyforge_workflow/orchestrators/novel_loop.py。
- NovelSkillRunner.default: 用于记录真实技能运行，位于 pps/workflow/storyforge_workflow/skills/runner.py。

### 2. 遵循了以下项目约定

- 命名约定：新增 BookRunAdapterRequest、BookRunAdapterPorts、BookRunProgressSink 使用类名 PascalCase；函数
un_book_run_with_skill_runner 使用 snake_case。
- 代码风格：保留 rom __future__ import annotations、frozen dataclass、中文 docstring 和 ports 注入模式。
- 文件组织：adapter 位于 workflow orchestrators 包，不导入 API ORM 或数据库模型。

### 3. 对比了以下相似实现

- ook_loop.py: adapter 只构造 BookLoopRequest 并传入
un_chapter，不复制 BookLoop 状态机。
-
ovel_loop.py: adapter 复用 skill_runner 参数，不修改 NovelLoop 内部流程。
-
unner.py: adapter 每章创建独立 runner，避免跨章共享
uns 状态。

### 4. 未重复造轮子的证明

- 检查了 ook_loop.py、
ovel_loop.py、
unner.py、udit.py 和 exporter；不存在已完成的 BookRun workflow adapter，新增文件只承担边界转换和 progress sink 回填。

## BookRun workflow adapter 边界路径验证记录

时间：2026-06-01 02:45:32 +08:00

### 调试记录

- 失败现象：	est_book_run_adapter_preserves_awaiting_review_with_recorded_generate_and_judge 首次收到 generate/judge/repair/judge，而预期为 generate/judge。
- 根因：
un_single_chapter_loop() 过去把 judge 返回的所有非 pass 状态都视为可修复状态；waiting_review 被误送入 repair。
- 最小修正：仅当 judge 状态为既有可修复状态
epair 或 ail 时继续 repair；waiting_review 立即跳出并返回人工审查。
- 回归保护：同时运行 	est_novel_loop_single_chapter.py，确认既有 ail 后修复通过语义未被破坏。

### 验证命令

- 命令：cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py -v
  - 结果：通过，4 passed。
- 命令：cd D:\StoryForge\apps\workflow; uv run pytest tests/test_novel_loop_single_chapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py tests/test_novel_skill_registry.py tests/test_novel_skill_runner.py -v
  - 结果：通过，30 passed。

## BookRun recorded skill_runs API 导出验收记录

时间：2026-06-01 02:47:10 +08:00

- 命令：cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_recorded_skill_runs_export.py -v
  - 结果：通过，1 passed。
- 命令：cd D:\StoryForge\apps\api; uv run pytest tests/test_book_exporter.py -v
  - 结果：通过，3 passed。
- 结论：带 recorded skill_runs 的 BookRun progress 可被现有 audit_report exporter 消费；export 事件仍保持 reconstructed，不伪装为章节实录。

## BookRun workflow adapter recorded skill_runs 最终本地验证记录

时间：2026-06-01 02:49:59 +08:00

### 验证命令

- cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v
  - 结果：通过，30 passed。
- cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v
  - 结果：通过，12 passed, 1 warning；warning 为既有 HTTP_422_UNPROCESSABLE_ENTITY deprecation。
- cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit
  - 结果：通过，3 pass / 0 fail。
- cd D:\StoryForge\apps\workflow; uv run pytest -q
  - 结果：通过，156 passed。
- cd D:\StoryForge\apps\api; uv run pytest -q
  - 结果：通过，326 passed, 6 warnings；warnings 为既有 JWT 测试密钥长度提醒和 HTTP 422 deprecation。

### 实施结果摘要

- 新增 workflow adapter：pps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py。
- 新增 workflow adapter 测试：pps/workflow/tests/test_book_run_adapter.py。
- 新增 API exporter recorded skill_runs 验收：pps/api/tests/test_book_run_recorded_skill_runs_export.py。
- 修正 NovelLoop：judge 返回 waiting_review 时不再误进入 repair；保留既有 ail /
epair 可修复语义。

### 风险记录

- 当前分支从已有脏工作区切出，工作区仍包含本任务外的历史未提交改动；本次验证命令覆盖了本任务相关 workflow/API/web 路径。
- .worktrees 目录存在但未被 .gitignore 忽略，本轮未在其中创建新 worktree，避免引入额外污染。


## BookRun workflow adapter ???????????

???2026-06-01 02:51:11 +0800

### ??????

- ?? workflow adapter?`apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`?
- ?? orchestrators ???`apps/workflow/storyforge_workflow/orchestrators/__init__.py`?
- ?? NovelLoop ???`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py` ? `awaiting_review` ????? repair??? `fail` / `repair` ???????
- ?? workflow ???`apps/workflow/tests/test_book_run_adapter.py`?
- ?? API ?????`apps/api/tests/test_book_run_recorded_skill_runs_export.py`?
- ????????`.codex/context-summary-bookrun-workflow-adapter.md`?

### ??????

- `cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v`????30 passed?
- `cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v`????12 passed, 1 warning?
- `cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit`????3 pass / 0 fail?
- `cd D:\StoryForge\apps\workflow; uv run pytest -q`????156 passed?
- `cd D:\StoryForge\apps\api; uv run pytest -q`????326 passed, 6 warnings?

### ??

- ??????? Markdown ???? PowerShell ??? here-string ??????????????????
- ?? Python ? UTF-8 ? BOM ???????/??????????????


## BookRun workflow adapter ???????

???2026-06-01 02:52:25 +0800

- ????????????/????? UTF-8 BOM????????????
- ????????workflow ???????`30 passed`?
- ??? API ????????`12 passed, 1 warning`?
- ??? Web ????????`3 pass / 0 fail`?
- ??? workflow ????????`156 passed`?
- ??? API ????????`326 passed, 6 warnings`?
- ???????????? UTF-8 BOM ?????


## ???????

???2026-06-01 02:58:16 +0800

- `git diff --cached --check`??????????
- workflow ruff ????????`All checks passed!`?
- API ruff ????????`All checks passed!`?
- workflow ????????`30 passed`?
- API ????????`12 passed, 1 warning`?
- Web ????????`3 pass / 0 fail`?
- workflow ????????`156 passed`?
- API ????????`326 passed, 6 warnings`?

## 执行 BookRun workflow adapter 计划启动

时间：2026-06-01 03:45:35 +08:00

### 执行环境决策

- 当前分支：codex/bookrun-workflow-adapter，不在 main/master。
- `.worktrees` 目录存在但未被 gitignore 忽略，按安全规则不在其中创建新 worktree。
- 本次在当前功能分支执行，并记录该偏离。
- 计划中的“红灯后提交”会调整为“红灯记录、绿灯后提交”，避免提交不可用状态。

## BookRun workflow adapter 复核验证

时间：2026-06-01 03:52:48 +08:00

- 计划文件 docs/superpowers/plans/2026-06-01-bookrun-workflow-adapter-skill-runs.md 全部任务已勾选完成。
- 最近提交：ab0a53e 完成 BookRun workflow adapter recorded skill_runs。
- 本轮重新运行目标测试、lint、workflow/API 全量测试和 Web 审计回归，结果均通过；详见 .codex/verification-report.md 的“BookRun workflow adapter recorded skill_runs 复核记录”。
- 当前仍存在任务外 .codex 历史未跟踪/修改文件，未纳入本任务结论。

## 项目健康评估规划文档生成

时间：2026-06-01 04:13:39 +08:00

- 当前分支：codex/project-health-assessment-plan。
- 新增设计方案：docs/superpowers/specs/2026-06-01-project-health-assessment-design.md。
- 新增执行计划：docs/superpowers/plans/2026-06-01-project-health-assessment.md。
- 本轮仅生成规划文档，未修改 apps 业务代码，未恢复历史 stash。

## 项目健康评估启动

时间：2026-06-01 04:18:46 +08:00

- 当前分支：codex/project-health-assessment-plan。
- 最近提交：0de0c4c 新增 StoryForge 项目健康评估计划。
- 本轮评估目标：主链路、架构边界、测试健康度和下一步路线图。
- 本轮不修改业务代码，不恢复历史 stash。
- 已读取关键模块：book_run_adapter.py、book_loop.py、novel_loop.py、skills/audit.py、book_runs/service.py、book_markdown_exporter.py、audit.tsx。

## 项目健康评估本地验证

时间：2026-06-01 04:20:41 +08:00

- workflow ruff：通过。
- workflow pytest：156 passed。
- API ruff：通过。
- API pytest：326 passed, 6 warnings。
- Web audit contract：3 pass / 0 fail。
- workflow 主链路目标测试：27 passed。
- API 主链路目标测试：12 passed, 1 warning。
- 结论：当前本地门禁通过；warnings 均为非阻塞治理项。

## 项目健康评估架构边界分析

时间：2026-06-01 04:22:21 +08:00

- 已运行 API/workflow 边界搜索：workflow 未直接依赖 API ORM；API service 未直接执行 workflow adapter。
- 已运行 adapter 使用点搜索：run_book_run_with_skill_runner 当前仅在 tests、orchestrators __init__ 和 adapter 实现中出现。
- 已运行 recorded/reconstructed 证据边界搜索：workflow/API/Web 均有最小暴露测试覆盖。
- 主要结论：生产触发接线缺口是 P0；API exporter 动态加载 workflow audit.py 是 P1；source_refs 与 warnings 属于治理项。

## 项目健康评估收尾

时间：2026-06-01 04:24:50 +08:00

- 评估报告：D:\StoryForge\.codex\project-health-assessment.md。
- 验证报告：D:\StoryForge\.codex\verification-report.md。
- 推荐下一步：BookRun workflow adapter 生产调度接线设计与测试。
- 综合评分：86/100。
- 完整性检查：必需章节均存在；未发现 TBD、TODO、待补、占位。
- 未处理事项：adapter 未接入生产触发路径、progress sink 真实实现缺失、workflow_skill_audit_bridge 动态路径桥接风险、API warnings、phase9b smoke 可维护性。

## BookRun 生产调度接线计划生成

时间：2026-06-01 04:30:30 +08:00

- 当前分支：codex/bookrun-production-dispatch。
- 新增上下文摘要：.codex/context-summary-bookrun-production-dispatch.md。
- 新增执行计划：docs/superpowers/plans/2026-06-01-bookrun-production-dispatch.md。
- 计划约束：API 只生成 dispatch payload，不直接执行 workflow；workflow 消费 payload 并通过 progress sink 回填。

## BookRun workflow dispatch API 契约

时间：2026-06-01 04:35:36 +08:00

- 已先运行红灯：uv run pytest tests/test_book_run_workflow_dispatch.py -v，失败原因为 uild_book_run_workflow_dispatch 不存在。
- 已新增 API dispatch schema、service 构造函数和 GET /api/book-runs/{book_run_id}/workflow-dispatch。
- 验证：uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_book_runs.py -v → 11 passed, 1 warning。

## BookRun workflow dispatch payload 消费入口

时间：2026-06-01 04:38:40 +08:00

- 已先运行红灯：uv run pytest tests/test_book_run_dispatch_payload.py -v，失败原因为 CallableProgressSink /
un_book_run_dispatch_payload 不存在。
- 已新增 CallableProgressSink 与
un_book_run_dispatch_payload()，workflow 可消费 API 形状 dispatch payload。
- 验证：uv run pytest tests/test_book_run_dispatch_payload.py tests/test_book_run_adapter.py -v → 7 passed。

## BookRun workflow dispatch 生产接线契约收尾

时间：2026-06-01 04:41:26 +08:00

- API 目标回归：15 passed, 1 warning。
- workflow 目标回归：25 passed。
- API ruff：通过；API 全量：329 passed, 6 warnings。
- workflow ruff：通过；workflow 全量：159 passed。
- Web audit contract：3 pass / 0 fail。
- 结论：计划已执行完成；当前实现关闭了“只有测试内部能构造 adapter 输入”的缺口，留下真实外部 worker/HTTP sink 部署为后续任务。

## 当前小说运行验证启动

时间：2026-06-01 14:00:00 +08:00

- 用户目标：确认“现在能跑一篇小说吗”。
- 已按顺序执行 sequential-thinking、shrimp-task-manager 分析与任务拆分。
- 工具缺失记录：本地未暴露 `desktop-commander` 和 `github.search_code`，已用 PowerShell 与 `rg` 补位；Context7 已查询 pytest 指定测试运行文档，用于确认本地冒烟验证方式。
- 编码前检查：本轮不修改业务代码，只运行验证与生成制品；上下文摘要已写入 `.codex/context-summary-run-novel-now.md`。
- 已分析相似实现：`deterministic_smoke.py`、`phase9b_real_llm_smoke.py`、`book_loop.py`、`book_run_adapter.py`、对应 API/workflow 测试。
- 当前判断：deterministic/mock 三章小说闭环应可本地运行；真实 LLM 一章或三章需要私有环境变量，必须先 preflight。

## 当前小说运行验证结果

时间：2026-06-01 14:10:00 +08:00

- deterministic 三章本地闭环：`cd D:\StoryForge\apps\api; uv run pytest tests/test_phase9a_deterministic_smoke.py -q` → 1 passed。
- 真实 LLM 缺配置 preflight：`cd D:\StoryForge\apps\api; uv run pytest tests/test_phase9b_real_llm_smoke.py::test_phase9b_real_llm_smoke_reports_missing_private_env -q` → 1 passed。
- workflow 三章编排：`cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_loop_three_chapters.py -q` → 5 passed。
- deterministic 实际产物：`.codex/current-novel-smoke/book.md` 与 `.codex/current-novel-smoke/audit_report.json`，状态 completed，正文词数 3468。
- 用户提供的网关配置第一次使用模型名 `gpt5.4mini` 调用返回 HTTP 503；随后通过 `/v1/models` 确认实际模型 ID 为 `gpt-5.4-mini`。
- 真实 LLM 1 章冒烟：状态 completed，tokens_used 5360，产物写入 `.codex/real-llm-now/`。
- 真实 LLM 3 章冒烟：状态 completed，tokens_used 22929，产物写入 `.codex/real-llm-3ch-now/`。
- 产物复核：`book.md` 存在且包含 3 个章节标题；`audit_report.json` 存在且包含 3 章，平均质量分 94.67。
- 密钥安全：仓库扫描未发现用户提供的密钥片段落盘；密钥仅作为当前命令进程环境变量使用。
## UI/UX 优化上下文收集

时间：2026-06-01 15:33:05 +08:00

### 工具与流程

- 已按用户要求先执行 `sequential-thinking` 梳理需求、风险和执行顺序。
- 已使用 `shrimp-task-manager` 分析、反思并拆分任务：收集上下文、澄清目标、提出设计。
- `desktop-commander` 与 `github.search_code` 未在当前工具列表或 `tool_search` 中暴露；本轮记录缺口，并使用 PowerShell、`rg` 和 Context7 替代。
- 已查询 Context7：
  - `/vercel/next.js`：用于确认 App Router layout、薄页面、客户端组件隔离、`router.push()` 事件导航。
  - `/tailwindlabs/tailwindcss.com`：用于确认响应式、暗色模式、hover/focus/data 状态工具类。

### 已分析的相似实现

- `apps/web/components/home/HomeShell.tsx`：首页深色创作入口和专用组件组合。
- `apps/web/components/home/HomeComposer.tsx`：客户端输入框、默认跳转和可访问 label。
- `apps/web/components/ide/shell/IdeShell.tsx`：深色生产力工作台、面板尺寸变量和 URL 状态。
- `apps/web/app/studio/StudioFlow.tsx`：步骤流状态、自动滚动和 `aria-current`。
- `apps/web/components/site-nav/SiteNav.tsx`：移动端折叠导航与全局菜单数据源。

### 编码前检查 - UI/UX 优化设计阶段

□ 已查阅上下文摘要文件：`.codex/context-summary-uiux.md`

□ 将优先使用以下可复用组件：

- `apps/web/components/home/home-data.ts`：首页导航和快捷动作事实源。
- `apps/web/components/site-nav/site-nav-links.ts`：全局导航事实源。
- `apps/web/components/ui/LoadingSkeleton.tsx`：加载状态。
- `apps/web/components/ui/ErrorCard.tsx`：错误状态。
- `apps/web/components/judge-panel/JudgeIssueList.tsx`：评审问题交互。
- `apps/web/components/diff-viewer/RepairDiffViewer.tsx`：修订差异展示。

□ 将遵循命名约定：React 组件 PascalCase，常量 camelCase，测试描述使用简体中文。

□ 将遵循代码风格：Next App Router 薄页面、Tailwind utility class、交互组件才使用 `'use client'`。

□ 确认不重复造轮子，证明：已检查首页、IDE、Studio、全局导航、UI 基础组件和现有测试；后续设计应优先统一这些既有模式，而不是新增独立设计系统。

### 当前结论

- 项目已经完成过 Claude-like 首页改造，当前优化更适合聚焦“体验一致性和细节打磨”：统一首页、IDE、Studio 和全局导航的密度、状态、色彩和移动端行为。
- 设计获用户批准前，不修改业务代码。

## 首页输入优先 UI/UX 设计确认

时间：2026-06-01 16:44:20 +08:00

### 用户确认

- 优化范围：`A：首页细节打磨`。
- 优先目标：`使用更顺手`。
- 方案选择：`A：输入优先`。
- 范围裁剪：用户明确删除移动端专项方案；本轮仅保留基础响应式兜底，不做移动端专项设计。

### 设计文档

- 已写入：`docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md`。
- 自查结果：未发现 `TBD`、`TODO`、`待定`、`占位`、`后续再说`、`不确定` 等占位或歧义词。
- 设计约束：不新增后端契约、不实现聊天系统、不修改 IDE/Studio 等非首页页面、不引入新设计系统。

## StoryForge Assistant 方向确认

时间：2026-06-01 17:37:25 +08:00

### 用户反馈

- 用户明确希望首页像有 AI Assistant 一样，通过对话框完成创作。
- Assistant 应在对话消息里展示流程和工具调用。
- 用户提供了终端式树状工具流程参考。
- 用户明确删除“深度思考”“专家模式”等模式按钮。
- 用户确认采用单层统一工具流程树：中文阶段、工具名、耗时、tokens、tool uses 和状态合并展示。

### 文档修订

- 已将 `docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md` 从“首页输入优先 UI/UX 打磨设计”修订为“StoryForge Assistant 对话式首页设计”。
- 新设计强调 Assistant 消息流、底部对话输入框、消息内工具流程树和现有 BookRun/Judge/Repair/Artifact 事实源映射。

## Assistant 初始界面导航与问候确认

时间：2026-06-01 18:10:41 +08:00

### 用户确认

- 初始界面可以模仿 Claude 的左侧栏和首屏节奏。
- `New chat` 改为 `New project 新建项目`。
- 移除 `Chats` 和 `Code`。
- 保留并本土化 `Projects 项目`、`Artifacts 产物`、`Customize 创作偏好`。
- 大屏问候语应基于现实时间和登录用户动态生成。
- `Customize 创作偏好` 后续单独设计，职责限定为文风、题材偏好和 Assistant 行为，不混入 Provider/API Key 系统设置。

## Provider/API Key 系统设置归属确认

时间：2026-06-01 19:04:11 +08:00

### 需求与范围

- 用户基于参考截图追问 Provider/API Key 是否应放在账号/工作区菜单里。
- 本轮结论：Provider/API Key、运行环境、语言、帮助、升级和退出属于系统设置，应放入账号/工作区菜单或设置入口；`Customize 创作偏好` 只保留文风、题材偏好、Assistant 行为和默认流程。
- 本轮只更新规格与本地审查记录，不修改业务代码。

### 工具与缺口

- 已按要求先使用 `sequential-thinking` 梳理附件内容和续作目标。
- 已使用 `shrimp-task-manager` 分析、反思并拆分任务。
- `desktop-commander` 未在当前工具列表或 `tool_search` 中暴露；本轮记录缺口，并使用 PowerShell、`rg` 与 `Get-Content` 完成等价本地检索。
- 已使用 `github.search_code` 查询 `"Provider Base URL" "Settings" "localStorage" language:TypeScript`，确认开源 AI 应用常将 Provider 配置放在 settings/store 层；本轮仅借鉴系统设置归属原则。

### 编码前检查 - Provider/API Key 系统设置归属

□ 已查阅上下文摘要文件：`.codex/context-summary-provider-api-key-settings.md`

□ 将使用以下可复用组件：

- `docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md`：承载 Assistant 首页信息架构规格。
- `apps/web/components/home/HomeShell.tsx`：现有首页顶部工作区/Provider 状态链接 `/settings`。
- `apps/web/app/settings/SettingsClient.tsx`：现有 Provider Base URL 设置页。
- `apps/web/tests/settings-page.test.ts`：保护设置页不渲染密钥输入框。

□ 将遵循命名约定：上下文摘要使用任务名，规格章节沿用数字标题，系统菜单项使用中英双语短标签。

□ 将遵循代码风格：所有文档与日志使用简体中文；不新增占位符和未验证承诺。

□ 确认不重复造轮子，证明：已检查首页规格、Claude-like 首页规格、HomeShell、HomeSidebar、home-data、SettingsClient、settings-page 测试和 Provider 页面，确认已有 `/settings` 与 Provider 状态入口，只需收紧信息架构归属。

### 编码后声明 - Provider/API Key 系统设置归属

#### 1. 复用了以下既有组件

- `docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md`：继续作为 Assistant 首页设计事实源。
- `/settings` 设置入口：承接模型、Provider 和运行环境设置，不新增独立页面。
- `settings-page.test.ts` 的“不渲染密钥输入框”约束：作为后续实现安全边界参考。

#### 2. 遵循了以下项目约定

- 命名约定：新增章节为 `3.1.2 账号/工作区菜单`，与现有 `3.1.1 大屏动态问候` 同层。
- 代码风格：Markdown 短段落和列表表达，所有说明使用简体中文。
- 文件组织：上下文摘要、操作日志和验证报告均写入项目本地 `.codex/`。

#### 3. 对比了以下相似实现

- `HomeShell.tsx`：现有顶部 Provider 状态已链接 `/settings`，规格与实现方向一致。
- `SettingsClient.tsx`：Provider Base URL 已在设置页管理，说明系统设置入口已有基础。
- `settings-page.test.ts`：明确设置页不渲染 API Key 输入框，本轮规格保持该安全边界。

#### 4. 未重复造轮子的证明

- 未新增页面、组件或配置模型。
- 未把 Provider/API Key 复制到 `Customize 创作偏好`。
- 未引入新的设置系统，只把既有 `/settings` 和账号/工作区菜单的职责写清楚。

## StoryForge Assistant 首页 UIUX 实现收尾

时间：2026-06-01 20:08:18 +08:00

### 范围确认

- 本轮目标：把首页从旧输入优先布局落到 `StoryForge Assistant` 对话式桌面首页，实现左侧四入口、Assistant 消息流、单层工具流程树、底部输入框和账号/工作区菜单。
- 用户最新调整：移动端先不整，因此移动端视觉验收不作为本轮完成条件；已有移动端截图仅作为过程产物保留。
- 保持边界：不修改后端 API，不新增密钥输入框，不伪造 Provider 正常状态，不改无关业务页面。

### 子代理与计划结论

- 子代理 `019e8304-d844-7191-9263-dd18d2a9a1ed` 已用于梳理规格和测试验收清单。
- 子代理 `019e8305-3d19-73d0-91d9-4a9f57a2ba7d` 已用于梳理桌面视觉验收清单。
- `Provider/API Key` 归属账号/工作区菜单和 `/settings`，`Customize 创作偏好` 只承担文风、题材偏好和 Assistant 行为设置。

### 编码后声明 - StoryForge Assistant 首页 UIUX

#### 1. 复用了以下既有组件

- `apps/web/components/home/HomeShell.tsx`：继续作为首页组合入口，替换为 Assistant 消息流布局。
- `apps/web/components/home/HomeSidebar.tsx`：承接左侧主导航、最近记录和账号/工作区菜单。
- `apps/web/components/home/HomeComposer.tsx`：承接底部输入框能力，删除创作模式按钮。
- `apps/web/app/settings` 与设置页契约测试：承接 Provider/API Key 系统设置归属。

#### 2. 遵循了以下项目约定

- 命名约定：组件继续使用 `Home*` 前缀，新组件使用 `AssistantToolTree` 和 `HomeGreeting`，测试仍写入 `home-page.test.tsx`。
- 代码风格：React 组件保持函数式组合，静态首页数据集中到 `home-data.ts`，文案和报告全部使用简体中文。
- 文件组织：实现位于 `apps/web/components/home/`，契约测试位于 `apps/web/tests/`，规格和验证记录写入 `docs/superpowers/specs/` 与项目本地 `.codex/`。

#### 3. 对比了以下相似实现

- `HomeShell.tsx` 旧实现：保留首页壳层职责，删除旧导航卡片和上下文条，改为 Assistant 首屏。
- `HomeSidebar.tsx` 旧实现：保留侧栏入口职责，收敛为 `New project`、`Projects`、`Artifacts`、`Customize` 四入口。
- `settings-page.test.ts`：沿用设置页 Provider 归属与“不渲染 API Key 输入框”安全边界。

#### 4. 未重复造轮子的证明

- 未新增后端设置模型或 Provider 检测 API。
- 未新增独立偏好系统，`Customize` 只作为导航入口保留。
- 未新增视觉框架或第三方 UI 依赖，仅使用既有 React、Next.js 和 CSS/Tailwind 风格。

### 本地验证记录

- `pnpm --filter @storyforge/web test`：138 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- `git diff --check -- apps/web/app/page.tsx apps/web/components/home apps/web/tests/home-page.test.tsx apps/web/tests/phase1-navigation.test.tsx apps/web/tests/settings-page.test.ts docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md .codex`：退出码 0。
- `Invoke-WebRequest http://127.0.0.1:3000`：HTTP 200。
- `pnpm exec playwright screenshot --viewport-size="1440,900" http://127.0.0.1:3000 D:\StoryForge\.codex\uiux-home-desktop-final.png`：桌面截图生成成功。

### 工具缺口与补偿

- 当前工具集中未暴露 `desktop-commander`，继续使用 PowerShell、`rg`、`Get-Content` 和 Playwright CLI 完成本地检索与验证。
- Playwright CLI 可截图，但 Node/Python 运行时未能直接解析 `playwright` 模块；DOM 自动量测未纳入最终验收，已用契约测试、TypeScript 检查、HTTP 200 和桌面截图补偿。

## StoryForge Assistant 首页首屏与账号弹层修正

时间：2026-06-01 20:44:20 +08:00

### 用户反馈

- 当前截图第六张把工具流程树作为首屏大卡片展示，用户指出不应放在那里，应更接近参考图 1 的输入优先首页和参考图 2 的对话后流程展示。
- 当前账号/工作区菜单常驻展开，用户指出应像参考图 4/5 一样点击左下账号区后弹出。

### 实现记录

- `HomeShell.tsx`：移除首屏默认渲染的 Assistant 回复卡片和 `AssistantToolTree`，改为动态问候 + 单个大输入框 + 快捷动作；同时用 `!w-full`、`!m-0`、`!p-0` 覆盖全局 `main` 样式，消除侧栏与主区域之间的黑带。
- `HomeComposer.tsx`：输入框下方增加 `Blueprint 蓝图`、`Chapter 章节`、`Review 审阅`、`Export 导出` 快捷动作；发送按钮改为圆形上箭头，更贴近参考图的输入操作。
- `HomeSidebar.tsx`：转为客户端组件，左下账号区使用 `useState`、`aria-expanded` 和 `aria-controls` 控制弹层；默认不显示 `Provider/API Key` 菜单项，点击后弹出。
- `next.config.ts`：发现开发服务器 CSP 阻止 Next dev 客户端水合，导致点击事件不生效；仅在 `NODE_ENV=development` 加入 `unsafe-eval`，生产 CSP 保持不放开。
- `home-page.test.tsx` 与 `phase1-navigation.test.tsx`：补充首屏输入优先、菜单条件渲染、开发 CSP 水合能力的契约断言。

### 本地验证记录

- `pnpm --filter @storyforge/web test -- home-page`：7 pass / 0 fail。
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- 重启本地 dev server：`http://127.0.0.1:3000` 可访问。
- Playwright 点击验证：展开前 `hasToolTree=false`、`hasProviderMenuItem=false`、`aria-expanded=false`、无横向溢出；点击账号区后 `hasProviderMenuItem=true`、`aria-expanded=true`、`role=menu`、无页面错误。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app/page.tsx apps/web/components/home apps/web/tests/home-page.test.tsx apps/web/tests/phase1-navigation.test.tsx apps/web/next.config.ts .codex`：退出码 0。

### 视觉产物

- 首屏输入优先截图：`.codex/uiux-home-input-first-fixed.png`。
- 账号菜单弹层截图：`.codex/uiux-home-account-popover-fixed.png`。

## 首页主题水合失败修复

时间：2026-06-01 21:05:47 +08:00

### 用户反馈

- 浏览器控制台报错：`Hydration failed because the server rendered HTML didn't match the client`。
- 差异位置：`<html lang="zh-CN">` 服务端无 `data-theme="dark"`，客户端加载前出现 `data-theme="dark"`。
- 页面表现：访问 `http://127.0.0.1:3000/?intent=` 时进入 `页面暂时不可用`，错误为 `Cannot read properties of undefined (reading 'call')`。

### 根因

- `app/layout.tsx` 的内联主题脚本会在 React 水合前读取 `localStorage.storyforge-theme` 或系统暗色偏好，并修改 `document.documentElement.dataset.theme='dark'`。
- 服务端无法读取浏览器 localStorage，因此初始 HTML 不包含 `data-theme`。
- React 水合时发现根 `<html>` 属性不一致，触发水合失败，后续客户端事件处理可能不稳定。

### 修复

- 在 `app/layout.tsx` 的根 `<html>` 上添加 `suppressHydrationWarning`，明确允许主题脚本造成的预水合 html 属性差异。
- 保留主题脚本和 `data-theme="dark"` 语义，不删除暗色模式能力。
- 在 `HomeComposer.tsx` 保留 `action="/blueprints"` 与 `method="get"`，即使客户端未水合也不会退回提交到 `/?intent=`。
- 在 `phase1-navigation.test.tsx` 与 `home-page.test.tsx` 增加对应契约检查。

### 本地验证记录

- `pnpm --filter @storyforge/web test -- phase1-navigation home-page`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- Playwright 复现验证：先写入 `localStorage.storyforge-theme='dark'`，再访问 `http://127.0.0.1:3000/?intent=`；结果 `htmlTheme=dark`、`hasErrorPage=false`、`hasAssistant=true`、`hydrationErrors=[]`、`pageErrors=[]`。
- Playwright 提交验证：从 `/?intent=` 点击提交按钮后跳转到 `http://127.0.0.1:3000/blueprints`。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app/layout.tsx apps/web/components/home/HomeComposer.tsx apps/web/tests/home-page.test.tsx apps/web/tests/phase1-navigation.test.tsx .codex`：退出码 0。

## error.tsx 嵌套 html 修复

时间：2026-06-01 21:17:39 +08:00

### 用户反馈

- 控制台报错：`In HTML, <html> cannot be a child of <body>`。
- 堆栈显示 `RootLayout` 已渲染 `<html><body>`，而 `app/error.tsx` 的错误边界又返回 `<html lang="zh-CN"><body>...`。

### 根因与修复

- `app/error.tsx` 是 App Router 的段级错误边界，会在根布局内部渲染，不能返回 `html` 或 `body`。
- 已将 `app/error.tsx` 改为只返回 `<main aria-labelledby="global-error-title">...</main>`。
- 保留 Sentry 上报、错误消息和 `reset()` 重试按钮。
- `phase1-navigation.test.tsx` 增加断言：`app/error.tsx` 不得包含 `<html` 或 `<body`。

### 本地验证记录

- `pnpm --filter @storyforge/web test -- phase1-navigation home-page`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- Playwright 控制台验证：访问 `http://127.0.0.1:3000/?intent=`，`nestedHtmlErrors=[]`、`hydrationErrors=[]`、`pageErrors=[]`、`hasAssistant=true`、`hasErrorPage=false`。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app/error.tsx apps/web/tests/phase1-navigation.test.tsx .codex`：退出码 0。

## 清理 Next dev 缓存并重启验证

时间：2026-06-01 21:26:19 +08:00

### 根因补充

- 源码层 hydration 问题已修复后，用户浏览器仍看到 `Cannot read properties of undefined (reading 'call')` 错误边界。
- dev server 日志显示 `/` 与 `/?intent=` 均返回 200，无服务端应用栈。
- 该错误形态符合 Next dev 热更新后浏览器旧 chunk 与 `.next` module runtime 不一致。

### 操作记录

- 已确认删除目标 `D:\StoryForge\apps\web\.next` 位于项目目录 `D:\StoryForge` 下。
- 已停止 3000 端口 Next dev 进程。
- 已删除 `D:\StoryForge\apps\web\.next` 生成缓存。
- 已重新启动 `pnpm --filter @storyforge/web dev --hostname 127.0.0.1 --port 3000`，当前 3000 端口返回 HTTP 200。

### 本地验证记录

- Playwright 访问 `http://127.0.0.1:3000/`：HTTP 200、`hasErrorPage=false`、`hasAssistant=true`、`badEvents=[]`。
- Playwright 访问 `http://127.0.0.1:3000/?intent=`：HTTP 200、`hasErrorPage=false`、`hasAssistant=true`、`badEvents=[]`。
- `pnpm --filter @storyforge/web test -- phase1-navigation home-page`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。

## 首页桌面比例自适应修正

时间：2026-06-01 21:36:56 +08:00

### 用户反馈

- 用户指出当前首页比例不舒服，并追问是否可以自适应调整。
- 本轮边界：优先处理桌面端比例，移动端专项暂不处理。

### 编码前检查 - 首页桌面比例自适应

□ 已查阅上下文摘要文件：`.codex/context-summary-uiux.md`

□ 将使用以下可复用组件：

- `apps/web/components/home/HomeShell.tsx`：首页桌面栅格和主内容居中容器。
- `apps/web/components/home/HomeSidebar.tsx`：首页左侧导航密度和账号弹层。
- `apps/web/components/home/HomeComposer.tsx`：首页输入框、发送按钮和快捷动作。
- `apps/web/components/home/HomeGreeting.tsx`：问候区标题、说明和垂直节奏。
- `apps/web/tests/phase1-navigation.test.tsx`：首页导航与布局契约测试。

□ 将遵循命名约定：React 组件使用 PascalCase，静态数据使用 camelCase，测试描述使用简体中文。

□ 将遵循代码风格：保持函数式 React 组件、Tailwind utility class、首页专用组件拆分和文本契约测试模式。

□ 确认不重复造轮子，证明：已检查首页组件、`.codex/context-summary-uiux.md`、`phase1-navigation.test.tsx` 和 Tailwind 官方文档；现有方案只需用 CSS `clamp()`/`minmax()` 改善桌面比例，不新增布局系统或第三方 UI 库。

### 外部资料与根因

- Context7 查询 Tailwind CSS 官方文档，确认任意值语法支持 `calc()` 等 CSS 函数；本轮继续使用 Tailwind 任意值表达 `clamp()` 与 `minmax()`。
- GitHub `search_code` 查询到公开项目中存在 `grid-cols-[clamp...]` 一类 Tailwind 响应式写法，作为语法可行性参考。
- 失败测试根因：旧契约仍精确要求 `md:grid-cols-[280px_1fr]`，与用户要求的自适应比例冲突；应更新测试契约，而不是回退实现。

### 当前修正

- `phase1-navigation.test.tsx` 已把首页桌面布局契约更新为 `md:grid-cols-[clamp(232px,16vw,280px)_minmax(0,1fr)]`。
- 测试同时覆盖主内容 `max-w-[min(920px,72vw)]` 和输入框 `max-w-[clamp(620px,58vw,860px)]`，防止后续退回固定宽度。

### 本地验证记录

- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- Playwright CLI 截图生成成功：
  - `.codex/uiux-home-responsive-1366.png`
  - `.codex/uiux-home-responsive-1440.png`
  - `.codex/uiux-home-responsive-1808.png`
- Playwright DOM 量测：
  - 1366×768：HTTP 200，`hasErrorPage=false`，`hasAssistant=true`，`scrollWidth=1366`，`clientWidth=1366`，`composerWidth=792`，`badEvents=[]`。
  - 1440×900：HTTP 200，`hasErrorPage=false`，`hasAssistant=true`，`scrollWidth=1440`，`clientWidth=1440`，`composerWidth=808`，`badEvents=[]`。
  - 1808×768：HTTP 200，`hasErrorPage=false`，`hasAssistant=true`，`scrollWidth=1808`，`clientWidth=1808`，`composerWidth=808`，`badEvents=[]`。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app apps/web/components/home apps/web/tests .codex`：退出码 0。

### 编码后声明 - 首页桌面比例自适应

#### 1. 复用了以下既有组件

- `HomeShell.tsx`：继续承载首页布局壳层，用 CSS `clamp()` 控制桌面侧栏、主内容宽度和垂直位置。
- `HomeSidebar.tsx`：继续承载左侧导航和账号弹层，用 `clamp()` 调整桌面密度。
- `HomeComposer.tsx`：继续承载 Assistant 输入入口，用 `clamp()` 控制输入框宽度、高度和操作按钮尺寸。
- `HomeGreeting.tsx`：继续承载动态问候，用 `clamp()` 控制标题和说明层级。

#### 2. 遵循了以下项目约定

- 命名约定：未新增命名体系，测试仍使用简体中文描述。
- 代码风格：继续使用 Tailwind utility class 和首页专用组件组合。
- 文件组织：实现保持在 `apps/web/components/home/`，验证记录写入项目本地 `.codex/`。

#### 3. 对比了以下相似实现

- `HomeShell.tsx` 旧固定栅格：本轮改为自适应栅格，避免在 1366 与超宽桌面上比例失衡。
- `HomeComposer.tsx` 旧固定输入框：本轮改为 `clamp(620px,58vw,860px)`，在常见桌面宽度内保持舒适输入宽度。
- `IdeShell.tsx` 面板尺寸模式：同样使用明确尺寸约束管理工作台密度，本轮沿用“尺寸受控而非内容撑开”的思路。

#### 4. 未重复造轮子的证明

- 未新增响应式布局库或自研测量逻辑。
- 未改动路由、数据读取或 Provider 设置系统。
- 未扩展移动端专项，符合用户“移动端先不整”的边界。

## 首页桌面比例自适应二次修正

时间：2026-06-01 21:49:49 +08:00

### 用户反馈

- 用户指出“自适应比例没做好”。

### 根因复盘

- 前一轮只验证了无横向溢出和页面无错误，但没有把不同桌面宽度下的输入框宽度递增作为硬性验收。
- 实测 1440×900 与 1808×768 的 `composerWidth` 都约为 808，说明输入框被父容器 `max-w-[min(920px,72vw)]` 加左右 padding 卡住。
- 根因是约束链设计错误：子输入框虽然写了 `clamp(620px,58vw,860px)`，但父容器最大宽度和 padding 先把可用内容区压小，导致大屏无法继续变宽。

### 修正

- `HomeShell.tsx`：主舞台改为 `max-w-[clamp(860px,70vw,1120px)]`，左右 padding 降为 `clamp(16px,2.4vw,40px)`。
- `HomeComposer.tsx`：输入框改为 `max-w-[clamp(720px,62vw,980px)]`。
- `HomeGreeting.tsx`：问候区改为 `max-w-[clamp(720px,58vw,920px)]`，避免标题区与输入框比例断裂。
- `phase1-navigation.test.tsx`：同步更新自适应契约，防止退回旧窄父容器。

### 本地验证记录

- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- Playwright CLI 截图生成成功：
  - `.codex/uiux-home-responsive-1366-v2.png`
  - `.codex/uiux-home-responsive-1440-v2.png`
  - `.codex/uiux-home-responsive-1808-v2.png`
- Playwright DOM 量测：
  - 1366×768：`stageWidth=956`，`composerWidth=847`，`scrollWidth=1366`，`clientWidth=1366`，`badEvents=[]`。
  - 1440×900：`stageWidth=1008`，`composerWidth=893`，`scrollWidth=1440`，`clientWidth=1440`，`badEvents=[]`。
  - 1808×768：`stageWidth=1120`，`composerWidth=980`，`scrollWidth=1808`，`clientWidth=1808`，`badEvents=[]`。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app apps/web/components/home apps/web/tests .codex`：退出码 0。

## 首页 hydration 缓存错配与侧栏底部修正

时间：2026-06-01 22:03:09 +08:00

### 用户反馈

- 浏览器再次报 `Hydration failed`，差异显示服务端仍输出旧 class：`max-w-[min(760px,70vw)]` 与 `max-w-[clamp(620px,58vw,860px)]`。
- 用户要求左侧栏更宽一点，并将“本地工作区”放在最底部。

### 根因

- 源码已是新 class，但服务端返回旧 class，说明 Next dev 的服务端 bundle 或浏览器 HMR chunk 与当前源码不同步。
- 已停止 3000 端口进程，确认删除 `D:\StoryForge\apps\web\.next` 后重新启动 dev server。
- 账号区没有贴底的原因是项目全局 `section` 样式给侧栏 section 注入 `margin-top/margin-bottom: 18px`，覆盖了普通 `mt-auto`。

### 修正

- `HomeShell.tsx`：左栏从 `clamp(276px,18vw,320px)` 继续加宽到 `clamp(300px,20vw,340px)`。
- `HomeSidebar.tsx`：侧栏保持 `h-screen sticky top-0`；账号区改为 `!mt-auto !mb-0`，压过全局 section margin。
- `phase1-navigation.test.tsx`：同步更新左栏宽度契约。
- 清理并重启：停止 3000 端口进程，删除 `apps/web/.next`，通过 `cmd /c pnpm --filter @storyforge/web dev --hostname 127.0.0.1 --port 3000` 重启。

### 本地验证记录

- `Invoke-WebRequest http://127.0.0.1:3000/`：HTTP 200。
- Playwright 控制台验证：`events=[]`，未捕获 `Hydration failed`、`server rendered HTML`、`Cannot read properties of undefined` 或 `<html> cannot be a child`。
- Playwright DOM 验证：`hasErrorPage=false`、`hasAssistant=true`、`scrollWidth=1440`、`clientWidth=1440`。
- Playwright 布局验证：1440×900 下 `asideWidth=300`，账号区 `accountBottomGap=20`，该间距等于侧栏底部 padding，说明本地工作区已贴到底部安全留白内。
- 截图：`.codex/uiux-home-left-wide-bottom-v2.png`。
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app apps/web/components/home apps/web/tests .codex`：退出码 0。

## 首页参考比例重调

时间：2026-06-01 22:10:41 +08:00

### 用户反馈

- 用户提供 Claude 首页参考图，指出当前比例怪、字太少。

### 复盘

- 前几轮误把“自适应”理解为输入框随宽屏变得更宽，导致主输入框最大到 980px，和参考图不一致。
- 参考图的核心比例是：左栏约 288px，主输入框约 676px，主内容集中在剩余区域中线，宽屏也保持克制宽度。
- “字少”主要体现在左栏最近记录条目太少且摘要占空间；参考图是更密集的单行历史列表。

### 修正

- `HomeShell.tsx`：桌面栅格改为 `288px_minmax(0,1fr)`；主内容容器改为 `max-w-[760px]` 并整体上移。
- `HomeComposer.tsx`：输入框改为 `max-w-[676px]`，高度和内边距按参考图收紧。
- `HomeGreeting.tsx`：问候区同步 `max-w-[676px]`，标题收为 `46px`，主区间距更接近参考图。
- `HomeSidebar.tsx`：侧栏恢复 288px 体系，最近记录改为单行密集列表，账号区保留底部定位。
- `home-data.ts`：最近记录扩充到 11 条，增加中英文混合任务标题，提升左栏信息密度。
- `phase1-navigation.test.tsx`：同步更新布局契约。

### 本地验证记录

- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：23 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- Playwright 1440×900：HTTP 200，`events=[]`，`hasErrorPage=false`，`scrollWidth=1440`，`clientWidth=1440`。
- Playwright 比例量测：`asideWidth=288`，`composerWidth=676`，`recentCount=11`，`accountBottomGap=24`。
- 截图：`.codex/uiux-home-claude-ratio-v2.png`。
- `pnpm --filter @storyforge/web test`：139 pass / 0 fail。
- `git diff --check -- apps/web/app apps/web/components/home apps/web/tests .codex`：退出码 0。

## 编码后声明 - 首页主工作台功能嵌入

时间：2026-06-01 22:59:36 +08:00

### 1. 复用了以下既有组件

- BlueprintWorkbench：用于 New project 子页展示 Blueprint 与 BookRun 状态。
- StudioFlow 与 Studio 共享面板：用于 Projects 子页展示作品选择、章节目标、Scene Packet、Judge/Repair 和批准写回。
- `readJson` / `apiFetch`：用于 Artifacts 读取与 Blueprint/Studio Server Action 请求。
- SettingsClient 的 localStorage 模式：拆出 Provider 面板后新增独立创作偏好面板。

### 2. 遵循了以下项目约定

- Next App Router searchParams Promise 在页面边界 await。
- 页面入口保持薄，复杂功能抽入 page-content 或工作台容器。
- 测试沿用 `node:test` 与静态契约断言，并补充 Server Action 行为测试。

### 3. 对比了以下相似实现

- Blueprint 页面：保留标题页面壳，抽 BlueprintWorkspacePanel 供首页复用。
- Studio 页面：保留 page-content 核心，新增 `variant="home"` 和回跳注入。
- Artifacts 页面：由混合 page 拆成 api/types/validators/page-content，避免重复逻辑。

### 4. 未重复造轮子的证明

- 未重写 Studio 批准写回、Judge/Repair、Scene Packet 展示逻辑。
- 未复制 Artifacts 读取逻辑到首页，而是抽出共享 API 和工作台内容。
- Provider/API Key 仍复用原设置边界，Customize 只新增创作偏好。

## 完成审计记录 - 首页主工作台功能嵌入

时间：2026-06-01 23:18:48 +08:00

已完成全量 web 契约测试、TypeScript 检查、Next 生产构建、Playwright 浏览器回归。目标 6 个子项均有当前代码和命令输出证据支撑。Playwright 安装命令曾因下载超时退出，但依赖与 lockfile 已写入；浏览器二进制下载未完成，最终使用本机 Chrome 可执行文件完成回归。

## 调试记录 - 首页 undefined.call 错误
时间：2026-06-01 23:42:29

- 根因证据：.codex/uiux-dev-server.err.log 出现 Cannot find module './336.js'、'./116.js'，并伴随 fallback chunk 404。
- 浏览器证据：React Lazy 模块报 Cannot read properties of undefined (reading 'call')，且旧构建仍显示 app/error.tsx 嵌套 html/body 栈。
- 源码核对：apps/web/app/error.tsx 当前不包含 html/body；apps/web/tests/phase1-navigation.test.tsx 已有对应回归断言。
- 执行策略：安全删除项目内 apps/web/.next 并重启 dev server。

## 编码后声明 - 首页 undefined.call 错误
时间：2026-06-01 23:49:54

### 1. 复用了以下既有组件
- apps/web/next.config.ts: 复用既有 headers 配置，仅按 NODE_ENV 切换静态资源缓存头。
- apps/web/tests/phase1-navigation.test.tsx: 复用现有契约测试文件，新增开发态静态资源 no-store 回归断言。

### 2. 遵循项目约定
- 命名沿用 nextConfig、immutableCacheHeader 风格，新增 devStaticCacheHeader。
- 代码风格沿用 TypeScript const 配置对象与中文测试描述。

### 3. 根因修复
- 原因：开发态 _next/static 被配置为 public, max-age=31536000, immutable，内置浏览器持久缓存旧 app/error.js/page.js，导致清理 .next 后仍执行旧客户端 chunk。
- 修复：开发态改用 no-store, must-revalidate，非开发态保留 immutable。

## 编码后声明 - 首页最近记录真实化
时间：2026-06-02 00:16:50 +08:00

### 1. 复用了以下既有组件
- apps/web/components/home/HomeSidebar.tsx：继续负责左侧最近记录区域渲染，但数据来源改为 `recentItems` props。
- apps/web/components/home/HomeShell.tsx：作为首页主工作台数据分发入口，当前无真实来源时传空数组。
- apps/web/components/home/home-data.ts：保留 `HomeRecentItem` 类型和 `homeRecentEmpty` 空状态文案。

### 2. 遵循了以下项目约定
- 命名约定：沿用 `HomeRecentItem`、`HomeShell`、`HomeSidebar`。
- 代码风格：沿用只读 props、中文契约测试描述和显式空状态处理。
- 文件组织：首页数据契约仍位于 `components/home`，页面入口只解析 query 并传递状态。

### 3. 对比了以下相似实现
- HomeSidebar：导航配置仍可静态声明，但业务历史必须由上游传入。
- HomeShell：继续承接首页子页和共享数据分发，不把业务历史写死在展示层。
- app/page.tsx：保持薄入口，当前没有真实最近记录来源时显式传 `recentItems={[]}`。

### 4. 未重复造轮子的证明
- 未读取 `.codex` 日志、本地文件或测试输出伪装成用户最近记录。
- 未新增自研历史存储；后续真实 Blueprint 或 BookRun 历史接入同一 `recentItems` props。

### 5. 本地验证记录
- `pnpm --filter @storyforge/web test -- home-page`：10 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：TypeScript 检查通过。
- `pnpm --filter @storyforge/web test`：147 pass / 0 fail。
- `Invoke-WebRequest http://localhost:3000/?view=assistant&html-verify=recent`：HTTP 200，包含最近记录空状态，不包含伪记录，不显示页面暂时不可用。
- Playwright 使用本机 Chrome 桌面视口验证：包含“最近记录”和空状态，`fakeHits` 为空。

## 编码后声明 - 首页项目工作台非卡片化与真实功能嵌入
时间：2026-06-02 01:07:08 +08:00

### 1. 复用了以下既有组件

- `apps/web/app/blueprints/BlueprintWorkspacePanel.tsx`：继续承载 New project 的真实 Blueprint 创建、锁定、章节计划和 BookRun 启动链路。
- `apps/web/app/studio/page-content.tsx`：通过 `StudioWorkbench` 在 Projects 子页嵌入真实 Studio 作品读取、章节目标、Scene Packet、Judge/Repair 和批准写回流程。
- `apps/web/app/artifacts/page-content.tsx`：通过 `ArtifactsPageContent variant="home"` 在 Artifacts 子页复用真实制品读取与详情摘要。
- `apps/web/app/settings/CreativePreferencesPanel.tsx`：创作偏好保留在项目内部，但改为扁平表单，不再作为一级导航或卡片式面板。

### 2. 遵循了以下项目约定

- 首页仍由 `HomeShell` 根据 `view` query 切换中央内容，旧页面核心功能合并到主界面子页面。
- 测试继续使用 `node:test` 静态契约断言，并补充禁止演示文案、伪数据说明、未实现边界和卡片式样式回归。
- 移动端没有新增布局改动，符合“移动端先不整”的约束。

### 3. 对比了以下相似实现

- `/blueprints` 页面：复用工作台容器，不重新写一套新建项目操作链。
- `/studio` 页面：复用 page-content 数据读取和步骤流程，仅加入 home variant 与首页回跳能力。
- `/artifacts` 页面：复用 API client 与制品读取，移除静态分类和未实现说明，改为列表列结构。

### 4. 未重复造轮子的证明

- 未新增伪项目数组、伪最近记录或静态产物分类。
- 未把原跳转页复制成新的独立实现；只在首页子页中组合既有工作台。
- 没有新增外部 UI 依赖或自研状态管理。

### 5. 本地验证记录

- `pnpm --filter @storyforge/web test -- home-page settings-page phase8-stage4`：27 pass / 0 fail，确认红灯断言转绿。
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation studio phase8-stage4 settings-page`：48 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：TypeScript 检查通过。
- `pnpm --filter @storyforge/web test`：147 pass / 0 fail。
- 应用内浏览器检查 `/?view=new-project`、`/?view=projects`、`/?view=artifacts`：无“页面暂时不可用”，无“演示版/演示数据/伪装/未联通能力/未实现边界/仍未实现”等泄漏文案。

## 编码后声明 - Projects 本地化可交互项目页重做
时间：2026-06-02 01:24:25 +08:00

### 1. 复用了以下既有组件

- `apps/web/components/home/HomeShell.tsx`：继续作为首页 view 切换入口，但 Projects 分支改为只渲染独立客户端面板。
- `apps/web/components/home/home-view.ts`：继续沿用 `/?view=projects` 的首页子页路由契约。
- `apps/web/components/home/HomeSidebar.tsx`：左侧导航保持既有选中态和最近记录空状态。

### 2. 遵循了以下项目约定

- 新增 `HomeProjectsPanel` 使用 `'use client'`、`useState`、`useEffect` 和 localStorage，模式与设置页客户端表单一致。
- localStorage 仅保存用户点击 New project 后创建的本地项目；默认空状态，不内置参考图项目或假更新时间。
- Projects 页面不再直接渲染 `StudioWorkbench`，避免大卡片式 Studio 堆叠。

### 3. 对比了以下相似实现

- `CreativePreferencesPanel` 与 `ProviderSettingsPanel`：复用浏览器本地状态保存模式，但 Projects 读取放在 `useEffect` 中，避免预渲染访问浏览器对象。
- `HomeComposer` 与 `HomeSidebar`：沿用客户端按钮交互和本地状态管理风格。
- 用户参考图：保留标题、Sort by、New project、搜索框、项目网格的信息层级，并本地化为 StoryForge 文案。

### 4. 未重复造轮子的证明

- 未新增后端假项目 API，也没有写死参考图中的 `VNproject` 或 `Updated 2 months ago`。
- 未复制 Claude 文案，仅复用信息层级并转换为本地项目状态。
- 未破坏 New project 与 Artifacts 其他子页。

### 5. 本地验证记录

- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：28 pass / 0 fail。
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation settings-page`：33 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：TypeScript 检查通过。
- `pnpm --filter @storyforge/web test`：148 pass / 0 fail。
- 应用内浏览器点击验证 Projects：`New project` 创建本地项目，搜索保留匹配项目，排序按钮切换到“名称”，项目点击后显示“继续 Blueprint / 查看 Artifacts”，页面不包含 `Studio 创作工作台`，不显示错误页。
## 编码前检查 - 首页子页面主区域布局

时间：2026-06-02 01:33:00

□ 已查阅上下文摘要文件：`.codex/context-summary-home-workbench-views.md`、`.codex/context-summary-uiux.md`
□ 已分析相似实现：

- `apps/web/components/home/HomeShell.tsx`: 首页主区域布局、view 分支和子页面承载点
- `apps/web/components/home/HomeSidebar.tsx`: 左侧背景、导航和底部工作区状态入口
- `apps/web/tests/home-page.test.tsx`: 首页 UI 源码契约测试模式
- `apps/web/tests/phase1-navigation.test.tsx`: 阶段导航与首页结构契约测试

□ 将使用以下可复用组件：

- `HomeSidebar`: 保留左侧导航与账号状态入口，作为背景色基准
- `HomeProjectsPanel`: 保留 Projects 本地交互，不改业务逻辑
- `BlueprintWorkspacePanel`、`ArtifactsPageContent`: 保留子页核心功能承载

□ 将遵循命名约定：React 组件 PascalCase、测试中文描述沿用现有 node:test 风格
□ 将遵循代码风格：Tailwind class 内联、源码契约测试使用 `assert.ok`
□ 确认不重复造轮子：状态入口已在 `HomeSidebar` 底部存在，右侧顶部重复胶囊应移除

## 编码后声明 - 首页子页面主区域布局

时间：2026-06-02 01:49:00 +08:00

### 1. 复用了以下既有组件

- `HomeSidebar`: 继续承载左侧导航、最近记录空状态和账号/Provider 设置入口。
- `HomeProjectsPanel`: Projects 子页保持本地新建、搜索、排序和选中交互。
- `BlueprintWorkspacePanel`、`CreativePreferencesPanel`、`ArtifactsPageContent`: New project 与 Artifacts 子页核心功能未改动。

### 2. 遵循了以下项目约定

- `HomeShell` 仍按 `activeView` 在中央区域切换子页面，不新增路由或状态管理。
- 右侧 `main` 背景改为与左侧一致的 `bg-[#171715]`。
- 非 assistant 子页容器改为 `max-w-none`，铺满 288px 侧栏之外的可用宽度。
- 右侧顶部 `/settings` 状态胶囊已移除；设置入口收纳在左侧底部账号菜单和全局导航中。

### 3. 对比了以下相似实现

- `HomeSidebar`: 左侧背景色、账号菜单和 Provider 状态入口是本次复用基准。
- `home-page.test.tsx`: 沿用源码契约测试锁定 UI 结构，新增“无顶部胶囊、铺满、背景一致”断言。
- `settings-page.test.ts`: 将旧“顶部 Provider 状态链接设置页”契约调整为“左侧账号菜单弹出设置入口”。

### 4. 未重复造轮子的证明

- 没有新增第二套设置入口，移除了 HomeShell 中与侧栏重复的状态胶囊。
- 没有改写 Projects/New project/Artifacts 的业务组件，只调整承载布局。
- 没有新增 UI 依赖或全局样式规则。

### 5. 预览与本地验证记录

- 应用内浏览器预览尝试受当前会话路由限制，返回“无可用浏览器会话路由”；未使用被策略拒绝的 `data:` 或 DOM 注入预览。
- 已安装 Playwright Chromium：`pnpm exec playwright install chromium`。
- 本地 Playwright 真实页面预览 `http://localhost:3000/?view=projects&layout-verify=1780340000000`：
  - `mainClass`: `!m-0 flex min-h-screen !w-full flex-col overflow-x-hidden bg-[#171715] !p-0`
  - `asideClass`: 包含 `bg-[#171715]`
  - `hasStatusLink=false`
  - `hasMaxNone=true`
  - `mainRect.width=1152`，`maxNoneRect.width=1152`
  - 控制台错误数：0
  - 截图：`.codex/uiux-main-fill-verify.png`
- `pnpm --filter @storyforge/web test -- home-page`：先红灯，确认旧背景不满足新契约。
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation`：29 pass / 0 fail。
- `pnpm --filter @storyforge/web test -- settings-page home-page phase1-navigation`：34 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：TypeScript 检查通过。
- `pnpm --filter @storyforge/web test`：149 pass / 0 fail。

## 编码后声明 - 首页其他子页对齐 Projects 规则

时间：2026-06-02 02:21:00 +08:00

### 1. 修正目标

- 用户要求其他界面与 Projects 界面采用同样规则：不再出现大卡片外框，按参考图式页面内容区域展示。
- 范围：首页 `new-project` 与 `artifacts` 子页。

### 2. 根因与修复

- 根因：全局 `section` 样式对首页子页内所有 `section` 自动加浅色背景、边框、20px 圆角、padding 和阴影。
- 修复：在 `HomeShell` 的非 assistant 子页容器中统一重置 `section`：
  - `[&_section]:!m-0`
  - `[&_section]:!rounded-none`
  - `[&_section]:!border-0`
  - `[&_section]:!bg-transparent`
  - `[&_section]:!p-0`
  - `[&_section]:!shadow-none`
- New project 与 Artifacts 顶层内容宽度统一为 `max-w-[770px]`，标题节奏对齐 Projects。

### 3. 预览与验证

- 改前预览：
  - `.codex/uiux-new-project-before-align.png`
  - `.codex/uiux-artifacts-before-align.png`
- 改后预览：
  - `.codex/uiux-new-project-align-final.png`
  - `.codex/uiux-artifacts-align-final.png`
- Playwright DOM 验证：
  - New project：标题 `New project`，顶层宽度 770，背景透明，边框 0，圆角 0，阴影透明，控制台错误数 0。
  - Artifacts：标题 `Artifacts`，顶层宽度 770，背景透明，边框 0，圆角 0，阴影透明，控制台错误数 0。
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation settings-page`：34 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：TypeScript 检查通过。
- `pnpm --filter @storyforge/web test`：149 pass / 0 fail。

## 编码后声明 - Projects 参考图列表化修正

时间：2026-06-02 02:08:00 +08:00

### 1. 修正目标

- 用户指出 Projects 页面仍出现大圆角卡片外框，应按参考图改为普通页面列表布局。
- 本次根因是全局 `section` CSS 给 Projects 外层自动加了背景、边框、圆角、padding 和阴影。

### 2. 实施结果

- `HomeProjectsPanel` 外层增加 `!m-0 !border-0 !bg-transparent !p-0 !shadow-none`，阻断全局大卡片样式。
- Projects 内容区域控制为 `max-w-[770px]`，贴近参考图比例。
- 标题从 `Projects 项目` 收敛为 `Projects`，字号降到 28px。
- 搜索框改为灰底无蓝色边框，排序按钮文案改为 `Activity` / `Name`。
- 移除列表下方“当前项目工作台 / 继续 Blueprint / 查看 Artifacts”解释区。

### 3. 验证记录

- 改前预览截图：`.codex/uiux-projects-before-ref.png`。
- 改后预览截图：`.codex/uiux-projects-claude-ref-final.png`。
- Playwright DOM 验证：
  - `title=Projects`
  - `sectionBackground=rgba(0, 0, 0, 0)`
  - `sectionBorder=0px`
  - `hasBigCard=false`
  - `hasWorkbenchCopy=false`
  - 控制台错误数：0
- `pnpm --filter @storyforge/web test -- home-page phase1-navigation settings-page`：34 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：TypeScript 检查通过。
- `pnpm --filter @storyforge/web test`：149 pass / 0 fail。
## UIUX 主界面优化

时间：2026-06-02 02:30

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-uiux-main.md`
□ 将使用以下可复用组件：

- `HomeShell`: `apps/web/components/home/HomeShell.tsx` - 继续承载 assistant/projects/artifacts 右侧整块切换。
- `createHomeViewHref`: `apps/web/components/home/home-view.ts` - 快捷入口继续生成首页子页链接。
- `HomeProjectsPanel`: `apps/web/components/home/HomeProjectsPanel.tsx` - 复用 770px 去卡片化页面比例。

□ 将遵循命名约定：React 组件 PascalCase，内部函数 camelCase。
□ 将遵循代码风格：TypeScript + Tailwind 原子类 + `node:test` 源码契约测试。
□ 确认不重复造轮子，证明：检查了 `HomeShell`、`HomeGreeting`、`HomeComposer`、`HomeProjectsPanel`、`HomeSidebar`，本轮只调整已有组件。

### 执行记录

- 保留改前预览：`.codex/uiux-assistant-main.png`。
- `HomeGreeting` 移除渲染期 `new Date()` 问候，改为确定性标题，避免 SSR/客户端时间差导致 hydration mismatch。
- `HomeComposer` 移除深灰大面板和无处理的附加资料 `+` 按钮，改为轻量底线输入区，快捷动作左对齐并继续使用真实 Link。
- 更新 `apps/web/tests/home-page.test.tsx` 契约断言，覆盖确定性问候、无大面板、无无效按钮。
## StoryForge Assistant 工作流计划执行 - Phase 0

时间：2026-06-02 03:41:58 +08:00

### 需求与范围

- 用户目标：按照 `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md` 完成 StoryForge Assistant 工作流计划，并使用用户提供的 OpenAI 兼容服务做本地验证。
- 当前范围：先完成 Phase 0 上下文摘要与基线验证，再按最小闭环推进 Phase 1-3。
- 凭据边界：用户提供的 base URL 与 API key 只允许作为当前进程环境变量传入验证命令，禁止写入源码、`.env`、日志和报告。

### 工具与缺口

- 已按要求先调用 `sequential-thinking` 梳理风险。
- 已使用 `shrimp-task-manager` 完成计划、分析、反思、任务拆分，并进入 Task 1。
- `desktop-commander` 未在当前会话工具中暴露；已通过工具发现确认不可用，临时使用 PowerShell、`rg`、Context7 与 GitHub code search 替代，并记录该偏差。
- 已使用 Context7 查询 Next.js 官方文档，确认 App Router `searchParams`、Server Action redirect 和 `cache: "no-store"` 模式。
- 已使用 GitHub code search 搜索状态映射和确定性意图解析示例；结果相关性不足，未直接复用外部代码。

### 工作区保护

- 当前分支：`master`。
- 当前状态：工作区已有大量修改和未跟踪文件，包括计划文件本身和多个首页相关实现文件。
- worktree 说明：superpowers 执行计划要求隔离 worktree，但当前计划和相关未跟踪实现位于现工作区，直接新建普通 worktree 会丢失上下文；因此先在当前工作区执行只读对账和 `.codex` 留痕，后续代码修改保持小步、可验证、不覆盖既有改动。

### 编码前检查 - StoryForge Assistant 工作流

□ 已查阅上下文摘要文件：`.codex/context-summary-storyforge-assistant-workflow.md`

□ 将使用以下可复用组件：

- `HomeShell`: `apps/web/components/home/HomeShell.tsx` - 首页 Assistant 和子视图承载。
- `HomeComposer`: `apps/web/components/home/HomeComposer.tsx` - 输入框、空输入拦截和 query 跳转。
- `AssistantToolTree`: `apps/web/components/home/AssistantToolTree.tsx` - 工具流程树展示结构。
- `createBlueprintWorkflowAction`: `apps/web/app/blueprints/api.tsx` - Blueprint/BookRun Server Action 链路。
- `BookRun service`: `apps/api/app/domains/book_runs/service.py` - BookRun 暂停、停止、恢复、重试和进度回填。
- `CreativeToolRegistry`: `apps/workflow/storyforge_workflow/tools/registry.py` - Runtime Tools 能力清单。
- `NovelSkillRegistry`: `apps/workflow/storyforge_workflow/skills/definitions.py` - 小说技能链事实源。

□ 将遵循命名约定：React 组件 PascalCase，TypeScript 函数 camelCase，Python 函数 snake_case，测试名称使用中文行为描述。

□ 将遵循代码风格：前端使用 `readonly` 类型、相对路径导入和 `node:test`；后端 router/service/schema 分层；所有新增文档和注释使用简体中文。

□ 确认不重复造轮子，证明：已检查 `HomeShell`、`HomeComposer`、`AssistantToolTree`、`blueprints/api.tsx`、`book_runs/service.py`、Runtime Tools registry、Novel Skills registry 和相关测试，确定应补适配层和端点缺口，不新增大 Agent 框架。

### 基线验证

- `pnpm --filter @storyforge/web test`：通过，149 pass / 0 fail。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。

### 已识别的下一阶段缺口

- `AssistantToolTree` 当前仍消费 `home-data.ts` 的静态 `assistantToolNodes`，存在伪造 completed 节点风险。
- `createBlueprintRequest()` 当前固定三章雾港样例，未消费用户输入中的章节数、字数和题材目标。
- `book_runs/service.py` 已有暂停、停止、checkpoint 重试函数，但 `router.py` 尚未暴露 `/pause`、`/stop`、`/retry` 端点。

## StoryForge Assistant 工作流计划执行 - 最终收口

时间：2026-06-02 04:19:13 +08:00

### 本轮新增与修正

- 补齐 Assistant 对话台骨架：AssistantConversation、AssistantMessageList、AssistantActionBar。
- 补齐 Assistant 工具事件解析：ssistant-tool-events.ts，未知事件返回空结果，不让页面崩溃。
- HomeShell 接入对话台，继续保持首屏不展示静态 completed 工具树。
- AssistantToolTree 继续只从 	oolNodes props 消费真实节点，home-data.ts 不再保存静态成功节点。
- Blueprint/BookRun 链路消费确定性 AssistantIntent，支持章节数、目标字数、分批和预算字段。
- BookRun 后端新增原生控制端点：pause、stop、retry，复用既有 service 约束。
- 新增后端 Assistant 会话薄层：/api/assistant/sessions 创建、最近读取、追加消息；schema 禁止额外字段，避免 API Key 等敏感信息进入普通业务表。
- 更新 E2E 契约测试，使其对齐当前“旧页面进入 IDE/设置入口”的事实源，而不是要求首页继续暴露旧路由。
- 刷新 OpenAPI 契约，纳入 BookRun 控制端点和 Assistant 会话端点。

### 真实 LLM 验证

- 模型列表探测：OpenAI-compatible /models 可用，未记录凭据。
- 1 章真实 LLM smoke：通过；模型 mimo-v2.5；BookRun #37；Markdown Artifact #49；Audit Artifact #50；tokens_used=1548。
- 3 章真实 LLM smoke：mimo-v2.5 与 mimo-v2.5-pro 多次返回空内容，已判定为当前 Provider/模型组合稳定性风险；切换 mimo-v2-pro 后通过，BookRun #41；Markdown Artifact #51；Audit Artifact #52；tokens_used=6264。
- 凭据处理：用户提供的 API Key 仅作为当前 PowerShell 进程环境变量传入命令，未写入源码、日志、报告或 .env。

### 最终验证命令与结果

- pnpm --filter @storyforge/web test：160 pass / 0 fail。
- pnpm --filter @storyforge/web lint：	sc --noEmit 通过。
- pnpm run test:api：332 passed / 6 warnings。
- pnpm run test:workflow：159 passed。
- pnpm e2e：契约 28 pass、API verification 58 pass、Workflow verification 37 pass。
- pnpm openapi：通过，已刷新 packages/shared/src/contracts/storyforge.openapi.json。
- cd apps/api; uv run ruff check app/domains/assistant app/domains/book_runs/router.py app/domains/book_runs/schemas.py app/main.py app/models.py tests/test_assistant_sessions.py tests/test_book_runs.py：通过。
- git diff --check：通过。

### 未夸大声明的边界

- 首页最近记录 API 已有后端薄层，但 pp/page.tsx 当前仍传空数组；前端读取最近 Assistant 会话可作为下一小步接入。
- 长篇分卷、人工通读证据和 10 章真实 LLM 稳定生产尚未声明完成；当前真实 LLM 证据只覆盖 1 章和 3 章。
- 当前工作区仍包含大量用户/历史 UIUX 未提交文件，本轮未回滚这些改动。

## StoryForge Assistant 工作流计划文档补全

时间：2026-06-02 11:28:16 +08:00

### 本轮范围

- 用户要求继续完成文档/计划；经根目录、`.codex` 记录和最新计划文件核对，目标文件确认为 `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。
- 本轮只补全文档和验证留痕，不修改业务代码，不运行会产生业务状态变化的真实 LLM 任务。

### 已执行的上下文检索

- 读取 `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`，确认原计划已有路线图但缺少当前完成度对账和剩余任务优先级。
- 读取 `docs/superpowers/plans/2026-06-02-home-workbench-demo.md`，排除其作为本轮主要续写目标。
- 读取 `.codex/context-summary-storyforge-assistant-workflow.md`、`.codex/operations-log.md` 和 `.codex/verification-report.md`，确认最新实现与验证事实。
- 检查 `apps/web/components/home`、`apps/api/app/domains/assistant`、`apps/api/tests` 和 `apps/api/alembic/versions` 的 Assistant 相关文件，补齐计划文件地图。
- `desktop-commander` 未在当前会话工具中暴露；已通过工具发现确认不可用，继续使用可用的 PowerShell、`rg`、sequential-thinking 和 shrimp-task-manager 替代，并记录该偏差。

### 本轮文档改动

- 在计划开头新增“当前完成度对账”，区分已完成、部分完成、未完成和继续执行前置门禁。
- 同步文件地图，补入 `assistant-book-run-actions.ts`、`assistant-tool-catalog.ts`、`assistant-workflows.ts`、Assistant Alembic 迁移和迁移测试等最新事实。
- 修正“现有事实源”中关于静态工具树的表述，避免和最新实现状态冲突。
- 新增 P0/P1/P2 剩余执行清单，明确真实最近记录、导出审计链路、章节审阅修复、Provider/预算门禁、短篇中篇长篇产品化的文件、步骤、验证命令和验收标准。

### 本轮验证

- 计划文档禁用词扫描：无匹配。
- `rg -n "assistant-book-run-actions|assistant-workflows|assistant-tool-catalog|test_assistant_sessions_migration|P0：接通真实最近记录|P2：短篇、中篇和长篇分卷产品化" docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`：命中预期条目。
- `git diff -- docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`：无输出，因为该计划文件当前仍为未跟踪文件，普通 diff 不展示未跟踪内容。

### 结论

- 计划文档已从路线图补成可交接执行计划。
- 剩余工作不再含混为“继续做 Assistant”，而是落到可验证的 P0/P1/P2 任务。

## 执行计划 P0 - 接通真实最近记录

时间：2026-06-02 12:02:12 +08:00

### 本轮范围

- 执行计划中的 P0“接通真实最近记录”。
- 目标：`apps/web/app/page.tsx` 不再硬编码 `recentItems={[]}`，而是通过统一 API client 读取 `/api/assistant/sessions` 并映射为 `HomeRecentItem`。

### 上下文与外部资料

- 已读取 `apps/web/app/page.tsx`、`HomeSidebar.tsx`、`HomeShell.tsx`、`home-data.ts`、`apps/web/lib/api-client.ts`、`apps/api/app/domains/assistant/{schemas,router,service,models}.py` 和 `apps/api/tests/test_assistant_sessions.py`。
- Context7 查询 Next.js `/vercel/next.js`：确认 App Router Server Component 中 `fetch(..., { cache: 'no-store' })` 可用于每次请求刷新数据，`searchParams` 应作为 Promise 读取。
- 当前工具环境未提供 `desktop-commander`；继续使用可用的 PowerShell、`rg`、Context7、sequential-thinking 和 shrimp-task-manager。

### 红灯

- 修改 `apps/web/tests/home-page.test.tsx`，要求首页调用 `readRecentAssistantSessions`，并禁止继续硬编码空最近记录。
- 运行 `pnpm.cmd --filter @storyforge/web test -- home-page`：失败，原因是 `assistant-session-store.ts` 不存在，红灯符合预期。

### 实现

- 新增 `apps/web/components/home/assistant-session-store.ts`：
  - `readRecentAssistantSessions(limit = 8)` 通过 `readJson('/api/assistant/sessions')` 读取真实最近会话。
  - `mapAssistantSessionToHomeRecentItem()` 将 `task_type`、`book_run_id`、`artifact_id`、`blueprint_id` 映射为侧栏摘要。
  - 运行时校验畸形响应，失败时返回错误状态。
- 修改 `apps/web/app/page.tsx`：
  - 调用 `readRecentAssistantSessions()`。
  - 成功时传入真实 `recentItems`，失败时保留空状态，不伪造历史。
- 新增 `apps/web/tests/assistant-session-store.test.ts`，覆盖映射、统一 API client 请求和异常响应。
- 修改 `apps/web/scripts/phase1-contract-test.mjs`，把 `assistant-session-store.ts` 加入测试转译模块和 import rewrite。

### 验证结果

- `pnpm.cmd --filter @storyforge/web test -- assistant-session-store`：3 pass / 0 fail。
- `pnpm.cmd --filter @storyforge/web test -- home-page`：13 pass / 0 fail。
- `pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- `uv run pytest tests/test_assistant_sessions.py -q`：连续超时。已清理本轮残留 pytest 进程并做根因诊断。
- `uv run pytest tests/test_assistant_sessions.py --collect-only -vv`：2 tests collected，收集通过。
- `uv run python -c "from app.main import app; print('app ok', len(app.routes))"`：通过，app 导入与路由注册正常。
- 直接 TestClient 脚本覆盖 Assistant POST 和 GET：`POST /api/assistant/sessions` 返回 201，`GET /api/assistant/sessions?limit=5` 返回 200。

### 剩余风险

- API pytest 在当前会话中卡住但直接 TestClient 证据通过；该测试运行器问题需要后续单独排查，不作为前端 P0 接线阻断。
- 首页最近记录现在能读取真实 API，但侧栏条目当前仍是纯文本展示；若需要可点击跳转，应继续扩展 `HomeRecentItem` 的 href 契约和 UI。

## 执行计划 P0 - 完成 Assistant 导出审计链路

时间：2026-06-02 12:44:12 +08:00

### 本轮范围

- 执行计划中的 P0“完成 Assistant 导出审计链路”。
- 目标：Assistant 能从导出类意图识别 Markdown、EPUB、审计报告，并在有真实 completed BookRun 时通过 Server Action 依次调用真实 BookRun 导出 API。

### 上下文核对

- 已读取 `assistant-intent.ts`、`AssistantConversation.tsx`、`AssistantActionBar.tsx`、`assistant-tool-node-mapper.ts`、`apps/web/app/book-runs/api.tsx`、`apps/web/tests/{assistant-intent,book-runs,home-page}.test.*`。
- 已读取 `apps/api/app/domains/exports/book_markdown_exporter.py`、`apps/api/app/common/redis_cache.py` 和 `apps/api/tests/test_book_exporter.py`。
- 确认当前后端已有 `/api/book-runs/{id}/exports/markdown`、`/epub`、`/audit-report` 端点，前端已有 BookRun 导出 request helper，但 Assistant 对话层缺少导出 Server Action。

### 红灯

- `assistant-intent.test.ts` 要求导出意图返回 `['markdown', 'epub', 'audit']`：首次失败，实际仅返回 `['audit']`。
- `assistant-artifact-export-actions.test.ts` 要求存在导出 Server Action：首次失败，模块不存在。
- `home-page.test.tsx` 要求 `AssistantActionBar` 接入 `submitAssistantArtifactExport`：首次失败，ActionBar 尚未提供导出表单。

### 实现

- `assistant-intent.ts`：导出类任务的 `requestedArtifacts` 改为 `['markdown', 'epub', 'audit']`。
- 新增 `apps/web/components/home/assistant-artifact-export-actions.ts`：
  - 读取 `book_run_id`。
  - 调用 `readBookRun()` 确认 BookRun 存在且 `status === 'completed'`。
  - 依次调用 `exportMarkdownRequest`、`exportEpubRequest`、`exportAuditReportRequest`。
  - 导出成功后 revalidate 首页并回跳 `artifact_export_status=ok`。
  - 非 completed BookRun 回跳 `artifact_export_status=not_ready`，不伪装导出成功。
- `AssistantActionBar.tsx`：新增“导出交付物”表单，复用 `submitAssistantArtifactExport`。
- `apps/web/scripts/phase1-contract-test.mjs`：纳入新导出 action helper 的测试转译和 import rewrite。
- `apps/web/tests/book-runs.test.tsx`：补充 EPUB endpoint helper 断言。
- `apps/api/tests/test_book_exporter.py`：补充 service 与 API 层 EPUB 导出断言。
- `apps/api/app/common/redis_cache.py`：为 Redis client 增加 `socket_connect_timeout=0.5` 和 `socket_timeout=0.5`，解决 Redis 不可用时导出测试卡死。
- `apps/api/tests/test_redis_cache_strategy.py`：新增 Redis client 短超时断言。

### 验证结果

- `pnpm.cmd --filter @storyforge/web test -- assistant-intent assistant-artifact-export-actions book-runs home-page`：22 pass / 0 fail。
- `pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- `uv run pytest tests/test_redis_cache_strategy.py::test_redis_client_uses_short_timeouts -q`：1 passed。
- `uv run pytest tests/test_book_exporter.py -q`：3 passed。
- 直接 service 脚本导出 Markdown、EPUB、audit_report：通过，输出 `book.md text/markdown`、`book.epub application/epub+zip`、`audit_report.json application/json`。

### 风险与后续

- 导出成功后当前只通过 query 状态回跳首页；若要在 Assistant 消息流中展示 artifact ID、版本和下载摘要，需要继续扩展响应状态读取或会话消息追加。
- 真实 LLM 长篇或 10 章导出仍未声明完成，本轮只完成 completed BookRun 的导出 action 接线和 API 验证。

## 执行计划 P1 - 章节审阅和修复链路入口

时间：2026-06-02 12:53:22 +08:00

### 本轮范围

- 执行计划中的 P1“完成章节审阅和修复链路”的第一段可验证闭环。
- 目标：Assistant 能基于真实 `scene_packet_id` 读取 Studio Judge 评审、Repair Patch 和批准摘要；缺少 `scene_packet_id` 时明确要求用户选择章节，不调用 API。

### 上下文核对

- 已读取 `apps/api/app/domains/judge/router.py`、`repair/router.py`、`studio/router.py`、`judge/schemas.py`、`repair/schemas.py`。
- 已读取 `apps/web/app/studio/api.ts`、`approval-action-core.ts`、`actions.tsx`、`studio.test.tsx`。
- 现有 Studio API 已提供读取 Judge/Repair/Approval 摘要能力；本轮优先复用这些事实源，不新增大编排后端。

### 红灯

- 新增 `apps/web/tests/assistant-chapter-review-actions.test.ts`。
- 首次运行 `pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions`：失败，模块不存在。
- 修改 `home-page.test.tsx` 要求 `AssistantActionBar` 接入 `submitAssistantChapterReview`，首次运行失败，ActionBar 未提供审阅入口。

### 实现

- 新增 `apps/web/components/home/assistant-chapter-review-actions.ts`：
  - 缺少 `scene_packet_id` 时回跳 `chapter_review_status=select_chapter`。
  - 读取 `/api/studio/judge-reviews`。
  - 读取 `/api/studio/repair-patches`。
  - 若存在 Repair Patch，读取 `/api/studio/approval-summary?repair_patch_id=...`；否则读取 `scene_packet_id` 对应批准摘要。
  - 成功后回跳 `chapter_review_status=ready`，并带回 `scene_packet_id` 与首个 `repair_patch_id`。
- `AssistantActionBar.tsx` 新增“审阅章节”表单，接入 `submitAssistantChapterReview`。
- `AssistantConversation.tsx` 从 URL 读取 `scene_packet_id` 并传给 ActionBar。
- `apps/web/scripts/phase1-contract-test.mjs` 纳入新 helper 的测试转译和 import rewrite。

### 验证结果

- `pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions`：2 pass / 0 fail。
- `pnpm.cmd --filter @storyforge/web test -- home-page`：13 pass / 0 fail。
- `pnpm.cmd --filter @storyforge/web lint`：通过。
- `pnpm.cmd --filter @storyforge/web test -- studio assistant-chapter-review-actions home-page`：19 pass / 0 fail。
- `uv run pytest tests/test_studio_book_list_api.py -q`：20 passed。
- `uv run pytest tests/test_judge_repair.py -q`：1 passed。
- `uv run pytest tests/test_multi_round_repair.py -q`：3 passed。

### 风险与后续

- 本轮完成的是基于现有 Studio 事实源的 Assistant 入口和读取链路；尚未自动创建新的 Judge issue 或新的 Repair Patch。
- 批准写回仍复用 Studio 现有表单和 `submitStudioApproval`，尚未把批准按钮直接嵌入 Assistant 消息流。

## 执行计划 P1 - Assistant 内批准写回入口

时间：2026-06-02 13:23:43 +08:00

### 本轮范围

- 继续执行 P1“完成章节审阅和修复链路”中的批准写回入口。
- 目标：当 Assistant URL 中存在真实 `repair_patch_id` 时，流程操作条直接提供写回动作，并复用 Studio 既有批准写回 Server Action。

### 上下文核对

- 已读取 `apps/web/components/home/AssistantActionBar.tsx`、`AssistantConversation.tsx`、`apps/web/app/studio/actions.tsx`、`approval-action-core.ts`、`apps/web/tests/home-page.test.tsx` 和 `apps/web/tests/studio.test.tsx`。
- Context7 查询 Next.js `/vercel/next.js`：确认 App Router Server Action 可由 `<form action={serverAction}>` 提交 `FormData`，并可在 mutation 后执行 `revalidatePath` 与 `redirect`。
- GitHub `search_code` 查询 `approve formData repair_patch_id server action language:TypeScript` 未找到可直接复用的开源样例；本轮以项目内 Studio 写回实现作为事实源。

### 红灯

- 修改 `apps/web/tests/home-page.test.tsx`，要求：
  - `AssistantActionBar` 复用 `approveStudioWritebackAction`。
  - 表单提交真实 `repair_patch_id`。
  - `AssistantConversation` 从 `searchParams.repair_patch_id` 读取正整数并传给操作条。
- 运行 `pnpm.cmd --filter @storyforge/web test -- home-page`：失败，错误为“流程操作按钮应复用 Studio 批准写回 Server Action”，红灯符合预期。

### 实现

- `AssistantConversation.tsx`：
  - 新增 `repairPatchId = readPositiveInt(firstParam(searchParams.repair_patch_id))`。
  - 将 `repairPatchId` 传给 `AssistantActionBar`。
- `AssistantActionBar.tsx`：
  - 导入并复用 `approveStudioWritebackAction`。
  - 新增 `repairPatchId` props。
  - 新增写回表单，包含隐藏字段 `repair_patch_id`、`result_path="/"`、`result_view="projects"`。
  - 缺少 `repair_patch_id` 时按钮禁用并提示“需要选择真实 Repair Patch。”。

### 产品边界说明

- 这里的“批准”不是新增权限审批，而是现有 Studio 写回链路的显式写入门槛。
- `Repair Patch` 属于修复建议；写回会修改章节正文和连续性摘要，因此默认保留用户确认动作，避免 Assistant 自动覆盖作品内容。
- 如需优化用户感知，后续可把按钮文案从“批准写回”调整为“应用修复”，底层仍复用同一安全写回 action。

### 验证结果

- 红灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：失败 1 项，失败点为缺少 `approveStudioWritebackAction`。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- home-page studio`：17 pass / 0 fail。
- 类型检查：`pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- 空白检查：`git diff --check -- apps/web/components/home/AssistantActionBar.tsx apps/web/components/home/AssistantConversation.tsx apps/web/tests/home-page.test.tsx`：通过。

### 风险与后续

- `AssistantActionBar.tsx` 和 `AssistantConversation.tsx` 当前为未跟踪文件，属于前序计划执行产物；本轮未删除或重建这些文件。
- 当前按钮在无 `repair_patch_id` 时禁用但仍展示，沿用现有审阅和 BookRun 控制按钮的禁用模式。
- 若产品上希望弱化“审批”感，建议下一步只改按钮文案为“应用修复”，不改变写回前必须显式点击的安全边界。

## 执行计划 P1 - Provider、预算和写回文案可视化

时间：2026-06-02 13:58:20 +08:00

### 本轮范围

- 继续执行计划中的 P1“Provider、预算和暂停原因可视化”。
- 同步处理用户反馈：将 Assistant 写回按钮从“批准写回”改为“应用修复”，降低审批感，但保留显式写回边界。

### 红灯

- `home-page.test.tsx` 要求 `AssistantActionBar` 展示“应用修复”，且不再出现“批准写回”按钮文案。
- 运行 `pnpm.cmd --filter @storyforge/web test -- home-page`：失败，错误为“Assistant 应在有 Repair Patch 时提供应用修复按钮”，红灯符合预期。
- `assistant-tool-node-mapper.test.ts` 新增 Provider 不可用和预算摘要断言。
- 运行 `pnpm.cmd --filter @storyforge/web test -- assistant-tool-node-mapper`：失败，当前工具树没有 `Provider.resolve` 节点，也没有完整预算摘要，红灯符合预期。

### 实现

- `AssistantActionBar.tsx`：按钮文案改为“应用修复”，继续复用 `approveStudioWritebackAction` 和 `repair_patch_id`。
- `assistant-tool-node-mapper.ts`：
  - 新增 `Provider.resolve` 工具节点。
  - 当 `progress.provider_resolution.ok === false` 时，Provider 节点为 failed，章节生成节点不再显示 running/completed。
  - 章节生成节点的 `toolUseLabel` 展示时间预算、章节预算和成本摘要。
  - `AssistantBookRun` 类型补齐 `time_budget_sec` 与 `chapter_budget`，对齐 API BookRunRead 契约。

### 验证结果

- 红灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：失败 1 项，失败点为缺少“应用修复”。
- 红灯：`pnpm.cmd --filter @storyforge/web test -- assistant-tool-node-mapper`：失败 2 项，失败点为缺少 Provider 节点和不可用状态映射。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- home-page studio`：17 pass / 0 fail。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- assistant-tool-node-mapper settings-page home-page studio`：27 pass / 0 fail。
- 类型检查：`pnpm.cmd --filter @storyforge/web lint`：通过。
- API 预算验证：`uv run pytest tests/test_book_run_budget.py -q`：2 passed。
- API BookRun 验证：`uv run pytest tests/test_book_runs.py -q`：10 passed / 1 warning。

### 风险与后续

- 本轮完成的是工具树映射层的 Provider/预算可视化；Provider 真实预检状态如何写入 `progress.provider_resolution` 仍依赖上游 BookRun/Workflow 运行链路。
- `test_book_runs.py` 仍有既有 HTTP 422 deprecation warning，不影响本轮预算行为。

## 执行计划 P1 - AssistantConversation 接真实 BookRun 工具树消息

时间：2026-06-02 16:00:01 +08:00

### 本轮范围

- 继续执行计划中的 P1 接线项：当首页 URL 携带 `book_run_id` 时，Assistant 对话层读取真实 BookRun，并把 `mapBookRunToAssistantToolNodes()` 生成的工具树节点带入消息流。
- 本轮不新增后端接口、不新增静态工具树、不改变写回安全边界。

### 红灯

- 运行 `pnpm.cmd --filter @storyforge/web test -- home-page`：失败 1 项。
- 失败点为“Assistant 对话层应从 BookRun API helper 模块读取真实运行状态”。
- 根因定位：`phase1-contract-test.mjs` 会对转译后的测试文件执行全局 import rewrite，导致断言字符串 `../../app/book-runs/api` 在临时测试文件中被改写为 `../../app/book-runs/api.mjs`；而源文件 `AssistantConversation.tsx` 实际已经包含正确导入 `from '../../app/book-runs/api'`。

### 实现

- `AssistantConversation.tsx` 当前已复用 `readBookRun(bookRunId)` 与 `mapBookRunToAssistantToolNodes(bookRun)`，并在读取到 BookRun 后追加带 `toolNodes` 的 Assistant 消息。
- `home-page.test.tsx` 将模块路径断言从直接字符串改为 `['..', '..', 'app', 'book-runs', 'api'].join('/')`，保持同一契约语义，同时避免测试脚本把断言文本错误改写为 `.mjs`。

### 验证结果

- 红灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：12 pass / 1 fail，失败点为 BookRun API helper 模块路径断言。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：13 pass / 0 fail。
- 组合验证：`pnpm.cmd --filter @storyforge/web test -- home-page assistant-tool-node-mapper settings-page studio`：27 pass / 0 fail。
- 类型检查：`pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- 空白检查：`git diff --check -- apps/web/tests/home-page.test.tsx apps/web/components/home/AssistantConversation.tsx apps/web/components/home/assistant-tool-node-mapper.ts apps/web/tests/assistant-tool-node-mapper.test.ts .codex/operations-log.md .codex/verification-report.md`：通过。

### 风险与后续

- 本轮确认 BookRun 工具树消息已接入对话层契约，但真实页面渲染仍依赖 `book_run_id` 指向存在的后端记录。
- 后续可继续推进 P2 deterministic/mock 10 章 BookRun 与 3-5 万字短篇导出验证。

## 执行计划 P0 - Assistant 导出审计结果回流消息流

时间：2026-06-02 16:45:44 +08:00

### 本轮范围

- 继续执行计划 P0“完成 Assistant 导出审计链路”。
- 目标是让 completed BookRun 触发 Markdown、EPUB、audit_report 三种真实导出后，把导出结果摘要回流到 Assistant 消息流。
- 本轮不新增后端导出接口，继续复用 `exportMarkdownRequest`、`exportEpubRequest`、`exportAuditReportRequest` 和 `readBookRun`。

### 红灯

- `home-page.test.tsx` 新增断言，要求 `AssistantConversation` 读取 `artifact_export_status`，并通过 `artifactExportMessageFor` 生成包含“Markdown、EPUB 和审计报告”的消息。
- 运行 `pnpm.cmd --filter @storyforge/web test -- home-page`：失败 1 项，错误为“Assistant 应读取导出状态并回写消息流”。
- `assistant-artifact-export-actions.test.ts` 增强 completed BookRun 导出断言，要求 redirect 携带 `artifact_export_summary` 且包含 `book.md`、`book.epub`、`audit_report.json`。
- 运行 `pnpm.cmd --filter @storyforge/web test -- assistant-artifact-export-actions`：失败 1 项，错误为“导出成功后应回传 Markdown 制品摘要”。

### 实现

- `submitAssistantArtifactExport()`：
  - 继续先读取 BookRun，并拒绝无效 ID 或非完成状态。
  - 三个导出请求成功后解析响应中的 `id` 和 `name`。
  - redirect 回首页时携带 `artifact_export_status=ok` 和简短 `artifact_export_summary`。
  - 若响应缺少名称，则从导出 endpoint 推导 `book.md`、`book.epub` 或 `audit_report.json`。
- `AssistantConversation.tsx`：
  - 新增读取 `artifact_export_status` 和 `artifact_export_summary`。
  - 新增 `artifactExportMessageFor()`，为 `ok`、`not_ready`、`invalid` 三类状态生成中文 Assistant 消息。
  - 成功消息明确展示已导出 Markdown、EPUB 和审计报告，并附制品摘要。

### 验证结果

- 红灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：12 pass / 1 fail。
- 红灯：`pnpm.cmd --filter @storyforge/web test -- assistant-artifact-export-actions`：1 pass / 1 fail。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：13 pass / 0 fail。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- assistant-artifact-export-actions`：2 pass / 0 fail。
- 组合验证：`pnpm.cmd --filter @storyforge/web test -- home-page assistant-artifact-export-actions book-runs`：17 pass / 0 fail。
- 类型检查：`pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- API 导出验证：`uv run pytest tests/test_book_exporter.py -q`（工作目录 `apps/api`）：3 passed。
- 空白检查：`git diff --check -- apps/web/components/home/assistant-artifact-export-actions.ts apps/web/tests/assistant-artifact-export-actions.test.ts apps/web/components/home/AssistantConversation.tsx apps/web/tests/home-page.test.tsx .codex/operations-log.md .codex/verification-report.md`：通过。

### 风险与后续

- 本轮完成的是导出结果通过 URL query 回流到消息流；更长的制品详情仍应由 Artifacts 页面或 Assistant 会话后端读取事实源。
- completed BookRun 门禁保留，非完成状态只展示不可导出原因，不会调用导出 API。

## 执行计划 P1 - 章节审阅状态回流消息流

时间：2026-06-02 17:02:48 +08:00

### 本轮范围

- 继续执行计划 P1“完成章节审阅和修复链路”的状态回流子项。
- 目标是让 `submitAssistantChapterReview()` redirect 回首页后的 `chapter_review_status` 进入 Assistant 消息流。
- 本轮只展示状态摘要，不新增 Judge/Repair 后端调用，也不伪造完整 Judge issue 列表。

### 红灯

- `home-page.test.tsx` 新增断言，要求：
  - `AssistantConversation` 读取 `firstParam(searchParams.chapter_review_status)`。
  - 对话层包含 `chapterReviewMessageFor`。
  - 缺少目标时展示“需要选择真实章节或 Scene Packet”。
  - ready 状态提示 `Repair Patch` 可应用。
- 运行 `pnpm.cmd --filter @storyforge/web test -- home-page`：失败 1 项，错误为“Assistant 应读取章节审阅状态并回写消息流”。

### 实现

- `AssistantConversation.tsx`：
  - 新增读取 `chapter_review_status` 和 `chapter_review_error`。
  - 将 `scenePacketId`、`repairPatchId`、章节审阅状态传入 `buildMessages()`。
  - 新增 `chapterReviewMessageFor()`。
  - 支持 `select_chapter`、`ready`、`failed` 三类消息：
    - `select_chapter`：提示需要选择真实章节或 Scene Packet。
    - `ready`：提示 Scene Packet 审阅已准备好，若存在 `repair_patch_id` 则提示 `Repair Patch #id` 可点击“应用修复”。
    - `failed`：展示可读失败原因。

### 验证结果

- 红灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：12 pass / 1 fail。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- home-page`：13 pass / 0 fail。
- 组合验证：`pnpm.cmd --filter @storyforge/web test -- home-page assistant-chapter-review-actions studio assistant-intent`：24 pass / 0 fail。
- 类型检查：`pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- 空白检查：`git diff --check -- apps/web/components/home/AssistantConversation.tsx apps/web/tests/home-page.test.tsx .codex/operations-log.md .codex/verification-report.md`：通过。

### 风险与后续

- 本轮闭合的是章节审阅 redirect 状态到消息流；完整 Judge 问题、严重级别、证据引用和 Patch 摘要仍需后续接入。
- `submitAssistantChapterReview()` 当前失败会抛错，后续可把失败 redirect 为 `chapter_review_status=failed&chapter_review_error=...`，让本轮消息函数承接。

## 执行计划 P1 - 章节审阅 API 失败回流消息流

时间：2026-06-02 17:09:27 +08:00

### 本轮范围

- 继续执行 P1“章节审阅和修复链路”的失败恢复子项。
- 目标是当 `submitAssistantChapterReview()` 调用 Studio Judge、Repair 或 approval-summary API 失败时，不让页面直接抛错，而是 redirect 回 Assistant 消息流展示失败原因。

### 红灯

- `assistant-chapter-review-actions.test.ts` 新增失败路径测试：
  - 模拟 `/api/studio/judge-reviews` 返回 500。
  - 断言 redirect URL 包含 `scene_packet_id=42`、`chapter_review_status=failed` 和 `chapter_review_error`。
- 运行 `pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions`：失败 1 项，当前错误仍直接抛出“章节审阅 API 返回 500：/api/studio/judge-reviews”。

### 实现

- `submitAssistantChapterReview()`：
  - 保留缺少 `scene_packet_id` 时的 `select_chapter` redirect。
  - 将 Studio API 调用链路包入 `try/catch`。
  - 任一读取失败时 redirect 到 `/?scene_packet_id=...&chapter_review_status=failed&chapter_review_error=...`。
  - 成功 ready 路径和 `repair_patch_id` 注入保持不变。

### 验证结果

- 红灯：`pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions`：2 pass / 1 fail。
- 绿灯：`pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions`：3 pass / 0 fail。
- 组合验证：`pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions home-page studio`：20 pass / 0 fail。
- 类型检查：`pnpm.cmd --filter @storyforge/web lint`：通过，`tsc --noEmit` 退出码 0。
- 空白检查：`git diff --check -- apps/web/components/home/assistant-chapter-review-actions.ts apps/web/tests/assistant-chapter-review-actions.test.ts .codex/operations-log.md .codex/verification-report.md`：通过。

### 风险与后续

- 本轮只回流短错误摘要；后续可为 Judge/Repair 细分错误阶段，展示更精确的修复建议。
- 已有 `AssistantConversation` 的 failed 消息可承接该 redirect。

## 项目整体审阅 - 剪枝与深化方向

时间：2026-06-02 17:15:09 +08:00

### 本轮范围

- 用户要求“做整个项目的审阅”，目标是后续可能剪枝或深化某个方面。
- 本轮不修改业务代码，只追加 `.codex/context-summary-project-review.md`、`.codex/operations-log.md` 和 `.codex/verification-report.md`。
- 当前工作树已有大量用户/历史改动和未跟踪文件，本轮只读业务文件，避免回退或覆盖。

### 工具与降级记录

- 已按要求先调用 sequential-thinking，再调用 shrimp-task-manager。
- 已使用 Context7 查询 FastAPI、Next.js、LangGraph 官方文档。
- 已使用 GitHub code search 查询开源参考；FastAPI 精准模板搜索命中有限，Next.js 和 LangGraph 结果只用于校准生态方向。
- 本环境未暴露 `desktop-commander` 工具；已通过 `tool_search` 搜索确认无对应工具，降级使用 PowerShell 与 `rg` 做本地检索。

### 读取证据

- 根配置：`package.json`、`apps/api/pyproject.toml`、`apps/web/package.json`、`apps/workflow/pyproject.toml`。
- 事实源：`README.md`、`current-phase.md`、`TODO.md`、`MODULE_ISOLATION_SCORECARD.md`。
- API 样本：`apps/api/app/main.py`、`apps/api/app/domains/book_runs/*`、`apps/api/app/domains/assistant/*`、`apps/api/app/domains/worldbuilding/*`。
- Web 样本：`apps/web/lib/api-client.ts`、`apps/web/components/home/HomeShell.tsx`、`apps/web/components/home/assistant-workflows.ts`、`apps/web/scripts/phase1-contract-test.mjs`。
- Workflow 样本：`apps/workflow/storyforge_workflow/orchestrators/book_loop.py`、`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`、`apps/workflow/storyforge_workflow/skills/definitions.py`。
- 测试入口：`scripts/verify-ci.mjs`、API/Web/Workflow 测试目录、`tests/e2e`。

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-project-review.md`
□ 将使用以下可复用组件：

- `apps/web/lib/api-client.ts`：作为 Web 访问 API 的统一模式证据。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：作为整书闭环深化主线证据。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：作为单章技能链深化主线证据。
- `packages/shared/src/generated/api-types.ts`：作为 OpenAPI 契约事实源证据。

□ 将遵循命名约定：审阅文档使用中文标题和项目既有 `.codex/*.md` 记录格式。
□ 将遵循代码风格：不改业务代码；文档用简体中文，命令和路径使用原样标识。
□ 确认不重复造轮子，证明：本轮仅基于既有代码、文档、测试和官方资料做审阅，不新增实现。

### 初步结论

- 项目主干不是需要推倒的烂摊子，核心链路较清楚：API 真相源、Web 工作台、Workflow 编排、shared OpenAPI。
- 当前主要问题是范围和认知负荷偏大：API 30+ domain、Web 16 个 page、`docs/superpowers/plans` 18 个已跟踪计划、`.codex` 243 个已跟踪文件和大量未跟踪截图/日志。
- `MODULE_ISOLATION_SCORECARD.md` 中“worldbuilding router 未注册”的旧判断已经过期，说明历史报告需要归档或标记时效。
- `apps/web/scripts/phase1-contract-test.mjs` 手动维护大量 runtimeModules/importRewrites，是明显维护热点。
- 最值得深化的是 Context/ScenePacket/Retrieval 黄金样例、真实 LLM 长篇验收、Assistant 工具执行审计、Worldbuilding 写入和仲裁。

### 后续任务拆分

已通过 shrimp-task-manager 生成 4 个候选任务：

- 归档过期审阅与临时产物。
- 固化 Context ScenePacket Retrieval 黄金样例。
- 收敛 Web 契约测试运行器。
- 选择并深化真实长篇验证主线。

### 本地验证结果

- `git diff --check -- .codex/context-summary-project-review.md .codex/operations-log.md .codex/verification-report.md`：通过。
- `pnpm.cmd --filter @storyforge/shared test`：通过。
- `pnpm.cmd --filter @storyforge/web lint`：通过。
- `uv run pytest tests/test_worldbuilding_center.py tests/test_book_runs.py -q`（工作目录 `apps/api`）：12 passed，1 warning。
- `pnpm.cmd run verify:ci`：失败于第一关根静态检查与格式检查；Prettier 报告 7 个已有 Web 改动文件格式不符合要求：`apps/web/app/page.tsx`、`apps/web/components/home/assistant-tool-node-mapper.ts`、`apps/web/components/home/AssistantActionBar.tsx`、`apps/web/components/home/AssistantConversation.tsx`、`apps/web/tests/assistant-artifact-export-actions.test.ts`、`apps/web/tests/assistant-chapter-review-actions.test.ts`、`apps/web/tests/home-page.test.tsx`。

### 验证失败处理

- 失败文件均为本轮审阅前已存在的业务改动；本轮不擅自格式化或修改。
- 本轮交付结论只能作为项目审阅结论，不能作为发布通过结论。

## 执行计划 P2 - deterministic 10 章与 3-5 万字短篇导出证据

时间：2026-06-02 17:17:08 +08:00

### 本轮范围

- 继续执行 P2“短篇、中篇和长篇分卷产品化”的 deterministic/mock 本地证据子项。
- 目标是保留既有三章 deterministic 冒烟，同时补出 10 章 BookRun 和 3-5 万字短篇导出的本地可重复证据。
- 本轮不声明真实 LLM 10 章完成，不触碰真实模型运行。

### 红灯

- `test_phase9a_deterministic_smoke.py` 新增 10 章短篇测试：
  - 调用 `run_phase9a_deterministic_smoke(session, chapter_count=10, target_word_count=50000, chapter_content_repetitions=90)`。
  - 断言 BookRun completed、`current_chapter_index=10`。
  - 断言 Markdown 包含“第 10 章”，正文词数在 30000-50000。
  - 断言 audit report 有 10 个 chapters 且每章有 `model_run_id`、`judge_report_id`、`approved_scene_id`。
- 运行 `uv run pytest tests/test_phase9a_deterministic_smoke.py -q`：失败 1 项，错误为 `run_phase9a_deterministic_smoke() got an unexpected keyword argument 'chapter_count'`。

### 实现

- `deterministic_smoke.py`：
  - `run_phase9a_deterministic_smoke()` 新增参数 `chapter_count`、`target_word_count`、`chapter_content_repetitions`。
  - 默认值保持三章、4500 目标字数和原正文重复数，保留既有冒烟行为。
  - `_blueprint_payload()` 改为接收章节数和目标字数。
  - 章节循环改为 `1..chapter_count`。
  - `_chapter_content()` 支持传入正文重复次数，用于生成 3-5 万字 deterministic 短篇。
- 新增证据目录 `.codex/deterministic-10ch-short-story/`：
  - `book.md`
  - `audit_report.json`
  - `summary.json`

### 验证结果

- 红灯：`uv run pytest tests/test_phase9a_deterministic_smoke.py -q`：1 passed / 1 failed。
- 绿灯：`uv run pytest tests/test_phase9a_deterministic_smoke.py -q`：2 passed。
- 关联验证：`uv run pytest tests/test_book_exporter.py tests/test_book_runs.py -q`：13 passed / 1 warning。
- 证据落盘：`.codex/deterministic-10ch-short-story/summary.json` 显示：
  - `book_run_status=completed`
  - `current_chapter_index=10`
  - `chapter_count=10`
  - `body_word_count=30600`
  - `markdown_artifact_name=book.md`
  - `audit_artifact_name=audit_report.json`
- 文件检查：`.codex/deterministic-10ch-short-story/book.md` 包含“## 第 10 章 雾港航线 10”。
- 空白检查：`git diff --check -- apps/api/app/domains/book_runs/deterministic_smoke.py apps/api/tests/test_phase9a_deterministic_smoke.py .codex/operations-log.md .codex/verification-report.md`：通过。

### 风险与后续

- `test_book_runs.py` 仍有既有 HTTP 422 deprecation warning，不影响本轮 P2 deterministic 证据。
- 当前只证明 deterministic/mock 10 章和 3-5 万字短篇导出；真实 LLM 10 章或 3-5 万字仍未验收。
- 长篇分卷、Story Memory、Character Bible、Timeline Guard 和伏笔回收状态仍未完成。

## 执行计划 P1 - Provider 预检真实写入 BookRun progress

时间：2026-06-02 17:34:00 +08:00

### 本轮范围

- 继续执行 P1“Provider、预算和暂停原因可视化”中的后端真实写入缺口。
- 目标是让 BookRun 创建时写入 `progress.provider_resolution`，供 Assistant 工具树 `Provider.resolve` 节点读取真实事实源。
- 本轮不改前端 mapper，不触碰 API Key 存储，不声明真实 LLM 长程验收完成。

### 上下文和复用证据

- 已阅读 `apps/api/app/domains/book_runs/service.py`：BookRun 创建、暂停、停止、恢复和进度回填均在 service 层处理。
- 已阅读 `apps/api/app/domains/provider_gateway/service.py`、`schemas.py`、`runtime_config.py`：Provider 解析已有统一入口 `resolve_provider(session, "llm")` 和 `ProviderResolutionRead`。
- 已阅读 `apps/web/components/home/assistant-tool-node-mapper.ts`：前端已消费 `progress.provider_resolution`，当 `ok=false` 时 Provider 节点 failed 且章节节点不伪装运行。
- 已查询 Context7 SQLAlchemy ORM 文档：JSON/dict 原地变更需要 mutable tracking；本项目沿用“重新赋值整个 dict 后 commit”的既有安全模式。
- 已用 GitHub code search 查询 `provider_resolution progress`，未采用外部实现；本轮以项目内 Provider Gateway 为权威事实源。

### 红灯

- 修改 `apps/api/tests/test_book_runs.py::test_create_and_read_book_run`，要求创建 BookRun 后包含 `progress.provider_resolution`。
- 运行 `uv run pytest tests/test_book_runs.py -q`：失败 1 项，错误为 `KeyError: 'provider_resolution'`，确认当前缺少上游真实写入。

### 实现

- `apps/api/app/domains/book_runs/service.py`：
  - 复用 `resolve_provider(session, "llm")`。
  - 新增 `_provider_resolution_progress_summary()`，将 `ProviderResolutionRead` 转成脱敏 progress 摘要。
  - `credential_status` 为 `missing_fallback` 或 `reference_missing` 时写入 `ok=false` 和 `unavailable_reason`。
  - 不写入 API Key 或 `credential_ref`。
- `apps/api/tests/test_book_runs.py`：
  - 默认 deterministic 场景断言 `ok=true`、`credential_status=not_required`。
  - 新增真实 LLM provider 缺少密钥时的 fallback 测试，断言 `ok=false`、`credential_status=missing_fallback`、`configured_provider=openai`。

### 验证结果

- 红灯：`uv run pytest tests/test_book_runs.py -q`：1 failed / 9 passed，失败点为缺少 `provider_resolution`。
- 绿灯：`uv run pytest tests/test_book_runs.py -q`：11 passed / 1 warning。
- 关联 API 验证：`uv run pytest tests/test_book_runs.py tests/test_book_run_budget.py tests/test_provider_gateway.py -q`：19 passed / 1 warning。
- 前端消费验证：`pnpm.cmd --filter @storyforge/web test -- assistant-tool-node-mapper`：5 passed。
- 空白检查：`git diff --check`：通过。

### 回填保留补充

- 追加红灯：`uv run pytest tests/test_book_runs.py::test_apply_book_run_progress_marks_completed -q`，失败点为 workflow 回填后 `provider_resolution` 被覆盖丢失。
- 补充实现：`apply_book_run_progress()` 使用 `_progress_with_existing_provider_resolution()`，payload 没有显式提供 Provider 摘要时保留创建期 `progress.provider_resolution`。
- 绿灯验证：`uv run pytest tests/test_book_runs.py -q`：11 passed / 1 warning。
- 关联验证重跑：`uv run pytest tests/test_book_runs.py tests/test_book_run_budget.py tests/test_provider_gateway.py -q`：19 passed / 1 warning。
- 前端消费验证重跑：`pnpm.cmd --filter @storyforge/web test -- assistant-tool-node-mapper`：5 passed。
- 空白检查重跑：`git diff --check`：通过。
- 防污染红灯：`uv run pytest tests/test_book_runs.py::test_patch_book_run_progress_endpoint -q`，失败点为 payload 显式传入 `workflow-shadow` 的 `provider_resolution` 会覆盖创建期摘要。
- 防污染实现：`_progress_with_existing_provider_resolution()` 改为只要旧 progress 已存在 Provider 摘要，就强制保留旧值，忽略回填 payload 中的伪造或污染字段。
- 防污染验证：`uv run pytest tests/test_book_runs.py tests/test_ide_run_events.py tests/test_ide_sse_latency_budget.py -q`：16 passed / 1 warning。
- 空白检查再次通过：`git diff --check`。

### 风险与后续

- 创建期 `provider_resolution` 已作为 API service 权威事实源；后续若确需刷新 Provider 摘要，应新增受控 service 方法，而不是通过普通 progress PATCH 覆盖。
- 现有 `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning 仍为既有非阻塞警告。
- Provider 真实 LLM 10 章或 3-5 万字验收仍未完成。

## 编码前检查 - Assistant 章节审阅摘要

时间：2026-06-02 17:40:00 +08:00

### 范围

- 仅处理 `apps/web/components/home/assistant-chapter-review-actions.ts`、`apps/web/components/home/AssistantConversation.tsx`、`apps/web/tests/assistant-chapter-review-actions.test.ts`、`apps/web/tests/home-page.test.tsx`。
- 明确不修改 Provider、BookRun Python、导出 action 文件。
- 当前工作树已有大量未提交改动，本轮不回滚、不格式化无关文件。

### 工具与上下文

- 已使用 sequential-thinking 梳理风险。
- 已使用 shrimp-task-manager 建立任务 `e59d9588-5191-438e-8eb0-640bf4087495`。
- desktop-commander 在当前会话不可用，改用 PowerShell `Get-Content` 与 `rg` 做本地只读分析。
- 已查阅上下文摘要文件：`.codex/context-summary-assistant-chapter-review-summary.md`。
- 已查询 Context7 `/vercel/next.js`，确认 Server Action 使用 `redirect` 回流 URL 的官方模式。
- 已使用 GitHub code search 搜索 Server Action redirect 与 `URLSearchParams` 相关开源模式，最终以本仓库既有实现为准。

### 可复用组件

- `assistant-chapter-review-actions.ts`: 复用 Studio API 串联与 `fetchJson`。
- `AssistantConversation.tsx`: 复用 `firstParam`、`readPositiveInt`、消息映射函数结构。
- `assistant-book-run-actions.ts`: 参考局部 `buildResultUrl` 模式，不抽跨文件共享能力。

### 编码前结论

- 将遵循命名约定：TypeScript camelCase 函数与变量、PascalCase 类型。
- 将遵循代码风格：2 空格缩进、中文 UI 文案、局部纯函数。
- 确认不重复造轮子：现有代码只有短状态和导出摘要，没有 Judge issue/Repair Patch 摘要提取能力。
- TDD 顺序：先添加 action redirect 与 Conversation 契约失败用例，再实现短摘要提取和展示。

## 编码后声明 - Assistant 导出失败回流

时间：2026-06-02 18:08:00 +08:00

### 1. 复用了以下既有组件

- `apps/web/app/book-runs/api.ts`: 继续复用 Markdown、EPUB、audit_report 三个导出 request builder。
- `apps/web/lib/api-client.ts`: 继续通过统一 `apiFetch` 提交导出 POST。
- `apps/web/components/home/assistant-book-run-actions.ts`: 复用失败 redirect 回流思路。
- `apps/web/components/home/AssistantConversation.tsx`: 复用 query 状态映射为 Assistant 消息的结构。

### 2. 遵循了以下项目约定

- 命名约定：新增 `buildArtifactExportResultUrl`、`artifactExportError`、`exportReason` 均采用 camelCase。
- 代码风格：本轮触碰的 5 个 Web 文件已用 Prettier 格式化。
- 文件组织：仅修改 Assistant home 组件和对应 Web 测试，不触碰后端、Provider、BookRun Python 文件。

### 3. 对比了以下相似实现

- `assistant-book-run-actions.ts`: 本轮导出 action 与其相同，API 非 ok 或异常都 redirect failed，而不是抛给页面。
- `AssistantConversation.tsx` 章节审阅 failed 分支：本轮导出 failed 分支沿用“状态 + 原因”中文消息结构。
- `AssistantActionBar.tsx` 章节审阅/写回按钮：本轮导出按钮同样使用 `disabled` 和 `title` 暴露不可执行原因。

### 4. 未重复造轮子的证明

- 检查了 `apps/web/components/home/*actions.ts`、`apps/web/tests/*assistant*`、`apps/web/app/book-runs/api.ts`，确认没有现成的导出 failed 回流 helper。
- 未新增共享抽象，避免为了单个导出结果 URL 过早抽象。

### 5. 本地验证记录

- 红测：`pnpm.cmd run test -- apps/web/tests/assistant-artifact-export-actions.test.ts` 失败，原因是旧实现直接抛出 `导出失败：/api/book-runs/12/exports/markdown 返回 500`。
- 回归：`pnpm.cmd --filter @storyforge/web test` 通过，182 passed。
- 空白检查：`git diff --check` 通过。
- lint：`pnpm.cmd run lint` 未全绿；ESLint 已通过，Prettier 剩余警告在非本轮文件 `apps/web/app/page.tsx`、`apps/web/components/home/assistant-tool-node-mapper.ts`、`apps/web/tests/assistant-chapter-review-actions.test.ts`。

### 红灯

- 新增 `submitAssistantChapterReview 将 Judge 和 Repair 摘要压缩进安全短参数`。
- 新增 `home-page.test.tsx` 对 `chapter_review_summary`、`formatChapterReviewSummary`、`证据引用` 的契约断言。
- 运行 `pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions.test.ts home-page.test.tsx`：失败 2 项。
  - action 测试失败于 `summary.includes('动机转折缺少铺垫')`。
  - home-page 契约失败于缺少 `firstParam(searchParams.chapter_review_summary)`。

### 实现

- `assistant-chapter-review-actions.ts`：
  - 新增 `ChapterReviewRedirectSummary` 和 `buildChapterReviewResultUrl`。
  - 从 Studio API 现有返回中提取 Judge issue 摘要、严重级别、证据引用、Repair Patch 摘要。
  - `chapter_review_summary` 使用短 JSON query 参数，URL 超过 700 字符时删除摘要参数。
  - 不读取 `content`、`patch`、`excerpt` 等正文或补丁全文进入 URL。
- `AssistantConversation.tsx`：
  - 新增读取 `chapter_review_summary`。
  - 新增 `formatChapterReviewSummary`，在 ready/failed 消息后追加问题、严重级别、证据引用和 Repair Patch 摘要。

### 绿灯与检查

- `pnpm.cmd --filter @storyforge/web test -- assistant-chapter-review-actions.test.ts home-page.test.tsx`：17 passed。
- `git diff --check -- apps/web/components/home/assistant-chapter-review-actions.ts apps/web/components/home/AssistantConversation.tsx apps/web/tests/assistant-chapter-review-actions.test.ts apps/web/tests/home-page.test.tsx .codex/context-summary-assistant-chapter-review-summary.md .codex/operations-log.md`：通过。

### 编码后声明

#### 1. 复用了以下既有组件

- `fetchJson`: 用于 Studio API 读取，位于 `assistant-chapter-review-actions.ts`。
- `firstParam` / `readPositiveInt`: 用于 URL 参数解析，位于 `AssistantConversation.tsx`。
- `URLSearchParams` redirect 模式：参考 `assistant-book-run-actions.ts` 与章节审阅现有 action。

#### 2. 遵循了以下项目约定

- 命名约定：新增函数使用 camelCase，如 `formatChapterReviewSummary`、`extractJudgeReviewSummary`。
- 代码风格：保持 TypeScript 局部纯函数与中文 UI 文案。
- 文件组织：摘要提取留在章节审阅 action，展示逻辑留在 Conversation，未新增跨域模块。

#### 3. 对比了以下相似实现

- `assistant-chapter-review-actions.ts`: 保留原 API 串联，只扩展 redirect 参数。
- `AssistantConversation.tsx`: 保留消息映射函数，只扩展章节审阅摘要拼接。
- `assistant-book-run-actions.ts`: 借鉴本地 URL 构建函数，不抽象共享以避免扩大范围。

#### 4. 未重复造轮子的证明

- 检查了 `assistant-artifact-export-actions.ts`、`assistant-book-run-actions.ts`、`AssistantConversation.tsx`，不存在可直接复用的 Judge issue/Repair Patch 摘要提取函数。
- 本轮新增能力仅覆盖章节审阅摘要字段提取和展示。
## Phase 9B 真实 LLM smoke 10 章与字数参数 - 编码前检查

时间：2026-06-02 18:05:00

□ 已查阅上下文摘要文件：`.codex/context-summary-phase9b-real-llm-smoke.md`

□ 将使用以下可复用组件：

- `run_phase9b_real_llm_smoke`: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py` - 保持真实 smoke 主编排入口。
- `_blueprint_payload`: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py` - 扩展为接收显式字数参数。
- `_Phase9BChatHandler`: `apps/api/tests/test_phase9b_real_llm_smoke.py` - 复用本地 HTTPServer 模拟 OpenAI 兼容接口。
- `run_phase9a_deterministic_smoke`: `apps/api/app/domains/book_runs/deterministic_smoke.py` - 参考 10 章与目标字数参数化模式。

□ 将遵循命名约定：Python `snake_case` 参数与函数名，测试函数以 `test_` 开头。

□ 将遵循代码风格：简体中文 docstring/注释，pytest plain `assert`，不新增依赖。

□ 确认不重复造轮子，证明：已检查 `phase9b_real_llm_smoke.py`、`test_phase9b_real_llm_smoke.py`、`deterministic_smoke.py`、`test_phase9a_deterministic_smoke.py`、`test_book_exporter.py`，现有能力只需参数化扩展。

### 上下文充分性验证

- 至少 3 个相似实现路径：`apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`、`apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/api/app/domains/book_runs/deterministic_smoke.py`、`apps/api/tests/test_phase9a_deterministic_smoke.py`。
- 实现模式：主编排函数串联领域服务，测试用本地 HTTPServer 模拟真实协议。
- 可复用工具：蓝图服务、BookRun 服务、prompt 组装、导出服务、本地 HTTPServer handler。
- 命名和风格：沿用现有 Python/pytest 风格与中文说明文本。
- 测试策略：先新增 10 章失败测试，再实现生产代码，最后运行用户指定测试集。
- 不重复造轮子：无需新增 mock 库或脚本，直接复用标准库 HTTPServer 与现有测试模式。
- 依赖和集成点：CLI 参数 -> `run_phase9b_real_llm_smoke` -> `_blueprint_payload` -> prompt 组装 -> audit 导出。

## Phase 9B 真实 LLM smoke 10 章与字数参数 - 实现与验证

时间：2026-06-02 18:18:00 +08:00

### 红灯

- 新增 `test_phase9b_real_llm_smoke_runs_ten_chapters_with_word_targets`：
  - 调用 `run_phase9b_real_llm_smoke(..., chapter_count=10, target_word_count=50000, chapter_word_count_min=3000, chapter_word_count_max=5000)`。
  - 断言蓝图目标字数、章节数和章节字数上下限写入。
  - 断言本地 HTTPServer 收到 10 次生成请求和 10 次 Judge 请求。
  - 断言 draft prompt 包含 `3000–5000 字`。
  - 断言 audit 有 10 章，且密钥不进入 audit payload。
- 新增 CLI 测试：`--chapter-count 10` 与字数参数必须透传给 runner。
- 红灯结果：`uv run pytest tests/test_phase9b_real_llm_smoke.py -q` 失败 2 项：
  - `run_phase9b_real_llm_smoke()` 不接受 `target_word_count`。
  - CLI `--chapter-count` 仍限制在 `{1,3}`。

### 实现

- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`：
  - `run_phase9b_real_llm_smoke()` 新增 `target_word_count`、`chapter_word_count_min`、`chapter_word_count_max`。
  - `_assert_preflight()` 放开到 `1..10` 章，并校验字数上下限为正且最小值不大于最大值。
  - `_blueprint_payload()` 改为使用显式目标字数和章节字数范围。
  - CLI 新增 `--target-word-count`、`--chapter-word-count-min`、`--chapter-word-count-max`，并把参数透传给 runner。
- 机械规范化 `phase9b_real_llm_smoke.py`、`test_phase9b_real_llm_smoke.py` 和 `.codex/context-summary-phase9b-real-llm-smoke.md` 为 UTF-8 无 BOM + LF，避免 Windows CRLF 被 `git diff --check` 判为尾随空白。

### 验证结果

- `uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：6 passed。
- `uv run pytest tests/test_phase9b_real_llm_smoke.py tests/test_phase9a_deterministic_smoke.py tests/test_book_exporter.py tests/test_book_runs.py -q`：22 passed / 1 warning。
- Web 组合：`pnpm.cmd --filter @storyforge/web test -- assistant-book-run-actions assistant-session-store assistant-tool-node-mapper assistant-artifact-export-actions assistant-chapter-review-actions home-page`：35 passed。
- 根 lint：`pnpm.cmd run lint`：通过，ESLint 和 Prettier 均通过。
- 空白检查：`git diff --check`：通过。

### 风险与后续

- 本轮只证明真实 LLM smoke 入口已支持 10 章和 3-5 万字目标参数，并通过本地 HTTPServer 模拟协议验证。
- 本轮没有运行真实外部 LLM；真实 LLM 10 章或 3-5 万字短篇仍需在有凭据、预算、产物和人工通读证据后单独声明。
- 10 章真实运行建议继续设置较高 token/time/completion 上限，并确保密钥只通过当前进程环境变量传入。

## Provider Gateway 与真实 smoke Base URL 命名收敛

时间：2026-06-02 18:42:50 +08:00

### 背景

- 用户提供了 OpenAI-compatible 真实接口地址和密钥。
- 安全处理：密钥不写入源码、`.env`、日志、报告或命令文本；真实运行仍需用户在本机进程环境变量中注入。
- 发现契约不一致：`phase9b_real_llm_smoke.py` 使用 `STORYFORGE_LLM_BASE_URL`，而 Provider Gateway 预检只读取 `STORYFORGE_LLM_API_BASE_URL`。

### 红灯

- 新增 `test_provider_gateway_accepts_real_smoke_base_url_alias`。
- 红灯命令：`uv run pytest tests/test_provider_gateway.py::test_provider_gateway_accepts_real_smoke_base_url_alias -q`。
- 红灯结果：失败于 `KeyError: 'api_base_url'`，证明 Provider Gateway 没有识别真实 smoke 使用的 Base URL 变量。

### 实现

- `apps/api/app/domains/provider_gateway/runtime_config.py`：
  - `model_aliases` 脱敏暴露 `api_base_url`，仅保存接口地址，不包含密钥。
  - 新增 `_optional_env_any()`，按优先级读取等价环境变量。
  - LLM 运行配置读取顺序为 `STORYFORGE_LLM_API_BASE_URL` 优先，`STORYFORGE_LLM_BASE_URL` 兜底。
- `apps/api/tests/test_provider_gateway.py`：
  - 覆盖只设置 `STORYFORGE_LLM_BASE_URL` 时仍可在 Provider 预检摘要中读取 `api_base_url`。

### 绿灯与检查

- `uv run pytest tests/test_provider_gateway.py::test_provider_gateway_accepts_real_smoke_base_url_alias -q`：1 passed。
- `uv run pytest tests/test_provider_gateway.py tests/test_book_runs.py tests/test_phase9b_real_llm_smoke.py -q`：25 passed，1 warning。
- `git diff --check -- apps/api/app/domains/provider_gateway/runtime_config.py apps/api/tests/test_provider_gateway.py`：通过。

### 真实 LLM 后续门禁

- 仍缺用户确认的模型名。
- 真实运行不能使用聊天中明文密钥拼接命令；必须由用户在本机 PowerShell 中设置当前进程环境变量后再执行。
- 真实 LLM 10 章或 3-5 万字短篇仍未完成，不得宣称长篇稳定生产。

## P0 最近记录与 TimelineEvent 主线程核验

时间：2026-06-02 18:42:50 +08:00

### 最近记录核验

- `apps/web/app/page.tsx` 已调用 `readRecentAssistantSessions()`，不再硬编码 `recentItems={[]}`。
- `apps/web/components/home/assistant-session-store.ts` 已通过统一 `api-client` 读取 `/api/assistant/sessions` 并映射 `book_run_id`、`artifact_id`、`blueprint_id`。
- 验证：
  - `pnpm.cmd --filter @storyforge/web test -- assistant-session-store home-page`：19 passed。
  - `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。

### TimelineEvent 核验

- worker B 已落盘 `apps/api/app/domains/timeline/`、`apps/api/tests/test_timeline_events.py`、迁移和 router/model 注册。
- 主线程只读核验，不修改 worker 写集。
- 验证：
  - `uv run pytest tests/test_timeline_events.py -q`：3 passed。

### Character Bible 只读调查

- explorer E 返回结论：Character Bible 当前没有版本号、历史表、冲突检测或与 Story Memory 的直接同步写回。
- 后续最小实现建议限制在 `apps/api/app/domains/character_bible/{models,schemas,service,router}.py`、迁移和 `tests/test_character_bible_api.py`，避免与 BookRun、Timeline、伏笔和 memory_extract worker 冲突。

## 长篇产品化并行 worker 集成复核

时间：2026-06-02 19:11:18 +08:00

### BookRun 分卷契约

- worker A 完成 `volume_progress` 受控契约：
  - 新增 `BookRunChapterRange`、`BookRunVolumeProgress`。
  - `BookRunProgressUpdate` 支持顶层 `volume_progress`。
  - 普通 `progress` PATCH 过滤 `volume/current_volume/chapter_range/volume_checkpoint` 等受控字段，避免污染卷级摘要。
- 主线程复核：
  - `uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract -q`：1 passed。
  - `uv run pytest tests/test_book_runs.py tests/test_book_run_resume.py tests/test_book_run_workflow_dispatch.py tests/test_book_run_budget.py tests/test_timeline_events.py tests/test_provider_gateway.py -q`：28 passed，1 warning。
- 残留风险：workflow 侧尚未自动产出 `volume_progress`，本轮只完成 API 回填契约。

### TimelineEvent 持久化/API

- worker B 完成 `POST /api/timeline-events` 与 `GET /api/timeline-events`，支持 project/book/volume/chapter 过滤和 `time_order,id` 稳定排序。
- 主线程复核：
  - `uv run pytest tests/test_timeline_events.py -q`：3 passed。
  - `uv run pytest tests/test_timeline_events.py tests/test_alembic_schema_current_orm.py tests/test_provider_gateway.py tests/test_book_runs.py tests/test_phase9b_real_llm_smoke.py -q`：32 passed，1 warning。
- 残留风险：`project_id`、`volume_id` 当前没有 ORM 真表，只做正整数约束和索引；后续真表落地后需补外键/一致性校验。

### 伏笔生命周期状态机

- worker C 完成 `apply_foreshadow_lifecycle_transition()` 与 `list_foreshadow_lifecycle()`。
- 覆盖 `planted -> reinforced -> paid_off`、非法回退、终态重复转换、`paid_off` 缺证据降级 `abandoned`。
- 主线程复核：
  - `uv run pytest tests/test_foreshadow_lifecycle.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_worldbuilding_center.py tests/test_scene_packet.py -q`：24 passed。
- 残留风险：状态机仍是领域函数，尚未接入 worldbuilding/scene_packet 读侧；并发转换未加锁。

### memory_extract 写入桥

- worker D 完成 `write_memory_extract_atoms()`，将章节摘要、角色状态、世界观事实和伏笔引用映射为既有 `MemoryAtom`。
- 测试覆盖 Provider 凭据不落库。
- 主线程复核：
  - `uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_foreshadow_lifecycle.py tests/test_worldbuilding_center.py tests/test_scene_packet.py -q`：24 passed。
  - `uv run pytest tests/test_novel_loop_single_chapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`（工作目录 `apps/workflow`）：16 passed。
- 残留风险：生产 NovelLoop adapter 尚未接入 API 侧写入桥；当前为白名单映射，后续真实抽取器稳定后需补正式输入契约；逐条写入会多次 commit，大批量抽取需批量事务优化。

### 组合验证

- `uv run pytest tests/test_book_runs.py tests/test_book_run_resume.py tests/test_book_run_workflow_dispatch.py tests/test_book_run_budget.py tests/test_timeline_events.py tests/test_alembic_schema_current_orm.py tests/test_provider_gateway.py tests/test_phase9b_real_llm_smoke.py tests/test_foreshadow_lifecycle.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_worldbuilding_center.py tests/test_scene_packet.py -q`：62 passed，1 warning。
- `uv run pytest tests/test_novel_loop_single_chapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`（工作目录 `apps/workflow`）：16 passed。
- `pnpm.cmd --filter @storyforge/web test -- assistant-session-store home-page assistant-tool-node-mapper assistant-artifact-export-actions assistant-chapter-review-actions assistant-book-run-actions`：35 passed。
- `git diff --check`：通过。

### 仍未完成

- Character Bible 版本与同步契约尚未实现。
- 真实 LLM 10 章或 3-5 万字短篇尚未执行；缺模型名和安全环境变量注入后的真实运行证据。
- 长篇稳定生产仍不能声明完成，仍需跨卷读侧集成、workflow 自动写入、真实产物和人工通读门禁。

## Character Bible 版本与 Story Memory 同步契约

时间：2026-06-02 19:38:22 +08:00

### 上下文与设计

- 已生成上下文摘要：`.codex/context-summary-character-bible-version-sync.md`。
- 已对比 3 类相似实现：
  - `assets`：`VersionMixin + lineage_key`，更新复制新版本。
  - `series`：系列记忆历史与证据保留。
  - `story_memory`：`revision/source_ref` 的长期事实写入。
- Context7 查询 SQLAlchemy 2.0，确认继续使用 `Mapped/mapped_column` 的既有 ORM 风格。
- GitHub code search 未找到同名开源参考，最终以本仓库版本谱系模式为准。

### 红灯

- 修改 `tests/test_character_bible_api.py`，要求：
  - 表包含 `lineage_key/version/sync_status/memory_atom_id`。
  - 创建首版本返回 `version=1` 和同步 MemoryAtom ID。
  - 更新复制新版本，`version=2` 且 `id` 不同。
  - 列表只返回最新版本。
  - `GET /api/character-bible/{id}/history` 返回 `[1, 2]`。
  - Story Memory 写入角色规则事实且不包含 Provider 密钥字段。
- 红灯命令：`uv run pytest tests/test_character_bible_api.py -q`。
- 红灯结果：3 failed，失败点为缺少新字段、响应缺 `lineage_key/version`、列表缺版本。

### 实现

- `apps/api/app/domains/character_bible/models.py`：
  - `CharacterBibleEntry` 接入 `VersionMixin`。
  - 新增 `lineage_key`、`sync_status`、`memory_atom_id`。
- `apps/api/app/domains/character_bible/schemas.py`：
  - `CharacterBibleRead` 暴露版本谱系与同步状态。
- `apps/api/app/domains/character_bible/service.py`：
  - 创建首版本时生成 `lineage_key`。
  - 更新时复制最新版本并插入新行，不覆盖历史。
  - 列表通过 `latest_by_lineage()` 只返回最新版本。
  - 新增 `get_character_bible_history()`。
  - 创建/更新后调用 `create_memory_atom()` 同步角色规则事实。
  - 删除按谱系删除所有版本。
- `apps/api/app/domains/character_bible/router.py`：
  - 新增 `GET /api/character-bible/{entry_id}/history`。
- `apps/api/alembic/versions/20260602_0003_add_character_bible_version_sync.py`：
  - 补真实库迁移字段和索引。
- `apps/api/app/domains/book_runs/prompt_assembly.py`：
  - `continuity_facts` 跳过 `source_ref` 以 `character_bible:` 开头的同步副本，避免 Character Bible 已专门注入后再重复进入连续性事实。

### 验证

- 目标绿灯：`uv run pytest tests/test_character_bible_api.py -q`：6 passed。
- 相邻回归：`uv run pytest tests/test_character_bible_api.py tests/test_character_bible_guard.py tests/test_judge_character_consistency.py tests/test_prompt_assembly.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_worldbuilding_center.py -q`：29 passed。
- 大组合 API：`uv run pytest tests/test_book_runs.py tests/test_book_run_resume.py tests/test_book_run_workflow_dispatch.py tests/test_book_run_budget.py tests/test_timeline_events.py tests/test_alembic_schema_current_orm.py tests/test_provider_gateway.py tests/test_phase9b_real_llm_smoke.py tests/test_foreshadow_lifecycle.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_worldbuilding_center.py tests/test_scene_packet.py tests/test_character_bible_api.py tests/test_character_bible_guard.py tests/test_judge_character_consistency.py tests/test_prompt_assembly.py -q`：78 passed，1 warning。
- Workflow 组合：`uv run pytest tests/test_novel_loop_single_chapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`（工作目录 `apps/workflow`）：16 passed。
- 空白检查：`git diff --check -- apps/api/app/domains/character_bible apps/api/app/domains/book_runs/prompt_assembly.py apps/api/tests/test_character_bible_api.py apps/api/alembic/versions/20260602_0003_add_character_bible_version_sync.py .codex/context-summary-character-bible-version-sync.md`：通过。

### 风险与后续

- 同一 Character Bible 谱系并发更新仍可能生成相同 next version；后续需要唯一约束或乐观锁。
- Story Memory 同步当前写入 JSON 文本规则事实；后续如需强查询，可设计专门索引或结构化表。
- 真实 LLM 10 章/3-5 万字验收仍未执行，缺模型名与安全环境变量注入后的真实运行证据。

## workflow volume_progress 独立回填接线

时间：2026-06-02 20:02:49 +08:00

### 背景

- API 已定义 `BookRunProgressUpdate.volume_progress` 作为受控字段，普通 `progress` PATCH 会过滤卷级字段。
- workflow adapter 此前只向 sink 发送 `progress`，生产链路无法触发 API 侧受控卷级摘要。

### 红灯

- 修改 `apps/workflow/tests/test_book_run_adapter.py` 与 `apps/workflow/tests/test_book_run_dispatch_payload.py`。
- 要求：
  - sink payload 包含同级 `volume_progress`。
  - `CallableProgressSink.emit()` 接受 `volume_progress` 并转发。
  - 普通 `progress` 不含 `volume/chapter_range` 等受控字段。
- 红灯命令：`uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`（工作目录 `apps/workflow`）。
- 红灯结果：4 failed，失败点为缺少 `volume_progress` 和 `CallableProgressSink.emit()` 不接受该参数。

### 实现

- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`：
  - `BookRunProgressSink.emit()` 增加可选 `volume_progress`。
  - `CapturingProgressSink` 与 `CallableProgressSink` 将 `volume_progress` 作为 payload 同级字段转出。
  - `run_book_run_with_skill_runner()` 使用 `_volume_progress_from_result()` 计算卷级摘要。
  - 当前最小契约：`current_volume=1`；`chapter_range` 按本批 `start_chapter_index/chapter_budget/total_chapters` 计算；`completed_chapter_count` 来自 `completed_chapters`；`next_batch_start_chapter_index` 指向下一章。

### 验证

- 目标绿灯：`uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`：7 passed。
- workflow 组合：`uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py tests/test_novel_loop_single_chapter.py tests/test_novel_skill_runner.py -q`：20 passed。
- API 受控字段回归：`uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract tests/test_story_memory_contract.py::test_memory_extract_bridge_writes_auditable_atoms_without_provider_credentials -q`：2 passed。

### 风险与后续

- 当前没有真实 Volume ORM/dispatch 元数据，`current_volume` 暂为 1；后续多卷真表落地后应由 dispatch payload 传入真实卷号和范围。
- 真实生产 HTTP/service adapter 仍需确认会提交同级 `volume_progress`。
- memory_extract 生产端口接线由并行 worker 继续推进。

## TimelineEvent 持久化/API 闭环 - 编码前检查

时间：2026-06-02 18:30:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-timeline-events.md`

□ 将使用以下可复用组件：

- `SessionDependency`: `apps/api/app/db/deps.py` - 路由层数据库会话注入。
- `Base`、`IdMixin`、`TimestampMixin`: `apps/api/app/db/base.py` - ORM 元数据、主键和审计字段。
- `Book`、`Chapter`: `apps/api/app/domains/books/models.py` - 校验作品和章节引用。
- `InputError`: `apps/api/app/common/exceptions.py` - service 层输入错误基类。
- `TestClient` fixture: `apps/api/tests/conftest.py` - 本地 API 测试使用默认 API Key，验证不绕过全局认证。

□ 将遵循命名约定：领域目录 `timeline`；模型 `TimelineEventRecord`；schema `TimelineEventCreate/TimelineEventRead`；服务函数 `create_timeline_event/list_timeline_events`；路由函数 `create_timeline_event_endpoint/list_timeline_events_endpoint`。

□ 将遵循代码风格：Pydantic v2 `Field/ConfigDict`，SQLAlchemy 2.0 `Mapped/mapped_column`，pytest plain `assert`，简体中文 docstring。

□ 确认不重复造轮子，证明：已搜索 `TimelineEvent|timeline_events|time_order|evidence_refs`，现有 `TimelineEvent` 仅在 `story_memory/schemas.py` 作为契约出现，未发现 timeline 持久化表、service 或 router；相邻 create/list API 已参考 assets、prompt_packs、model_runs。

### 上下文充分性验证

- 至少 3 个相似实现路径：`apps/api/app/domains/assets/*`、`apps/api/app/domains/prompt_packs/*`、`apps/api/app/domains/model_runs/*`。
- 实现模式：领域内 model/schema/service/router 分层，service 负责引用校验和事务，router 负责 HTTP 错误转换。
- 可复用工具：`SessionDependency`、`Base/IdMixin/TimestampMixin`、`Book/Chapter`、`InputError`。
- 命名和风格：沿用 Python snake_case、Pydantic `from_attributes`、SQLAlchemy 2.0 映射。
- 测试策略：先写 `apps/api/tests/test_timeline_events.py`，运行定向 pytest 看到缺失 router/表导致红灯，再实现。
- 不重复造轮子：现有 timeline 只有协作时间线读侧和 story_memory schema，不覆盖本任务要求的 TimelineEvent create/list 真持久化。
- 依赖和集成点：新增 timeline 领域目录、`app.models` 模型注册、`app.main` router 注册、Alembic 新迁移。

## TimelineEvent 持久化/API 闭环 - 实现与验证

时间：2026-06-02 18:45:00 +08:00

### 红灯

- 新增 `apps/api/tests/test_timeline_events.py`：
  - `test_create_timeline_event_persists_required_contract` 覆盖 `project_id/book_id/volume_id/chapter_id/time_order/summary/evidence_refs/payload`。
  - `test_list_timeline_events_filters_book_and_orders_by_time` 覆盖按作品过滤和 `time_order, id` 稳定排序。
  - `test_create_timeline_event_rejects_chapter_from_other_book` 覆盖章节跨作品污染拦截。
- 红灯命令：`uv run pytest tests/test_timeline_events.py -q`（工作目录 `apps/api`）。
- 红灯结果：3 failed，三个请求均返回 `404 Not Found`，证明 TimelineEvent API 未注册，符合预期。

### 实现

- 新增 `apps/api/app/domains/timeline/`：
  - `models.py`: `TimelineEventRecord`，表名 `timeline_events`，使用 `IdMixin/TimestampMixin`，JSON 字段保存 `evidence_refs` 与 `payload`。
  - `schemas.py`: `TimelineEventCreate` 与 `TimelineEventRead`，响应使用 `ConfigDict(from_attributes=True)`。
  - `service.py`: `create_timeline_event()` 校验 `Book` 存在与 `Chapter` 归属；`list_timeline_events()` 支持 project/book/volume/chapter 过滤。
  - `router.py`: `POST /api/timeline-events` 与 `GET /api/timeline-events`。
- 追加注册：
  - `apps/api/app/models.py`: 只追加 `TimelineEventRecord` 导入和 `__all__`。
  - `apps/api/app/main.py`: 只追加 `timeline_router` 导入和 `include_router`，沿用全局认证、限流和安全 header。
- 新增迁移：`apps/api/alembic/versions/20260602_0002_add_timeline_events.py`，创建 `timeline_events` 表和 project/book/volume/chapter/time_order 索引。

### 绿灯与检查

- `uv run pytest tests/test_timeline_events.py -q`：3 passed。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; uv run pytest tests/test_timeline_events.py tests/test_alembic_schema_current_orm.py -q`：6 passed。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; uv run ruff check app/domains/timeline tests/test_timeline_events.py app/models.py app/main.py alembic/versions/20260602_0002_add_timeline_events.py`：All checks passed。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; uv run python -c "from app.main import app; assert any(route.path == '/api/timeline-events' for route in app.routes); print('timeline router registered')"`：输出 `timeline router registered`。
- `uv run python -c "import app.models; from app.db.base import Base; assert 'timeline_events' in Base.metadata.tables; print('timeline_events metadata ok')"`：输出 `timeline_events metadata ok`。
- `uv run alembic heads`：输出 `20260514_phase2 (head)` 与 `20260602_0002 (head)`；其中 `20260514_phase2` 为既有历史分支，本轮 migration 接在当前工作区 `20260602_0001` 后，未新增额外分支头。

### 编码后声明

#### 1. 复用了以下既有组件

- `SessionDependency`: 用于 timeline API 数据库会话注入。
- `Base/IdMixin/TimestampMixin`: 用于新增 ORM 表和审计字段。
- `Book/Chapter`: 用于 create 前引用校验和章节归属校验。
- `InputError`: 用于 service 层表达可预期输入错误。

#### 2. 遵循了以下项目约定

- 命名约定：领域目录、函数、测试均使用项目既有 snake_case；模型和 schema 使用 PascalCase。
- 代码风格：保持 `from __future__ import annotations`、SQLAlchemy 2.0 映射、Pydantic v2 schema、中文意图 docstring。
- 文件组织：新增独立 timeline 领域目录，没有扩大 story_memory 或 BookRun 写集。

#### 3. 对比了以下相似实现

- `assets`: 同样在 service 层校验作品/场景归属，router 转 HTTP 错误。
- `prompt_packs`: 同样将领域 CRUD 拆为 model/schema/service/router。
- `model_runs`: 同样使用 JSON payload 和 create/list API 结构。

#### 4. 未重复造轮子的证明

- 已检查 `story_memory/schemas.py`、`story_memory/models.py`、`story_memory/service.py`、`collaboration` timeline 读侧和全仓 `TimelineEvent|timeline_events|time_order|evidence_refs` 搜索结果。
- 现有 `TimelineEvent` 只是 Pydantic 契约，未形成持久化表、service 或 API；协作 timeline 是评论/审批聚合读侧，不满足本任务的 TimelineEvent 真相源写入。
# BookRun 分卷章节范围契约 - 编码前检查

时间：2026-06-02 18:31:55 +08:00

### 范围与工具

- Worker A 目标：推进“长篇分卷模型与章节范围契约”。
- 写集限制：仅修改 `apps/api/app/domains/book_runs/schemas.py`、`apps/api/app/domains/book_runs/service.py`、`apps/api/tests/test_book_runs.py` 或新增 `apps/api/tests/test_book_run_volumes.py`、`.codex/context-summary-bookrun-volume-contract.md`、`.codex/operations-log.md`、`.codex/verification-report.md`。
- 当前会话没有 desktop-commander 工具入口，已按用户允许改用 `rg` 与 PowerShell `Get-Content` 执行本地检索。
- 当前工作树已有大量未提交改动，包含本轮授权文件；本轮不回滚、不清理他人改动，只做增量修改。

### 已查阅上下文摘要

- `.codex/context-summary-bookrun-volume-contract.md`

### 将使用以下可复用组件

- `BookRunProgressUpdate`: `apps/api/app/domains/book_runs/schemas.py` - 扩展 PATCH 输入契约。
- `apply_book_run_progress`: `apps/api/app/domains/book_runs/service.py` - 保持唯一 progress 回填入口。
- `_progress_with_existing_provider_resolution`: `apps/api/app/domains/book_runs/service.py` - 复用受控摘要防污染模式。
- `seed_locked_blueprint`: `apps/api/tests/test_book_runs.py` - 复用 BookRun API 测试基础数据。

### 将遵循项目约定

- 命名约定：Python 函数、变量、JSON 字段使用 snake_case；schema 类使用 PascalCase。
- 代码风格：Pydantic v2 `Field` 约束、pytest plain `assert`、中文 docstring 说明行为意图。
- 文件组织：不新增领域目录或数据库迁移；卷级契约保留在 BookRun progress JSON 与 PATCH schema/service 中。

### 不重复造轮子证明

- 已搜索 `volume/current_volume/chapter_range/volume_checkpoint`，BookRun API、workflow adapter、BookLoop 均未发现完整分卷契约。
- 已确认现有防污染仅覆盖 `provider_resolution`，缺少卷级受控摘要保护。
## 伏笔生命周期状态机 - 编码前检查

时间：2026-06-02 18:31:38 +08:00

### 范围

- 目标：推进 `planted -> reinforced -> paid_off / abandoned` 伏笔生命周期状态机。
- 写集限制：优先限于 `apps/api/app/domains/story_memory/*`、`apps/api/tests/test_foreshadow_lifecycle.py`、`.codex/context-summary-foreshadow-lifecycle.md`、`.codex/operations-log.md`、`.codex/verification-report.md`。
- 明确不触碰：TimelineEvent、BookRun volume、memory_extract、Character Bible worker 写集。
- 当前工作树已有大量他人改动，本轮不回滚、不清理、不格式化无关文件。

### 工具与上下文

- 已使用 sequential-thinking 梳理边界与风险。
- 已使用 shrimp-task-manager 生成任务拆分与验收契约。
- desktop-commander 未在当前会话暴露，已改用 PowerShell `Get-Content` 与 `rg` 做本地只读分析。
- 已查阅上下文摘要文件：`.codex/context-summary-foreshadow-lifecycle.md`。
- 已查询 Context7 `/pydantic/pydantic`，确认 `Literal`、`Field`、`model_validator` 适合状态机契约。
- 已使用 GitHub code search 搜索伏笔状态机和通用转换表实现，未发现可直接复用的伏笔实现，采用项目内最小转换表。

### 已分析的相关实现/测试

- `apps/api/app/domains/story_memory/service.py`: 长效记忆 service、`create_memory_atom`、`list_memory_atoms`。
- `apps/api/app/domains/story_memory/schemas.py`: `MemoryAtom`、`MemoryFactType` 包含 `plot_thread`。
- `apps/api/app/domains/assets/service.py`: 资产版本化写入模式。
- `apps/api/app/domains/worldbuilding/service.py`: `payload["状态"] != "已回收"` 判断未回收伏笔。
- `apps/api/app/domains/scene_packets/budget.py`: 直接输出 `asset_type == "foreshadowing"` 的资产摘要。
- `apps/api/tests/test_story_memory_contract.py`、`apps/api/tests/test_story_memory_persistence.py`、`apps/api/tests/test_worldbuilding_center.py`、`apps/api/tests/test_judge_repair.py`: 测试风格和状态字段断言模式。

### 编码前检查 - 伏笔生命周期状态机

□ 已查阅上下文摘要文件：`.codex/context-summary-foreshadow-lifecycle.md`

□ 将使用以下可复用组件：

- `create_memory_atom`: `apps/api/app/domains/story_memory/service.py` - 写入 `memory_atoms` 真相源。
- `list_memory_atoms`: `apps/api/app/domains/story_memory/service.py` - 读取同一伏笔的生命周期历史。
- `MemoryAtom`: `apps/api/app/domains/story_memory/schemas.py` - 承载 `plot_thread` 事实契约。
- `InputError` / `ConflictError`: `apps/api/app/common/exceptions.py` - 表达非法转换和终态冲突。

□ 将遵循命名约定：Python `snake_case` 函数与字段，Pydantic 类 `PascalCase`，测试函数以 `test_` 开头。

□ 将遵循代码风格：简体中文 docstring，pytest plain `assert`，领域 service 负责引用校验和事务。

□ 确认不重复造轮子，证明：已检查 story_memory、assets、worldbuilding、scene_packets、continuity、judge/repair；现有伏笔只作为 `asset_type="foreshadowing"` 与 payload 中文状态存在，缺少结构化生命周期转换和证据记录。
## memory_extract 写入桥 - Worker D

时间：2026-06-02 18:45:00

### 需求与边界

- 目标：推进 Novel Skill `memory_extract` 写入 Story Memory 的最小桥。
- 写集：优先限制在 `apps/api/app/domains/story_memory/service.py`、`apps/api/tests/test_story_memory_contract.py`、`.codex/context-summary-memory-extract-bridge.md`、`.codex/operations-log.md`、`.codex/verification-report.md`。
- 禁止触碰：TimelineEvent、伏笔状态机、BookRun volume、Character Bible worker 写集。
- 工具说明：当前环境未提供 desktop-commander 工具，已使用 PowerShell + `rg` 作为本地检索替代，并记录替代原因。

### 编码前检查 - memory_extract 写入桥

□ 已查阅上下文摘要文件：`.codex/context-summary-memory-extract-bridge.md`
□ 将使用以下可复用组件：

- `create_memory_atom`: `apps/api/app/domains/story_memory/service.py` - 写入 MemoryAtomRecord 并复用 Book/Chapter 校验。
- `MemoryAtom`: `apps/api/app/domains/story_memory/schemas.py` - 约束实体类型、事实类型、章节有效区间和来源引用。
- `NovelLoopPorts.extract_memory`: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py` - 后续生产 adapter 注入点，本次不让 workflow 直接依赖 API DB。

□ 将遵循命名约定：Python `snake_case` 函数和变量，契约类 `PascalCase`。
□ 将遵循代码风格：中文 docstring、服务函数首参 `Session`、领域错误沿用 `StoryMemoryInputError`。
□ 确认不重复造轮子，证明：已检查 Novel Skill Registry、workflow tools registry、Story Memory service、BookLoop/BookRun adapter 和现有 Story Memory 测试；现有写入能力集中在 `create_memory_atom`，缺少章节抽取 payload 到 MemoryAtom 的写入桥。

### 研究证据

- `apps/workflow/storyforge_workflow/skills/definitions.py`：`MEMORY_EXTRACT_SKILL` 已注册，当前描述为未注入 adapter 时默认返回空列表。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：`_skip_memory_extraction` 返回 `[]`，`NovelLoopPorts.extract_memory` 是注入边界。
- `apps/workflow/storyforge_workflow/skills/runner.py`：`run_memory_extract` 根据返回列表记录 `memory_updated` 或 `memory_extract_skipped`，不保存正文或提示词。
- `apps/api/app/domains/story_memory/service.py`：`create_memory_atom` 已提供持久化和 Book/Chapter 归属校验。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：章节后处理通过 `completed_chapters` 和 `checkpoint` 回填，不在本任务中改 BookRun volume。

### TDD 与实现记录

- RED：`uv run pytest tests/test_story_memory_contract.py::test_memory_extract_bridge_writes_auditable_atoms_without_provider_credentials`，工作目录 `apps/api`。
- RED 结果：失败点为 `AttributeError: module 'app.domains.story_memory.service' has no attribute 'write_memory_extract_atoms'`，证明 memory_extract 缺少生产写入桥。
- GREEN：新增 `write_memory_extract_atoms`，复用 `create_memory_atom` 写入章节摘要、角色状态、世界观事实和伏笔引用。
- 安全约束：写入桥只读取白名单字段；测试断言 `provider_api_key` 与 `authorization` 不进入 `value` 或 `source_ref`。
- 格式修复：`test_story_memory_contract.py` 做 LF 行尾归一化；`service.py` 使用 `uv run ruff format` 做机械格式化。

### 本地验证

- `uv run pytest tests/test_story_memory_contract.py::test_memory_extract_bridge_writes_auditable_atoms_without_provider_credentials`：1 passed。
- `uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py`：11 passed。
- `uv run pytest tests/test_novel_skill_registry.py tests/test_novel_skill_runner.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_book_run_adapter.py`：27 passed。
- `uv run ruff check app/domains/story_memory/service.py tests/test_story_memory_contract.py`：All checks passed。
- `git diff --check -- apps/api/app/domains/story_memory/service.py apps/api/tests/test_story_memory_contract.py .codex/context-summary-memory-extract-bridge.md .codex/operations-log.md`：通过。

### 编码后声明 - memory_extract 写入桥

#### 1. 复用了以下既有组件

- `create_memory_atom`: 用于实际写入 MemoryAtomRecord，位于 `apps/api/app/domains/story_memory/service.py`。
- `MemoryAtom`: 用于实体类型、事实类型、章节有效区间和来源引用契约，位于 `apps/api/app/domains/story_memory/schemas.py`。
- `NovelLoopPorts.extract_memory`: 保持 workflow 端口注入边界，位于 `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`。

#### 2. 遵循了以下项目约定

- 命名约定：新增函数与 helper 使用 `snake_case`。
- 代码风格：新增 docstring 使用简体中文，服务函数首参保持 `Session`。
- 文件组织：只在 Story Memory service 新增窄入口，不新增表、路由、状态机或 workflow 直接 DB 依赖。

#### 3. 对比了以下相似实现

- `apply_arbitration_decision`：同样先构造 `MemoryAtom` 再复用 `create_memory_atom`；本次差异是输入来自章节抽取 payload，而不是 AgentProposal 仲裁。
- `NovelSkillRunner.run_memory_extract`：继续以 `memory_atom_ids` 为审计输出；本次提供可生成这些 id 的 API 侧入口。
- `BookLoop` 章节后处理：保持 `completed_chapters`/`checkpoint` 不变，本次不触碰 BookRun volume。

#### 4. 未重复造轮子的证明

- 已检查 Story Memory 现有 service 与 tests，确认已有持久化入口但缺少 memory_extract payload 映射入口。
- 已检查 workflow registry、runner、BookLoop adapter，确认写入应留在 API service，workflow 只通过端口注入。

### 残留风险

- 上游 memory_extract 抽取 payload 还不是正式 Pydantic schema，当前桥只提供最小白名单映射。
- 生产 NovelLoop adapter 尚未接入该服务函数，本轮只完成 Story Memory 写入桥入口。
- 当前逐条调用 `create_memory_atom` 会多次 commit；单章条目少时可接受，后续可优化为批量事务。
## 伏笔生命周期状态机 - 实现与验证

时间：2026-06-02 18:48:11 +08:00

### TDD 红灯

- 新增 `apps/api/tests/test_foreshadow_lifecycle.py`，覆盖：
  - `planted -> reinforced -> paid_off` 正常转换。
  - `reinforced -> planted` 非法回退。
  - `paid_off` 终态重复回收。
  - `paid_off` 缺少 `evidence_refs` 时降级为 `abandoned`。
- 红灯命令：`uv run pytest tests/test_foreshadow_lifecycle.py -q`，工作目录 `apps/api`。
- 红灯结果：1 error，失败原因为 `ForeshadowLifecycleTransition` 尚未从 `app.domains.story_memory.schemas` 导出，符合预期。

### 实现

- `apps/api/app/domains/story_memory/schemas.py`：
  - 新增 `ForeshadowLifecycleState`、`ForeshadowLifecycleTransition`、`ForeshadowLifecycleSnapshot`。
  - 契约字段覆盖 `chapter_id`、`volume_id`、`evidence_refs`、`transition_reason`、`requested_state`、`degraded`。
- `apps/api/app/domains/story_memory/service.py`：
  - 新增 `apply_foreshadow_lifecycle_transition()` 与 `list_foreshadow_lifecycle()`。
  - 使用 `entity_type="subplot"`、`fact_type="plot_thread"` 复用 `memory_atoms` 存储状态快照。
  - 显式转换表：未开始 -> `planted`；`planted` -> `reinforced`/`abandoned`；`reinforced` -> `reinforced`/`paid_off`/`abandoned`；`paid_off` 与 `abandoned` 为终态。
  - `paid_off` 缺少证据时降级为 `abandoned`，并在 `transition_reason` 保留“缺少证据”说明。

### 编码中监控

□ 是否使用了摘要中列出的可复用组件？
✅ 是：复用 `create_memory_atom`、`list_memory_atoms`、`MemoryAtom`、`InputError`、`ConflictError`。

□ 命名是否符合项目约定？
✅ 是：Python 函数和字段使用 snake_case，契约类使用 PascalCase，测试函数以 `test_` 开头。

□ 代码风格是否一致？
✅ 是：中文 docstring，pytest plain `assert`，领域 service 负责引用校验和事务。

### 绿灯与回归

- `uv run pytest tests/test_foreshadow_lifecycle.py -q`：4 passed。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; uv run pytest tests/test_foreshadow_lifecycle.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py tests/test_worldbuilding_center.py tests/test_scene_packet.py -q`：24 passed。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; uv run ruff check app/domains/story_memory tests/test_foreshadow_lifecycle.py`：All checks passed。
- `git diff --check -- .codex/context-summary-foreshadow-lifecycle.md .codex/operations-log.md apps/api/app/domains/story_memory/schemas.py apps/api/app/domains/story_memory/service.py apps/api/tests/test_foreshadow_lifecycle.py`：通过，无输出。

### 编码后声明 - 伏笔生命周期状态机

#### 1. 复用了以下既有组件

- `create_memory_atom`: 写入 `memory_atoms` 真相源。
- `list_memory_atoms`: 读取同一伏笔状态历史。
- `MemoryAtom`: 作为 `plot_thread` 事实载体。
- `InputError` / `ConflictError`: 区分非法转换与终态冲突。

#### 2. 遵循了以下项目约定

- 命名约定：新增 schema/service/test 均沿用 Python snake_case 与 Pydantic PascalCase。
- 代码风格：保持 `from __future__ import annotations`、中文意图 docstring、pytest plain `assert`。
- 文件组织：未新增平台、路由或迁移，仅在 story_memory 域补最小服务契约和测试。

#### 3. 对比了以下相似实现

- `story_memory/service.py`: 继续由领域 service 做引用校验与事务写入。
- `assets/service.py`: 借鉴版本历史不可覆盖思想，但没有改资产表。
- `worldbuilding/service.py`: 确认现有伏笔只按 asset payload 中文状态过滤，本轮不改变该读侧行为。

#### 4. 未重复造轮子的证明

- 已检查 story_memory、assets、worldbuilding、scene_packets、continuity、judge/repair；没有现成的结构化伏笔生命周期服务。
- 没有新增外部状态机库；显式转换表足够覆盖当前四种状态。

## 并行代理与 volume_progress 验证续跑

时间：2026-06-02 20:08:23 +08:00

### 代理调度

- 已收到真实 LLM 前置核验 explorer 结果，并释放代理 `019e8833-7c54-7583-85f8-2477469102a5`。
- 核验结论：真实 LLM CLI 本身没有默认生成模型，仍需 `STORYFORGE_LLM_MODEL`；推荐按 1 章、3 章、10 章递进验收，不把密钥写入命令、源码、日志或报告。
- 为保持阶段并行槽位占满，已新开 explorer `019e883b-f14b-7943-a641-6532e742f337`，调查真实多卷元数据如何接入 workflow `volume_progress`，只读不改文件。

### 本地验证

- `uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py tests/test_novel_loop_single_chapter.py tests/test_novel_skill_runner.py -q`，工作目录 `apps/workflow`：20 passed。
- `uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract tests/test_story_memory_contract.py::test_memory_extract_bridge_writes_auditable_atoms_without_provider_credentials -q`，工作目录 `apps/api`：2 passed。
- `git diff --check`，工作目录 `D:\StoryForge`：通过，无输出。

### 当前判断

- workflow `volume_progress` 接线切片可判定通过，但 `current_volume=1` 仍是临时值，不能作为真实长篇分卷完成证据。
- 真实 LLM 验收仍等待模型名与本机环境变量安全注入；已知密钥不得落盘或复述。

## 本阶段并行代理收尾

时间：2026-06-02 20:40:00 +08:00

### 代理释放

- 已释放伏笔读侧 worker `019e883d-61bc-7af1-b884-f677f015942f`，主线程接手其完整验证和报告补齐。
- 已释放 OpenAPI 契约 worker `019e883f-d679-7df1-ac69-fbceba06c444`，其同步共享契约和定向测试已完成。
- 已释放多卷 `volume_plan` worker `019e8840-6bd4-7f41-8d84-8d492df5da0b`，其代码与指定测试通过，主线程补齐 `.codex` 留痕。
- 已释放所有只读 explorer：跨卷 Story Memory、人工通读门禁、TimelineEvent 联动。当前无挂起代理。

### 已完成验证

- 伏笔读侧完整回归：`uv run pytest tests/test_foreshadow_lifecycle.py tests/test_scene_packet.py tests/test_context_compiler_memory_injection.py tests/test_scene_packet_context_compiler.py tests/test_worldbuilding_center.py -q`，工作目录 `apps/api`：17 passed。
- OpenAPI 契约定向回归：`uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract -q`，工作目录 `apps/api`：1 passed。
- 多卷 dispatch API 回归：`uv run pytest tests/test_book_run_workflow_dispatch.py -q`，工作目录 `apps/api`：6 passed。
- 多卷 workflow 回归：`uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`，工作目录 `apps/workflow`：9 passed。
- memory_extract 生产端口回归：`uv run pytest tests/test_novel_loop_single_chapter.py tests/test_novel_loop_skill_runner_integration.py -q`，工作目录 `apps/workflow`：9 passed。

### 残留风险

- 真实 LLM 仍缺模型名，不能执行 10 章或 3-5 万字验收。
- 多卷计划来自 Blueprint metadata，不是强约束卷计划表。
- 人工通读门禁、TimelineEvent 自动接线和跨卷 Story Memory guard 仍是下一阶段实现项。
## 编码前检查 - 伏笔生命周期读侧消费

时间：2026-06-02 20:30:00

□ 已查阅上下文摘要文件：`.codex/context-summary-foreshadow-read-side.md`
□ 将使用以下可复用组件：

- `list_foreshadow_lifecycle`: `apps/api/app/domains/story_memory/service.py` - 读取伏笔最新 lifecycle 状态
- `build_packet`: `apps/api/app/domains/scene_packets/budget.py` - 复用固定槽位构造
- `attach_compiled_context`: `apps/api/app/domains/scene_packets/retrieval_bridge.py` - 复用 compiled context 注入
- `apply_foreshadow_lifecycle_transition`: `apps/api/app/domains/story_memory/service.py` - 测试中制造 lifecycle 历史
  □ 将遵循命名约定：Python `snake_case`，pytest `test_` 前缀
  □ 将遵循代码风格：类型标注、简体中文 docstring、上游小函数隔离读侧过滤
  □ 确认不重复造轮子，证明：已检查 `context_pipeline.py`、`budget.py`、`retrieval_bridge.py`、`story_memory/service.py`，无现成 scene packet lifecycle 过滤逻辑

### 工具记录

- sequential-thinking 已用于需求与风险梳理。
- shrimp-task-manager 已完成分析、反思和任务拆分。
- Context7 查询 SQLAlchemy ORM，确认 `Session.scalars(select(...)).all()` 是标准读取模式。
- GitHub code search 查询 foreshadow lifecycle 相关开源实现，未发现可直接复用到本仓库边界的成熟方案，仅作为终态过滤思路参考。
- desktop-commander 在当前会话不可用，已用 PowerShell 与 `rg` 替代本地文件检索。

## 编码前检查 - OpenAPI volume_progress 契约同步

时间：2026-06-02 20:22:32 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-openapi-volume-progress.md`
□ 将使用以下可复用组件：

- `app.openapi()`: `apps/api/app/main.py` - 作为 OpenAPI schema 事实源
- `BookRunProgressUpdate`: `apps/api/app/domains/book_runs/schemas.py` - 请求模型已包含 `volume_progress`
- `BookRunVolumeProgress`: `apps/api/app/domains/book_runs/schemas.py` - 卷级进度 schema
- `pnpm openapi`: `package.json` / `scripts/generate-openapi.mjs` - 共享契约生成入口
  □ 将遵循命名约定：Python 测试函数使用 `test_` 前缀和 snake_case，schema 名称保持 PascalCase
  □ 将遵循代码风格：中文 docstring、pytest plain `assert`、OpenAPI JSON 由既有脚本生成
  □ 确认不重复造轮子，证明：已检查 `test_model_runs.py`、`test_runtime_tools.py`、`test_book_runs.py` 与 `scripts/generate-openapi.mjs`，采用既有 app.openapi 契约测试和生成脚本

### 工具记录

- sequential-thinking 已用于需求、风险和执行顺序梳理。
- shrimp-task-manager 已完成分析、反思和任务拆分。
- Context7 查询 FastAPI，确认 Pydantic 模型会进入 OpenAPI `components.schemas`。
- GitHub code search 查询 FastAPI OpenAPI schema 测试/生成模式，仅作外部参考。
- desktop-commander 在当前工具列表不可用，已用 PowerShell 与 `rg` 替代本地检索并记录。

### 编码后声明 - OpenAPI volume_progress 契约同步

时间：2026-06-02 20:26:10 +08:00

#### 1. 复用了以下既有组件

- `app.openapi()`: 用于验证 live OpenAPI schema，位于 `apps/api/app/main.py`。
- `pnpm openapi`: 用于刷新共享契约，位于 `package.json` 与 `scripts/generate-openapi.mjs`。
- `BookRunVolumeProgress`: 用于卷级进度契约，位于 `apps/api/app/domains/book_runs/schemas.py`。

#### 2. 遵循了以下项目约定

- 命名约定：新增断言沿用 pytest 函数内局部 snake_case。
- 代码风格：复用同一 BookRun 行为测试，不新增夹具或业务抽象。
- 文件组织：只修改允许写集，OpenAPI 快照由既有脚本生成。

#### 3. 对比了以下相似实现

- `apps/api/tests/test_model_runs.py`: 复用 `components.schemas` 断言模式。
- `apps/api/tests/test_runtime_tools.py`: 复用 OpenAPI 契约测试边界。
- `scripts/generate-openapi.mjs`: 复用共享契约生成入口。

#### 4. 未重复造轮子的证明

- 已检查 BookRun schema、router、service、测试与 OpenAPI 生成脚本；缺口是共享快照与测试护栏，不需要新增业务实现。

### 本地验证

- `uv run pytest tests/test_book_runs.py::test_patch_book_run_volume_progress_is_controlled_by_volume_contract -q`，工作目录 `apps/api`：1 passed。
- `pnpm openapi`：首次因默认 uv cache 目录权限失败，未生成契约。
- `$env:UV_CACHE_DIR='D:/StoryForge/.cache/uv'; pnpm openapi`：通过，已生成 `packages/shared/src/contracts/storyforge.openapi.json`。
- PowerShell JSON 断言：`BookRunProgressUpdate.properties.volume_progress.anyOf` 包含 `#/components/schemas/BookRunVolumeProgress`，通过。
- `git diff --check -- apps/api/tests/test_book_runs.py packages/shared/src/contracts/storyforge.openapi.json .codex/context-summary-openapi-volume-progress.md .codex/operations-log.md .codex/verification-report.md`：通过，无输出。

## 编码前检查 - manual_read_gate 人工通读门禁

时间：2026-06-02 21:07:43 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-manual-read-gate.md`
□ 将使用以下可复用组件：

- `BookRunProgressUpdate.progress`: `apps/api/app/domains/book_runs/schemas.py` - 保留宽松 dict 回填入口。
- `apply_book_run_progress`: `apps/api/app/domains/book_runs/service.py` - 持久化 BookRun `status` 与 `progress`。
- `_progress_with_controlled_summaries`: `apps/api/app/domains/book_runs/service.py` - 保留非受控 progress key。
- `export_book_run_audit_report`: `apps/api/app/domains/exports/book_markdown_exporter.py` - 投影 completed BookRun 审计报告。
  □ 将遵循命名约定：字段使用 `manual_read_gate`，pytest 函数使用 `test_` 与 snake_case。
  □ 将遵循代码风格：中文 docstring、plain assert、小函数投影，不新增 ORM 表。
  □ 确认不重复造轮子，证明：已检查 BookRun progress、blocked_chapter、volume_progress、audit_report 与 skill_chain 投影模式。

### 工具记录

- sequential-thinking 已用于需求和风险梳理。
- shrimp-task-manager 已完成分析、反思和任务拆分。
- Context7 查询 Pydantic v2，确认 `dict[str, Any]` 字段可承载任意嵌套 key，顶层 extra 控制不影响字段内部结构。
- GitHub code search 查询 `manual_read_gate` / `awaiting_review` / `audit_report` 开源示例，未发现可直接复用实现。
- desktop-commander 在当前工具列表不可用，已用 PowerShell 与 `rg` 替代本地文件检索并记录。

### RED 验证

- `uv run pytest tests/test_book_runs.py tests/test_book_exporter.py -q`，工作目录 `apps/api`：15 passed，1 failed。
- 失败点：`test_book_run_markdown_and_audit_report_exports_artifacts` 对 `report["manual_read_gate"]` 断言触发 `KeyError`，证明 audit_report 尚未投影该字段。
- 同轮新增的 progress 保存测试已通过，证明现有 `service.py` 宽松 dict 合并已经支持 `manual_read_gate` 事实源保存。

## 编码后声明 - manual_read_gate 人工通读门禁

时间：2026-06-02 21:07:43 +08:00

### 1. 复用了以下既有组件

- `BookRunProgressUpdate.progress`: 用于接收 `manual_read_gate`，位于 `apps/api/app/domains/book_runs/schemas.py`。
- `_progress_with_controlled_summaries`: 用于保留非受控 progress 字段，位于 `apps/api/app/domains/book_runs/service.py`。
- `export_book_run_audit_report`: 用于投影 `manual_read_gate` 到 `audit_report.json`，位于 `apps/api/app/domains/exports/book_markdown_exporter.py`。

### 2. 遵循了以下项目约定

- 命名约定：新增字段和测试名称使用 snake_case。
- 代码风格：新增测试使用中文 docstring 与 plain assert；新增生产逻辑是一个小型投影函数。
- 文件组织：未新增 ORM 表，未触碰 workflow、scene_packets、story_memory、timeline、OpenAPI、web 等禁止写集。

### 3. 对比了以下相似实现

- `test_apply_book_run_progress_keeps_awaiting_review_chapter`: 复用 `awaiting_review` 表达阻断章节的事实源模式。
- `test_patch_book_run_volume_progress_is_controlled_by_volume_contract`: 对比受控 progress 字段策略，确认 `manual_read_gate` 不应进入受控字段。
- `test_book_run_markdown_and_audit_report_exports_artifacts`: 复用 audit_report payload 断言模式。

### 4. 未重复造轮子的证明

- 已检查 BookRun schema/service/exporter/test；现有 progress JSON 与导出器足以承载目标，不新增表、服务或抽象。

### 本地验证

- `uv run pytest tests/test_book_runs.py tests/test_book_exporter.py -q`，工作目录 `apps/api`：16 passed，1 warning。
- `git diff --check -- apps/api/app/domains/book_runs/schemas.py apps/api/app/domains/book_runs/service.py apps/api/app/domains/exports/book_markdown_exporter.py apps/api/tests/test_book_runs.py apps/api/tests/test_book_exporter.py .codex/context-summary-manual-read-gate.md .codex/operations-log.md .codex/verification-report.md`：待执行。
## 编码前检查 - Story Memory guard

时间：2026-06-02 21:18:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-story-memory-guard.md`
□ 将使用以下可复用组件：

- `get_active_memory_atoms`: `apps/api/app/domains/story_memory/service.py` - 读取指定章节有效 MemoryAtom。
- `create_memory_atom`: `apps/api/app/domains/story_memory/service.py` - 测试中写入事实。
- `MemoryAtom`: `apps/api/app/domains/story_memory/schemas.py` - 长期事实契约。
- `NovelLoopPorts.check_static_quality`: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py` - issue dict 消费端口。
- `StaticProseIssue.as_report_item`: `apps/workflow/storyforge_workflow/quality/prose_static_check.py` - 输出字段参考。
  □ 将遵循命名约定：Python 函数和测试使用 snake_case；领域模块使用 `story_memory/guard.py`。
  □ 将遵循代码风格：中文 docstring/注释、plain assert、小函数拆分。
  □ 确认不重复造轮子，证明：已检查 `story_memory.service`、`prose_static_check`、`novel_loop`、`judge.service` 和 Story Memory 合同测试；现有模块缺少 API 域只读 Story Memory guard，workflow 检查不适合反向依赖。

### 工具记录

- sequential-thinking 已用于需求与风险梳理。
- shrimp-task-manager 已完成分析、反思、任务拆分。
- Context7 查询 Pydantic v2，确认既有 Pydantic 契约风格；本切片保持 dict 输出，无需新增 schema。
- GitHub code search 查询静态分析 issue 字段示例，最终采用仓库内 NovelLoop/prose_static_check 字段契约。
- desktop-commander 在当前工具列表不可用，已用 PowerShell 与 `rg` 替代本地文件检索。

### RED 验证

- `uv run pytest tests/test_book_runs.py::test_apply_book_run_progress_syncs_completed_chapter_to_timeline_once -q`，工作目录 `apps/api`：失败。
- 失败点：`assert len(events) == 1`，实际为 `0`。
- 结论：新增测试已先于生产代码验证红灯，失败原因与缺少 BookRun 到 TimelineEvent 自动同步一致。

### GREEN 验证

- `uv run pytest tests/test_book_runs.py::test_apply_book_run_progress_syncs_completed_chapter_to_timeline_once -q`，工作目录 `apps/api`：1 passed。
- `uv run pytest tests/test_book_runs.py tests/test_timeline_events.py -q`，工作目录 `apps/api`：17 passed，1 warning。
- `uv run ruff check app/domains/book_runs/service.py tests/test_book_runs.py`，工作目录 `apps/api`：All checks passed。
- `git diff --check -- apps/api/app/domains/book_runs/service.py apps/api/tests/test_book_runs.py .codex/context-summary-bookrun-timeline-sync.md .codex/operations-log.md`：通过。

## 编码后声明 - BookRun 完章同步 TimelineEvent

时间：2026-06-02 22:02:23 +08:00

### 1. 复用了以下既有组件

- `TimelineEventCreate`: 用于构造 TimelineEvent 创建契约，位于 `apps/api/app/domains/timeline/schemas.py`。
- `create_timeline_event`: 用于创建事件并复用章节归属校验，位于 `apps/api/app/domains/timeline/service.py`。
- `Chapter`: 用于将 `chapter_id` 或 `chapter_index` 解析到真实章节，位于 `apps/api/app/domains/books/models.py`。
- `list_timeline_events`: 用于测试读取同步结果，位于 `apps/api/app/domains/timeline/service.py`。

### 2. 遵循了以下项目约定

- 命名约定：新增 helper 均使用 snake_case，测试函数使用 `test_` 前缀。
- 代码风格：保持中文 docstring、SQLAlchemy `select`、pytest plain assert。
- 文件组织：未修改 timeline 模型、schema 或 service；同步逻辑集中在 BookRun progress 合并入口。

### 3. 对比了以下相似实现

- `_checkpoint_from_progress`: 同样扫描 `completed_chapters` 并只提取引用字段；本次新增事件同步但不改变 checkpoint 结构。
- `create_timeline_event`: 继续由 timeline 领域负责事件创建和作用域校验；BookRun 只负责投递完章事实。
- `test_timeline_events.py`: 复用现有事件字段契约，新增测试断言 project、volume、chapter、evidence 与 payload。

### 4. 未重复造轮子的证明

- 已检查 timeline service/schema/model，确认已有 TimelineEvent 创建能力，不新增事件模型。
- 已检查 BookRun service/checkpoint/resume 流程，确认 `apply_book_run_progress` 是唯一需要接入的 progress 合并入口。
- 已检查相关测试模式，新增用例复用现有内存数据库和服务层调用方式。

### 残留风险

- 事件去重当前在服务层查询并扫描 `evidence_refs`/`payload`，未新增数据库唯一约束；并发重复提交未来可通过 source key 或唯一索引加强。
- `create_timeline_event` 内部会提交事务；本轮受限于不修改 timeline service，在 BookRun 字段赋值后调用以保持当前服务路径一致。

### RED 验证

- `uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`，工作目录 `apps/api`：失败。
- 失败点：`ModuleNotFoundError: No module named 'app.domains.story_memory.guard'`。
- 结论：新增测试已先于生产代码验证红灯，失败原因与缺失 guard 模块一致。

## 编码前检查 - BookRun 完章同步 TimelineEvent

时间：2026-06-02 21:56:50 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-bookrun-timeline-sync.md`
□ 将使用以下可复用组件：

- `apply_book_run_progress`: `apps/api/app/domains/book_runs/service.py` - BookRun progress 合并入口。
- `TimelineEventCreate`: `apps/api/app/domains/timeline/schemas.py` - 现有 TimelineEvent 创建契约。
- `create_timeline_event`: `apps/api/app/domains/timeline/service.py` - 现有 TimelineEvent 创建服务。
- `Chapter`: `apps/api/app/domains/books/models.py` - 按真实章节解析 `completed_chapters`。
  □ 将遵循命名约定：Python helper 使用 snake_case，测试函数使用 `test_` 前缀。
  □ 将遵循代码风格：中文 docstring，服务层小函数拆分，SQLAlchemy 2.0 `select` 查询。
  □ 确认不重复造轮子，证明：已检查 timeline service/schema/model、BookRun service/checkpoint 逻辑、BookRun 与 TimelineEvent 测试；现有 timeline 能力足够创建事件。

### 工具记录

- sequential-thinking 已用于需求、风险与方案梳理。
- shrimp-task-manager 已完成分析、反思、任务拆分，并建立三项任务。
- Context7 查询 SQLAlchemy ORM 2.0，确认 `select`、`session.scalars`、`commit`、`refresh` 用法与项目一致。
- GitHub code search 查询事件证据字段相关实现，未找到可直接复用代码，最终采用仓库内 `evidence_refs`/`payload` 稳定来源键。
- desktop-commander 在当前工具列表不可用，已用 PowerShell 与 `rg` 替代本地文件检索。

## 文档记录 - Assistant 审阅/导出持久回流缺口

时间：2026-06-02 21:54:40 +08:00

### 任务边界

- 本次仅记录文档，不修改业务代码。
- 允许写集：`.codex/operations-log.md`、`.codex/verification-report.md`、`.codex/context-summary-assistant-session-persistence.md`。
- 禁止事项：未读取 `.env`；未读取或写入 API Key、凭据或密钥；未回滚非本次修改文件。

### 上下文检索记录

- 文件名搜索：使用 `rg --files` 排除 `.env`、key、secret、credential 类路径后，定位 Assistant、BookRun、Studio、导出、审阅相关文件。
- 内容搜索：检索 `AssistantSession`、`assistant_sessions`、`URLSearchParams`、`chapter_review_status`、`artifact_export_status`、`writeback_status`、`BookRun` 等关键字。
- 相似实现：
  - `apps/web/components/home/assistant-chapter-review-actions.ts`：章节审阅通过 URL query 临时回流。
  - `apps/web/components/home/assistant-artifact-export-actions.ts`：导出交付物通过 URL query 临时回流。
  - `apps/web/app/studio/approval-action-core.ts`：Studio 批准写回状态通过 URL query 临时回流。
  - `apps/web/components/home/assistant-book-run-actions.ts`：BookRun 命令已持久写入或追加 AssistantSession。
  - `apps/web/components/home/assistant-session-store.ts`：前端 AssistantSession API helper 已存在。
  - `apps/api/app/domains/assistant/router.py`、`service.py`、`models.py`：后端 AssistantSession API 与模型已存在。
- 测试模式：
  - `apps/web/tests/assistant-chapter-review-actions.test.ts`
  - `apps/web/tests/assistant-artifact-export-actions.test.ts`
  - `apps/web/tests/assistant-book-run-actions.test.ts`
  - `apps/web/tests/assistant-session-store.test.ts`
  - `apps/web/tests/studio.test.tsx`
  - `apps/api/tests/test_assistant_sessions.py`

### 工具记录

- sequential-thinking：已用于梳理任务边界、风险和证据需求。
- shrimp-task-manager：已执行任务规划和初步分析。
- Context7：查询 `/vercel/next.js`，确认 Server Action 中数据变更后可在 `redirect` 前执行缓存刷新，`redirect` 属于框架控制流。
- GitHub code search：查询 `URLSearchParams redirect server action revalidatePath language:TypeScript`，仅作为外部模式参考；事实依据仍以仓库内文件为准。
- desktop-commander：当前工具列表未提供，已用 PowerShell 与 `rg` 替代本地文件检索，并遵守不读取凭据限制。

### 编码前检查 - Assistant 审阅/导出持久回流缺口

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-session-persistence.md`
□ 将使用以下可复用组件：

- `createAssistantSession`: `apps/web/components/home/assistant-session-store.ts` - 下一阶段可创建持久会话。
- `appendAssistantSessionMessage`: `apps/web/components/home/assistant-session-store.ts` - 下一阶段可追加动作结果消息。
- `writeAssistantBookRunSession`: `apps/web/components/home/assistant-book-run-actions.ts` - 已闭环的持久写回参照。
  □ 将遵循命名约定：文档任务使用中文标题；代码路径保留项目真实路径。
  □ 将遵循代码风格：仅写 Markdown 文档，不新增业务抽象。
  □ 确认不重复造轮子，证明：后端 AssistantSession API 和前端 helper 已存在，本次只记录缺口和下一阶段最小写集。

### 缺口记录

- 章节审阅：当前主要通过 `chapter_review_status`、`chapter_review_summary`、`repair_patch_id` 等 URL 参数回流，缺少 AssistantSession 持久消息。
- 导出交付物：当前主要通过 `artifact_export_status`、`artifact_export_summary`、`artifact_export_error` 等 URL 参数回流，缺少 AssistantSession 持久消息。
- Studio 批准写回：当前主要通过 `writeback_status`、`approved_chapter_id`、`unavailable_reason` 等 URL 参数回流，缺少 AssistantSession 持久消息。
- 已有参照：BookRun 命令成功后会通过 `createAssistantSession` 或 `appendAssistantSessionMessage` 持久写入 AssistantSession。
- 后端基础：`/api/assistant/sessions` 与 `/api/assistant/sessions/{assistant_session_id}/messages` 已存在，可直接复用。

### 下一阶段最小写集建议

- 修改 `apps/web/components/home/assistant-chapter-review-actions.ts` 和对应测试，使审阅成功路径写入短摘要，失败和无效参数不写。
- 修改 `apps/web/components/home/assistant-artifact-export-actions.ts` 和对应测试，使导出成功路径写入交付物摘要，未完成或失败不写。
- 修改 `apps/web/app/studio/approval-action-core.ts` 和 `apps/web/tests/studio.test.tsx`，使批准写回成功路径写入状态消息，提交失败不写。
- 复用 `apps/web/components/home/assistant-session-store.ts`，不新增后端路由、数据库表或凭据配置。

### 验证建议

- 运行 `pnpm --filter @storyforge/web test` 或项目既有 Web 定向测试脚本。
- 定向运行：
  - `apps/web/tests/assistant-chapter-review-actions.test.ts`
  - `apps/web/tests/assistant-artifact-export-actions.test.ts`
  - `apps/web/tests/assistant-book-run-actions.test.ts`
  - `apps/web/tests/assistant-session-store.test.ts`
  - `apps/web/tests/studio.test.tsx`
- API 侧可运行 `apps/api/tests/test_assistant_sessions.py`，确认 AssistantSession 契约仍拒绝敏感 payload key。
- 做静态检查：确认持久消息不包含正文、补丁全文、导出内容、API Key、token、secret 或 credential 字段。

### 编码后声明 - Assistant 审阅/导出持久回流缺口

时间：2026-06-02 21:54:40 +08:00

### 1. 复用了以下既有组件

- `apps/web/components/home/assistant-session-store.ts`：作为下一阶段持久写回复用入口。
- `apps/web/components/home/assistant-book-run-actions.ts`：作为已闭环持久写回参考。
- `apps/api/app/domains/assistant/router.py`：作为后端 API 已存在的证据。

### 2. 遵循了以下项目约定

- 命名约定：文档文件名使用 `context-summary-assistant-session-persistence.md`，与 `.codex` 现有上下文摘要命名一致。
- 代码风格：未新增代码；文档使用简体中文和 Markdown 小节。
- 文件组织：所有产物均写入项目本地 `.codex/`，未写入全局目录。

### 3. 对比了以下相似实现

- `assistant-chapter-review-actions.ts`：临时 URL 回流模式。
- `assistant-artifact-export-actions.ts`：临时 URL 回流模式。
- `approval-action-core.ts`：Studio 写回状态 URL 回流模式。
- `assistant-book-run-actions.ts`：持久写 AssistantSession 模式。

### 4. 未重复造轮子的证明

- 已检查 `assistant-session-store.ts`、Assistant 后端 router/service/model 和 BookRun 命令写回路径，确认下一阶段无需新增后端 API 或自研持久层。

### 本地验证

- 已执行 Markdown 内容检索，三份 `.codex` 文档均覆盖缺口、证据文件路径、下一阶段最小写集建议、验证建议、风险。
- 已执行敏感词检索，命中内容均为安全边界说明或历史日志说明，未新增密钥值、token 值、secret 值、credential 值或 `.env` 内容。
- `git diff --check -- .codex/operations-log.md .codex/verification-report.md .codex/context-summary-assistant-session-persistence.md`：通过，无空白错误。
- `git status --short -- .codex/operations-log.md .codex/verification-report.md .codex/context-summary-assistant-session-persistence.md`：仅显示本次允许写集内 2 个修改文件和 1 个新增文件。

## 阶段整合验证 - Story Memory / Timeline / OpenAPI / Assistant 缺口

时间：2026-06-02 22:07:13 +08:00

### 执行摘要

- 主线程新增 `apps/api/app/domains/story_memory/guard.py`，实现 `check_story_memory_continuity(...)`，复用 `get_active_memory_atoms`，只拦截当前章节 active 且高置信或不可变的 `status/location/rule` 硬冲突。
- Timeline worker 已实现 BookRun `completed_chapters` 到 TimelineEvent 的自动同步和重复回填去重，复用 `TimelineEventCreate` 与 `create_timeline_event`。
- OpenAPI worker 已刷新 `packages/shared/src/contracts/storyforge.openapi.json` 与 `packages/shared/src/generated/api-types.ts`，确认 `BookRunWorkflowDispatch.volume_plan` 与 `BookRunVolumePlanItem` 存在。
- 文档 worker 已记录 Assistant 章节审阅、导出交付物、Studio 批准写回未持久写入 AssistantSession 的缺口与下一阶段最小写集建议。

### 本地验证结果

- `uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`：14 passed。
- `uv run pytest tests/test_book_runs.py tests/test_timeline_events.py tests/test_book_run_workflow_dispatch.py tests/test_book_exporter.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`：40 passed，1 个既有 HTTP 422 deprecation warning。
- `uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py tests/test_novel_loop_skill_runner_integration.py tests/test_novel_loop_single_chapter.py -q`：18 passed。
- `pnpm --filter @storyforge/shared test`：通过，`tsc --noEmit` 无错误。
- `uv run ruff check app/domains/story_memory/guard.py app/domains/book_runs/service.py tests/test_story_memory_contract.py tests/test_book_runs.py`：All checks passed。
- `git diff --check`：通过。

### 残留风险

- `create_timeline_event()` 当前内部会 `commit`，从 `apply_book_run_progress()` 内调用时会提前提交同一 session 中的 BookRun progress；现有测试通过，但后续如强化事务边界，建议拆出不自动提交的内部创建函数或在 service 层统一事务。
- Story Memory guard 当前采用保守文本启发式，只覆盖高置信硬冲突，不覆盖复杂语义矛盾；这是为了避免误杀，后续接入 NovelLoop 端口后再补更多样例。
- Assistant 审阅/导出/批准写回持久回流仍是文档化缺口，下一阶段需要修改前端 Server Action 并补 Web 测试。
- 真实 LLM 3-5 万字或 10 章最终验收仍缺模型名和可用运行参数，本阶段未执行该端到端门禁。

## 阶段执行 - AssistantSession 持久回流闭环

时间：2026-06-02 22:25:40 +08:00

### 执行摘要

- `apps/web/components/home/assistant-chapter-review-actions.ts`：章节审阅 ready 成功后写入 AssistantSession；有 `assistant_session_id` 时追加消息，无会话 ID 时创建 `task_type=chapter_review` 新会话；失败和缺少 `scene_packet_id` 不写。
- `apps/web/components/home/assistant-artifact-export-actions.ts`：BookRun completed 且 Markdown、EPUB、审计报告全部导出成功后写入 AssistantSession；有 `assistant_session_id` 时追加消息，无会话 ID 时创建 `task_type=artifact_export` 新会话；invalid、not_ready、导出失败不写。
- `apps/web/app/studio/approval-action-core.ts` 与 `apps/web/app/studio/actions.tsx`：Studio 批准 API 成功且响应格式有效后写入 AssistantSession；有 `assistant_session_id` 时追加消息，无会话 ID 时创建 `task_type=chapter_review` 新会话；invalid、API 失败、响应格式无效、异常路径不写。
- 三条路径均只写业务 ID、状态和短摘要，不写正文、补丁全文、导出内容或凭据。

### 本地验证结果

- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions assistant-artifact-export-actions studio assistant-book-run-actions assistant-session-store`：26 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。
- `pnpm --filter @storyforge/web test`：191 passed。
- `git diff --check`：通过。
- 敏感字段检索：`rg -n "provider_api_key|authorization|Bearer |sk-|API Key|token|secret|credential|凭据|密钥" ...` 仅命中测试数据结构中的 `token_budget/tokens_used` 字段名，未发现密钥值或凭据内容。

### 残留风险

- 当前首页 `AssistantActionBar` 尚未统一传递真实 `assistant_session_id`，因此无会话 ID 的按钮会创建新会话；这已满足持久追溯，但同一对话连续追加需要后续设计当前会话 ID 生命周期。
- 如果 AssistantSession 写入失败，当前 action 会按失败状态回流，避免误报成功；这会让外部动作成功但会话写入失败时显示失败，需要后续根据产品取舍决定是否降级为非阻断警告。

## Studio 批准写回 AssistantSession 持久化

时间：2026-06-02 22:24:00 +08:00

### 操作记录

- 修改 `apps/web/app/studio/approval-action-core.ts`：在批准 API 成功且响应格式有效后调用可注入 `writeAssistantApprovalSession`，失败、无效输入、异常和响应格式无效路径不写会话。
- 修改 `apps/web/app/studio/actions.tsx`：复用 `appendAssistantSessionMessage` / `createAssistantSession` 注入真实写入逻辑；消息仅包含写回状态、批准章节 ID、repair/scene ID 和短摘要。
- 修改 `apps/web/tests/studio.test.tsx`：补充已有会话追加、新会话创建、失败路径不写会话的定向测试。

### 本地验证

- `pnpm --filter @storyforge/web test -- studio`：6 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `git diff --check -- apps/web/app/studio/approval-action-core.ts apps/web/app/studio/actions.tsx apps/web/tests/studio.test.tsx`：通过。

## 编码前检查 - 章节审阅成功结果写入 AssistantSession

时间：2026-06-02 22:30:00 +08:00

- 未读取 `.env`，未读取或输出任何 API Key、token、secret、credential 或凭据。
- desktop-commander 工具未在当前环境暴露，已改用 PowerShell 与 `rg` 执行本地只读检索。
- 已分析相似实现：`apps/web/components/home/assistant-book-run-actions.ts` 的会话写入依赖注入、`apps/web/components/home/assistant-session-store.ts` 的 `appendAssistantSessionMessage` / `createAssistantSession`、`apps/web/tests/assistant-book-run-actions.test.ts` 的 Server Action 测试模式。
- 已查询 Next.js 官方文档：Server Action mutation 后先 `revalidatePath` 再 `redirect`，本次保留既有顺序。
- 已执行 GitHub 代码搜索：同名模式无结果，宽泛 `createAssistantSession messages` 结果仅作会话创建参考，最终以本仓库模式为准。
- TDD RED：`pnpm --filter @storyforge/web test -- assistant-chapter-review-actions` 失败，失败点为成功路径未调用注入的 `writeAssistantChapterReviewSession`，符合预期。

## 编码后声明 - 章节审阅成功结果写入 AssistantSession

时间：2026-06-02 22:40:00 +08:00

### 1. 复用了以下既有组件

- `appendAssistantSessionMessage`: 用于已有 AssistantSession 追加章节审阅成功消息，位于 `apps/web/components/home/assistant-session-store.ts`。
- `createAssistantSession`: 用于没有 `assistant_session_id` 时创建 `task_type: chapter_review` 的新会话，位于 `apps/web/components/home/assistant-session-store.ts`。
- `submitAssistantBookRunCommand` 的依赖注入模式：用于新增 `writeAssistantChapterReviewSession` 可选注入，位于 `apps/web/components/home/assistant-book-run-actions.ts`。

### 2. 遵循了以下项目约定

- 命名约定：TypeScript 函数和依赖 payload 使用 camelCase，后端请求和 URL 参数继续使用既有 snake_case。
- 代码风格：测试继续使用 `node:test` 与 `assert`，Server Action 保持 `apiFetch`、`revalidatePath`、`redirect` 注入模式。
- 文件组织：业务改动限定在章节审阅 action 和对应测试；`.codex` 仅追加操作与验证记录。

### 3. 对比了以下相似实现

- `assistant-book-run-actions.ts`: 本次沿用成功后写入会话、失败 redirect、依赖注入测试的模式。
- `assistant-session-store.ts`: 本次不新增 API client 或自研持久层，直接复用 create/append helper。
- `assistant-chapter-review-actions.test.ts`: 本次沿用 URL redirect 断言和摘要安全断言，补充会话写入断言。

### 4. 未重复造轮子的证明

- 已检查 `apps/web/components/home/assistant-session-store.ts` 和 BookRun 会话写入路径，确认已有可复用的 AssistantSession 创建与追加能力。
- 未新增后端接口、数据库模型、外部依赖或凭据配置。

### 本地验证

- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions`：5 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。

## 编码后声明 - 导出交付物成功结果写入 AssistantSession

时间：2026-06-02 22:18:08 +08:00

- 未读取 `.env`，未读取或输出任何 API Key、token、secret、credential 或凭据。
- 已复用 `apps/web/components/home/assistant-session-store.ts` 的 `appendAssistantSessionMessage` 与 `createAssistantSession`。
- 已参考 `apps/web/components/home/assistant-book-run-actions.ts` 的可选会话写入依赖注入模式。
- 已在 `apps/web/components/home/assistant-artifact-export-actions.ts` 中仅于三类导出全部成功后写入 AssistantSession，invalid、not_ready、导出 POST 失败均不写入。
- 已运行定向测试：`pnpm --filter @storyforge/web test assistant-artifact-export-actions`，结果 5/5 通过。
- 已运行格式检查：`pnpm exec prettier --check apps/web/components/home/assistant-artifact-export-actions.ts apps/web/tests/assistant-artifact-export-actions.test.ts`，结果通过。
- 补充运行 `pnpm --filter @storyforge/web lint` 时失败，错误集中在未修改的 `apps/web/tests/assistant-chapter-review-actions.test.ts`，本次限定写集内未修复。

## 编码后声明 - BookRun AssistantSession ID 贯穿收尾

时间：2026-06-02 22:50:00 +08:00

### 1. 复用了以下既有组件

- `submitAssistantBookRunCommand`: 继续复用既有 BookRun 命令 Server Action，未修改运行时代码。
- `writeAssistantBookRunSession` 注入契约：测试继续通过依赖注入验证已有会话追加、新会话创建和 redirect 回传。
- `assistant-artifact-export-actions` 与 `assistant-chapter-review-actions` 的会话 ID 回传模式：作为同类 redirect 契约参考。

### 2. 遵循了以下项目约定

- 命名约定：测试名继续使用中文描述，URL 参数继续使用既有 snake_case。
- 代码风格：保持 `node:test`、`node:assert/strict` 和依赖注入断言方式。
- 文件组织：仅修改 `apps/web/tests/assistant-book-run-actions.test.ts` 中两个 URL 断言，不触碰其他脏文件。

### 3. 对比了以下相似实现

- `apps/web/components/home/assistant-book-run-actions.ts`: 当前实现使用 `writtenAssistantSessionId ?? assistantSessionId` 作为 redirect 会话 ID 来源。
- `apps/web/tests/assistant-artifact-export-actions.test.ts`: 成功后已有会话或新建会话均在 redirect 中携带 `assistant_session_id`。
- `apps/web/tests/assistant-chapter-review-actions.test.ts`: ready 成功路径同样验证 `assistant_session_id` 回传。

### 4. 未重复造轮子的证明

- 已使用 `rg` 检查 `book_run_command_status=ok`、`assistant_session_id=31` 和 `submitAssistantBookRunCommand` 的现有断言位置。
- 本次只校准测试契约，未新增 helper、外部依赖、后端接口或自研状态存储。

### 本地验证

- `pnpm --filter @storyforge/web test -- assistant-book-run-actions assistant-chapter-review-actions assistant-artifact-export-actions studio home-page`：36 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `git diff --check`：通过。
- `pnpm --filter @storyforge/web test`：194 passed。
- `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。

## 编码后声明 - Assistant 最近记录可追溯链接

时间：2026-06-02 22:57:07 +08:00

### 1. 复用了以下既有组件

- `readRecentAssistantSessions`: 继续复用已有真实 Assistant sessions 读取 helper，位于 `apps/web/components/home/assistant-session-store.ts`。
- `mapAssistantSessionToHomeRecentItem`: 扩展同一映射函数，为最近记录增加 `href`，未新增并行数据源。
- `HomeSidebar`: 复用已有 `next/link`，将最近记录从静态文本改为内部链接。

### 2. 遵循了以下项目约定

- 命名约定：TypeScript 字段使用 camelCase，URL 参数沿用既有 `assistant_session_id`、`book_run_id`、`artifact_id`、`blueprint_id`。
- 代码风格：保持 `readonly` 类型、`URLSearchParams` 构造 query、`node:test` 契约测试。
- 文件组织：改动限定在首页最近记录投影和侧栏渲染，不修改后端接口或 OpenAPI。

### 3. 对比了以下相似实现

- `apps/web/app/page.tsx`: 当前已读取真实最近会话并传给 `HomeShell`，本次只补可点击追溯能力。
- `apps/web/components/home/AssistantConversation.tsx`: 已从 URL 读取 `assistant_session_id` 和 `book_run_id`，最近记录链接回传这些参数即可恢复上下文。
- `apps/web/components/home/home-view.ts`: 最近记录默认回到 Assistant 首页，不新增一级 view。

### 4. 未重复造轮子的证明

- 已通过 `rg` 检查 `HomeRecentItem`、`recentItems` 和 `homeRecentEmpty` 的使用点，确认消费范围集中在首页组件和测试。
- 未新增后端路由、数据库字段、API helper 或静态最近记录。

### 本地验证

- `pnpm --filter @storyforge/web test -- assistant-session-store home-page`：19 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `git diff --check`：通过。
- `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。

## 编码后声明 - Artifact.export 识别真实审计导出证据

时间：2026-06-02 23:02:10 +08:00

### 1. 复用了以下既有组件

- `mapBookRunToAssistantToolNodes`: 继续作为 BookRun 到 Assistant 工具树的唯一映射入口。
- `progress.audit_report`: 复用后端导出审计报告已写入的进度证据，不新增 schema 或 OpenAPI。
- `submitAssistantArtifactExport`: 继续负责调用 Markdown、EPUB、audit_report 三类真实导出并写 AssistantSession 摘要，本次不修改 action。

### 2. 遵循了以下项目约定

- 命名约定：新增 helper 使用 camelCase，读取字段保持后端 progress 的 snake_case。
- 代码风格：继续使用 `Record<string, unknown>` 守卫、局部 helper 和 `node:test` 断言。
- 文件组织：改动限定在 `assistant-tool-node-mapper.ts` 和对应测试，不改后端契约。

### 3. 对比了以下相似实现

- `assistant-tool-node-mapper.ts` 既有 Provider、章节、审阅、修复状态均从 BookRun 状态和 progress 派生；本次沿用同一策略。
- `assistant-artifact-export-actions.ts` 已确保导出成功后 URL 和会话摘要包含制品摘要；本次让工具树能识别后续 BookRun progress 中的审计报告证据。
- `test_book_exporter.py` 已证明 `audit_report.json` 后端制品包含 skill_chain，本次仅消费其投影证据。

### 4. 未重复造轮子的证明

- 已检查 `Artifact.export` 相关测试、导出 action、BookRun exporter 和审计页逻辑，确认缺口集中在 mapper 状态判断。
- 未新增导出 API、Artifact 存储、审计页解析器或外部依赖。

### 本地验证

- TDD 红灯：`pnpm --filter @storyforge/web test -- assistant-tool-node-mapper` 首次失败 1 项，失败点为 audit_report 证据仍映射 waiting。
- TDD 绿灯：`pnpm --filter @storyforge/web test -- assistant-tool-node-mapper`：6 passed。
- `pnpm --filter @storyforge/web test -- assistant-tool-node-mapper assistant-artifact-export-actions book-runs`：14 passed。
- `uv run pytest tests/test_book_exporter.py -q`：3 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `git diff --check`：通过。
- `pnpm --filter @storyforge/web test`：195 passed。

## 编码前检查 - Assistant 章节审阅主动创建

时间：2026-06-03 00:02:17 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-chapter-review-active-create.md`

□ 将使用以下可复用组件：

- `create_judge_issues`: `apps/api/app/domains/judge/service.py` - 结构化创建 JudgeIssue。
- `create_repair_patch`: `apps/api/app/domains/repair/service.py` - 基于 JudgeIssue span 创建 RepairPatch。
- `read_studio_approval_summary`: `apps/api/app/domains/studio/service.py` - 生成批准资格摘要。
- `apiFetch`: `apps/web/lib/api-client.ts` - Assistant Server Action 统一 API 请求入口。

□ 将遵循命名约定：后端 snake_case，前端 camelCase，本地 URL query 保持现有 snake_case。

□ 将遵循代码风格：FastAPI router/service/schema 分层，Server Action 使用 `unknown` 解析和短 URL 摘要。

□ 确认不重复造轮子：已检查 Studio 只读端点、Judge 创建端点、Repair 创建端点和批准写回端点，缺口是 Assistant 缺少主动编排薄层。

## 编码后声明 - Assistant 章节审阅主动创建

时间：2026-06-03 00:02:17 +08:00

### 1. 复用了以下既有组件

- `JudgeIssueCreate` 与 `create_judge_issues`: 由新 Studio 薄端点传入 Scene 正文、必含事实、风格规则和证据链接。
- `RepairPatchCreate` 与 `create_repair_patch`: 对可安全匹配 span 的 JudgeIssue 生成修复补丁。
- `read_studio_approval_summary`: 对首个修复补丁或 clean Scene Packet 返回批准资格摘要。
- `submitAssistantChapterReview`: 保留既有 AssistantSession 写入、`revalidatePath('/')` 和 redirect URL 契约。

### 2. 遵循了以下项目约定

- 命名约定：后端新增 `run_studio_chapter_review`、`StudioChapterReviewRunRequest`、`StudioChapterReviewRunRead`；前端 helper 使用 camelCase。
- 代码风格：后端使用中文 docstring、FastAPI `response_model`、路由层 HTTPException；前端不泄露正文和补丁全文。
- 文件组织：改动集中在 Studio 编排层、Assistant action 和对应测试；Judge/Repair 内部逻辑未复制。

### 3. 对比了以下相似实现

- `read_studio_scene_packet`: 复用 `ScenePacket -> Scene -> Chapter` 定位模式。
- `read_studio_judge_review` / `read_studio_repair_patches`: 复用摘要转换函数，但不复用其空态 404 语义。
- `approve_studio_writeback`: 保持人工批准写回边界，新端点只创建审阅和修复建议。

### 4. 未重复造轮子的证明

- 已通过代码搜索确认 `scene_packet_id` 不能让前端直接调用 Judge/Repair；后端薄端点负责读取正文和 packet 约束。
- 未新增大型 Agent 框架、未新增凭据存储、未改 Judge/Repair 领域判定。
- OpenAPI 与 shared types 通过现有生成链路同步。

### 5. 本地验证

- TDD 红灯：`uv run pytest tests/test_redis_cache_strategy.py::test_cache_delete_pattern_treats_incomplete_client_as_cache_miss -q` 首次失败，复现不完整 Redis 客户端导致 `scan_iter` AttributeError。
- `uv run pytest tests/test_studio_book_list_api.py -q`：23 passed。
- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions`：6 passed。
- `pnpm openapi`：已生成 OpenAPI 契约。
- `pnpm --filter @storyforge/shared generate:types`：已生成 shared API types。
- `uv run pytest tests/test_studio_book_list_api.py tests/test_judge_repair.py -q`：24 passed。
- `pnpm --filter @storyforge/shared test`：通过。
- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions home-page studio`：25 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `uv run pytest tests/test_api_surface.py -q`：1 passed。
- `uv run pytest -q`：364 passed，6 warnings。
- `pnpm --filter @storyforge/web test`：195 passed。
- `pnpm verify`：通过；包含根 lint/Prettier、Web lint、shared tsc、Web 195、API 364、API Ruff、Workflow 161、Workflow Ruff、OpenAPI 漂移检查。

### 6. 仍未完成或不可宣称

- 真实外部 LLM 10 章或 3-5 万字短篇仍未完成验收，不能宣称长程稳定生产。
- 自然语言“审阅第二章”自动解析到具体 `scene_packet_id` 仍未完成；当前完成的是指定 `scene_packet_id` 后的主动审阅闭环。
- 浏览器级连续会话点击测试仍未补齐，当前证据主要来自本地单元、契约和全量 verify。

## 编码后声明 - Assistant 工具树移除硬编码预算摘要

时间：2026-06-02 23:04:45 +08:00

### 1. 复用了以下既有组件

- `AssistantToolTree`: 保留工具树展示入口，仅替换顶部硬编码演示摘要。
- `AssistantToolNode` 的 `elapsedLabel`、`tokenLabel`、`toolUseLabel`: 继续作为真实耗时、token、预算和成本展示来源。
- `home-page.test.tsx`: 复用首页源码契约测试，防止演示指标回流。

### 2. 遵循了以下项目约定

- 不在 UI 中展示静态假耗时、假 token 或假思考耗时。
- 真实预算信息继续来自 BookRun mapper，不新增前端本地状态。
- 保持中文说明和现有 Tailwind 风格。

### 3. 对比了以下相似实现

- `assistant-tool-node-mapper.ts`: 已为章节节点输出真实 `elapsedLabel`、`tokenLabel` 和 `toolUseLabel`。
- `AssistantToolTree.tsx`: 节点行已经渲染真实标签，本次移除顶部冲突的演示摘要。
- `home-page.test.tsx`: 已有“不得伪造 completed 状态”的测试，本次扩展为不得伪造耗时/token。

### 本地验证

- TDD 红灯：`pnpm --filter @storyforge/web test -- home-page` 首次失败 1 项，失败点为硬编码耗时。
- TDD 绿灯：`pnpm --filter @storyforge/web test -- home-page assistant-tool-node-mapper`：19 passed。
- `pnpm --filter @storyforge/web lint`：通过，`tsc --noEmit` 无错误。
- `git diff --check`：通过。
- `pnpm --filter @storyforge/web test`：195 passed。

## 编码前检查 - Assistant 章节审阅自然语言定位

时间：2026-06-03 00:22:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-chapter-review-natural-target.md`

□ 将使用以下可复用组件：

- `parseCountToken` / `parseCountBeforeUnit`: `apps/web/components/home/assistant-intent.ts` - 解析中文和阿拉伯数字章节序号。
- `/api/studio/scene-packets`: 后端 Studio 既有只读端点 - 通过 `book_id + target_ordinal` 定位真实 `scene_packet_id`。
- `submitAssistantChapterReview`: `apps/web/components/home/assistant-chapter-review-actions.ts` - 复用主动创建 Judge/Repair 的 Server Action。
- `AssistantConversation` / `AssistantActionBar`: 复用 URL query 到 hidden input 的现有链路。

□ 将遵循命名约定：前端 TypeScript 使用 camelCase，API query/body 字段保持 snake_case。

□ 将遵循代码风格：Prettier、`node:test`、注入式 mock、简体中文错误提示和审查留痕。

□ 确认不重复造轮子，证明：已检查 `assistant-intent.ts`、`assistant-chapter-review-actions.ts`、`app/studio/api.ts`、`AssistantConversation.tsx`、`AssistantActionBar.tsx`、Studio 后端 schemas/service/router 和相关测试；后端 Scene Packet 定位端点已存在，不新增路由。

□ 工具缺失记录：当前环境未暴露 `desktop-commander`，本阶段使用 PowerShell、`rg`、Context7、GitHub code search 和子代理只读核查替代，并保留来源。

## 编码后声明 - Assistant 章节审阅自然语言定位

时间：2026-06-03 00:39:00 +08:00

### 1. 复用了以下既有组件

- `parseCountToken` 和 `parseCountBeforeUnit`: 用于解析“第二章/第2章/2章”。
- `/api/studio/scene-packets`: 用 `book_id + target_ordinal` 定位真实 `scene_packet_id`。
- `/api/studio/chapter-review`: 定位后继续主动创建 JudgeIssue 和 RepairPatch。
- `AssistantConversation`、`AssistantActionBar`、`HomeComposer`: 复用首页 query 参数和 Server Action 表单提交模式。

### 2. 遵循了以下项目约定

- 命名约定：新增前端字段 `targetChapterOrdinal`，提交给 API 的 hidden 字段为 `target_chapter_ordinal`。
- 代码风格：所有触及文件通过 Prettier 检查和 `@storyforge/web lint`。
- 文件组织：改动限制在 Assistant 首页组件、章节审阅 action 和对应 Web 测试。

### 3. 对比了以下相似实现

- `app/studio/api.ts`: 已有 `readStudioScenePacket()` 使用 `book_id + target_ordinal` 读取 Scene Packet，本次在 Server Action 中复用同一后端契约。
- `assistant-book-run-actions.ts`: 沿用注入式 `apiFetch`、`redirect`、会话写入测试模式。
- `AssistantConversation.tsx`: 沿用 `chapter_review_status` 回流消息模式，并新增 `select_book` 可读状态。

### 4. 未重复造轮子的证明

- 未新增后端 API、未改 OpenAPI/shared types；子代理核查确认 `/api/studio/scene-packets` 契约已存在。
- 未新增中文数字库；复用项目内已有中文数字解析。
- 未把前端直接接入 Judge/Repair 领域逻辑；仍通过 Studio 薄端点编排。

### 5. 本地验证

- `pnpm --filter @storyforge/web test -- assistant-intent assistant-chapter-review-actions home-page`：29 passed。
- `pnpm --filter @storyforge/web test`：200 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `pnpm exec prettier --check apps/web/components/home/assistant-intent.ts apps/web/tests/assistant-intent.test.ts apps/web/components/home/assistant-chapter-review-actions.ts apps/web/tests/assistant-chapter-review-actions.test.ts apps/web/components/home/AssistantConversation.tsx apps/web/components/home/AssistantActionBar.tsx apps/web/components/home/HomeComposer.tsx apps/web/tests/home-page.test.tsx`：通过。
- `git diff --check -- apps/web/components/home/assistant-intent.ts apps/web/tests/assistant-intent.test.ts apps/web/components/home/assistant-chapter-review-actions.ts apps/web/tests/assistant-chapter-review-actions.test.ts apps/web/components/home/AssistantConversation.tsx apps/web/components/home/AssistantActionBar.tsx apps/web/components/home/HomeComposer.tsx apps/web/tests/home-page.test.tsx`：通过。
- 敏感前缀检查：已使用脱敏后的真实用户 key 前缀和常见环境变量模式扫描 `.codex`、`docs`、首页组件与 Web 测试，未命中真实用户 key；仅命中测试中的 `unit-test-key`、`unit-key` 和历史默认说明。

### 6. 仍未完成或不可宣称

- 真实外部 LLM 10 章或 3-5 万字短篇仍未完成验收。
- 浏览器级连续会话点击测试仍未补齐。
- 缺少真实 `book_id` 时仍只能提示选择作品，不能伪造默认作品。

## 编码前检查 - Provider、预算和暂停原因可视化

时间：2026-06-03 01:16:35 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-provider-budget-visibility.md`

□ 将使用以下可复用组件：

- `apply_book_run_progress`: `apps/api/app/domains/book_runs/service.py` - 统一处理 BookRun progress、预算统计和状态门禁。
- `mapBookRunToAssistantToolNodes`: `apps/web/components/home/assistant-tool-node-mapper.ts` - 把 BookRunRead provider/预算/暂停原因映射为工具树节点。
- `ProviderSettingsPanel`: `apps/web/app/settings/ProviderSettingsPanel.tsx` - 保持 Provider Base URL 设置与模型检测，不保存 API Key。

□ 将遵循命名约定：后端 snake_case；前端 BookRunRead 字段保持 snake_case，测试描述和报告使用简体中文。

□ 将遵循代码风格：不新增外部依赖，不读取 `.env`，不落盘真实 API Key；只做 P1 收口相关补强和文档留痕。

□ 确认不重复造轮子，证明：已核查 BookRun service、Assistant mapper、Provider settings、phase9b smoke 预算模式，缺口是统一预算门禁测试和 P1 留痕收口。

□ 子代理核查：已并行启动后端预算、前端工具树、计划 P1、P2 入口扫描四个只读子代理；执行完毕后释放。

## 编码后声明 - Provider、预算和暂停原因可视化

时间：2026-06-03 01:16:35 +08:00

### 1. 复用了以下既有组件

- `apply_book_run_progress()`：在 progress 回填时执行 token/time/chapter 预算门禁，触顶后写入 `paused_by_budget`、`pause_reason` 和 `budget_exceeded`。
- `mapBookRunToAssistantToolNodes()`：展示 Provider 解析状态、tokens、时间预算、章节预算、成本和暂停原因。
- `ProviderSettingsPanel`：保持浏览器端只保存 `baseUrl`，通过 `/api/provider-models` 检测模型列表。

### 2. 遵循了以下项目约定

- 命名约定：新增测试名使用项目现有 `test_progress_update_*` 风格。
- 代码风格：后端测试使用 pytest + TestClient；前端测试沿用 `node:test` 字符串契约。
- 文件组织：后端预算门禁保持在 BookRun service，前端展示保持在 Assistant mapper，设置页不混入创作偏好。

### 3. 对比了以下相似实现

- `phase9b_real_llm_smoke.py` 的预算暂停思路：本阶段把相同风险控制前移到通用 BookRun progress 回填。
- `assistant-tool-node-mapper.ts` 的 completed/failed 映射：Provider 不可用时即使原状态 completed 也强制章节节点 failed。
- `ProviderSettingsPanel.tsx` 的 localStorage 契约：只保存 Base URL，不新增 API Key 状态。

### 4. 未重复造轮子的证明

- 未新增前端预算状态容器，工具树继续读取 BookRunRead。
- 未新增 Provider 凭据存储，API Key 仍只允许走服务端环境或受控凭据边界。
- 未新增大而全 Agent 框架，仅补齐既有 BookRun 与 Assistant mapper 的门禁和测试。

### 5. 本地验证

- `uv run pytest tests/test_book_runs.py -q`：19 passed，1 warning。
- `pnpm --filter @storyforge/web test -- settings-page assistant-tool-node-mapper`：14 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- 子代理前端核查额外运行 `pnpm --filter @storyforge/web test`：203 passed。

### 6. 剩余风险

- settings 页已补充专属本地浏览器交互验证，验证 localStorage 仅保存 Provider Base URL、`/api/provider-models` 请求体不含密钥类字段，且创作偏好与 Provider 设置分离；本验证只访问本地 Next 页面，不运行真实外部 LLM。
- 多预算同时触顶时只展示第一个原因，当前优先级为 token > time > chapter。
- 真实外部 LLM 10 章或 3-5 万字短篇仍未完成，不能宣称总计划完成；连续会话浏览器验证与 settings 专属浏览器交互验证均已按独立本地证据记录。

## 编码前检查 - P2 前端规模意图与 Blueprint 元数据

时间：2026-06-03 01:26:21 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-p2-frontend-scale-intent.md`

□ 将使用以下可复用组件：

- `parseAssistantIntent`: `apps/web/components/home/assistant-intent.ts` - 解析 10 章、3-5 万字、分卷和批次。
- `createBlueprintRequest`: `apps/web/app/blueprints/api.tsx` - 将 AssistantIntent 写入 Blueprint payload 和 metadata。
- `createBlueprintWorkflowAction`: `apps/web/app/blueprints/api.tsx` - 从 `FormData.intent` 消费自然语言目标。
- `BlueprintWorkspacePanel`: `apps/web/app/blueprints/BlueprintWorkspacePanel.tsx` - 把 URL intent 透传到创建 Blueprint 表单。

□ 将遵循命名约定：intent 类型字段为 camelCase，API payload/metadata 为 snake_case。

□ 将遵循代码风格：`node:test`、依赖注入测试 Server Action、React hidden input 传参。

□ 确认不重复造轮子，证明：已检查 `assistant-intent.ts`、`api.tsx`、`BlueprintWorkspacePanel.tsx`、`assistant-intent.test.ts`、`blueprints.test.tsx`；解析和 Server Action 已存在，缺口是 UI 表单未透传 intent。

## 编码后声明 - P2 前端规模意图与 Blueprint 元数据

时间：2026-06-03 01:26:21 +08:00

### 1. 复用了以下既有组件

- `parseAssistantIntent()`：继续使用确定性规则解析 10 章、3-5 万字、2 卷、前 3 章批次。
- `createBlueprintRequest()`：继续生成非固定三章 Blueprint 请求，并写入 `metadata.batch_chapter_count` 与 `metadata.volume_count`。
- `createBlueprintWorkflowAction()`：继续从 `FormData.intent` 解析 AssistantIntent。
- `BlueprintWorkspacePanel`：复用 hidden input 传参模式，新增 `intent` 透传。

### 2. 遵循了以下项目约定

- 命名约定：未改变公开字段命名；新增局部变量 `intent` 与 searchParams 字段一致。
- 代码风格：测试继续用 `node:test`；Server Action 测试通过依赖注入断言 POST payload。
- 文件组织：改动限制在前端 intent、Blueprint API/容器和对应测试。

### 3. 对比了以下相似实现

- `blueprint_action` / `book_id` hidden input：本次新增 `intent` 使用同一传参模式。
- `HomeComposer` URL intent：本次补上从 URL 到表单的最后一段。
- `createBlueprintRequest` 既有 batch metadata：本次补测 volume metadata，不重写 helper。

### 4. 未重复造轮子的证明

- 未新增状态管理、未新增 API、未新增 LLM 意图解析。
- 未改后端 Blueprint schema；现有 `metadata` 已足够承载分卷和批次。

### 5. TDD 与本地验证

- 红灯：`pnpm --filter @storyforge/web test -- assistant-intent blueprints` 首次失败 1 项，失败点为 `BlueprintWorkspacePanel` 未读取 `searchParams?.intent`。
- 绿灯：`pnpm --filter @storyforge/web test -- assistant-intent blueprints`：13 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `pnpm exec prettier --check` 触及文件：通过。
- `git diff --check` 触及文件：通过。
- 敏感信息扫描：触及文件未命中真实用户 key 或 key 前缀。

### 6. 剩余风险

- `3-5 万字` 当前写入目标上限 `50000`，尚未保存下限和范围语义。
- 真实 deterministic 10 章产物证据、长篇上下文门禁和真实 LLM 长程门禁仍在后续 P2 子任务中。

## 编码前检查 - P2 API 恢复 dispatch 契约

时间：2026-06-03 01:31:11 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-p2-api-dispatch-resume-retry.md`

□ 将使用以下可复用组件：

- `apply_book_run_progress`: `apps/api/app/domains/book_runs/service.py` - 回填 completed_chapters 并派生 checkpoint。
- `resume_book_run`: `apps/api/app/domains/book_runs/service.py` - 从最新 checkpoint 下一章恢复。
- `retry_book_run_from_checkpoint`: `apps/api/app/domains/book_runs/service.py` - 从 checkpoint 设置 retry 起点。
- `build_book_run_workflow_dispatch`: `apps/api/app/domains/book_runs/service.py` - 生成 worker dispatch payload。

□ 将遵循命名约定：pytest 测试名使用 `test_workflow_dispatch_after_*`，业务字段保持 snake_case。

□ 将遵循代码风格：service 级契约测试、中文 docstring、plain assert。

□ 确认不重复造轮子，证明：已有 resume endpoint 和 dispatch payload 测试，本轮只补两者之间的契约缺口。

## 编码后声明 - P2 API 恢复 dispatch 契约

时间：2026-06-03 01:31:11 +08:00

### 1. 复用了以下既有组件

- `seed_dispatchable_book_run()`：构造有章节计划的 running BookRun。
- `apply_book_run_progress()`：生成 checkpoint。
- `resume_book_run()` / `retry_book_run_from_checkpoint()`：执行恢复与重试状态转换。
- `build_book_run_workflow_dispatch()`：验证最终 worker payload。

### 2. 遵循了以下项目约定

- 命名约定：新增测试保持 `test_workflow_dispatch_after_*` 风格。
- 代码风格：只在 service 中调整起点选择与旧字段清理，不新增路由、schema 或外部依赖。
- 文件组织：API 层测试在 `test_book_run_workflow_dispatch.py`，实现修复在 `book_runs/service.py`。

### 3. 对比了以下相似实现

- 已有 volume_plan dispatch 测试只覆盖初始 running，本轮扩展到 resume/retry 后 dispatch。
- 已有 `test_resume_book_run_continues_after_latest_checkpoint` 只覆盖 endpoint 状态，本轮验证 worker payload。
- `retry_book_run_from_checkpoint()` 已设置 `retry_from_chapter_index`，本轮修复 dispatch 未优先使用该字段的问题。

### 4. 未重复造轮子的证明

- 未新增恢复状态模型；继续使用 progress 中的 `resume_from_chapter_index` 与 `retry_from_chapter_index`。
- 未新增 workflow 调度入口；继续复用 `/workflow-dispatch` 的 payload 契约。

### 5. TDD 与本地验证

- 红灯：`uv run pytest tests/test_book_run_workflow_dispatch.py -q` 首次失败 1 项，`retry` 后 dispatch 被陈旧 `resume_from_chapter_index=2` 带回第 2 章。
- 修复：`retry_book_run_from_checkpoint()` 清理旧 `resume_from_chapter_index`；`_dispatch_start_chapter_index()` 优先读取 `retry_from_chapter_index`。
- 绿灯：`uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_book_runs.py tests/test_book_run_resume.py -q`：28 passed，1 warning。
- `uv run ruff check app/domains/book_runs/service.py tests/test_book_run_workflow_dispatch.py`：通过。

### 6. 剩余风险

- Workflow 层 existing_checkpoint 的预算延续和历史 completed_chapters 保真仍由并行 worker 处理。
- OpenAPI/shared 类型同步仍需后续任务验证。

## 编码后声明 - OpenAPI 与共享类型契约同步验证

时间：2026-06-03 01:35:55 +08:00

### 1. 复用了以下既有组件

- `scripts/generate-openapi.mjs`: 重新生成 `packages/shared/src/contracts/storyforge.openapi.json`。
- `openapi-typescript`: 重新生成 `packages/shared/src/generated/api-types.ts`。
- `apps/api/tests/test_book_runs.py`: 既有 OpenAPI schema 断言覆盖 `BookRunVolumeProgress` 引用。

### 2. 遵循了以下项目约定

- 未手写 OpenAPI 或 generated types，统一使用项目脚本生成。
- 未读取 `.env`，未写入凭据。
- 契约验证仅覆盖 BookRunWorkflowDispatch、BookRunVolumeProgress、BookRunProgressUpdate 相关字段。

### 3. 本地验证

- `pnpm openapi`：通过，已生成 OpenAPI 契约。
- `pnpm --filter @storyforge/shared generate:types`：通过，已生成 API types。
- `rg "BookRunVolumeProgress|volume_progress|volume_plan|BookRunWorkflowDispatch"`：确认 OpenAPI、generated types 和 API 测试均存在相关字段。
- `pnpm --filter @storyforge/shared test`：通过。
- `pnpm exec prettier --check` 触及契约、类型和本轮文档：通过。
- `git diff --check` 触及契约、类型和本轮文档：通过。
- 敏感信息扫描：触及文件未命中真实用户 key 或 key 前缀。

### 4. 剩余风险

- generated contract 当前仍处于大工作树改动中，最终合并前需要统一跑 `pnpm verify` 或等价全量门禁。
- 真实 LLM 长程验收仍未完成，OpenAPI 同步不能替代真实运行证据。
## 编码前检查 - Workflow 恢复预算与历史 completed_chapters

时间：2026-06-03 01:30:27 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-workflow-resume-budget.md`
□ 将使用以下可复用组件：

- `BookLoopRequest` / `run_book_loop`: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py` - 验证恢复与预算累计。
- `BookRunAdapterRequest` / `run_book_run_with_skill_runner`: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py` - 验证 adapter 恢复 payload。
- `run_book_run_dispatch_payload` / `CapturingProgressSink`: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py` - 验证 dispatch payload 到 progress sink 的语义。

□ 将遵循命名约定：pytest `test_` 蛇形命名，测试替身使用局部函数或 `_passing_ports` 风格。
□ 将遵循代码风格：Python 3.11，普通 `assert`，中文测试 docstring，不新增依赖。
□ 确认不重复造轮子，证明：检查了 `book_loop.py`、`book_run_adapter.py`、`test_book_loop_resume.py`、`test_book_loop_three_chapters.py`、`test_skill_audit_summary.py`，现有测试缺少 existing_checkpoint 携带预算和 skill_runs 的恢复断言。

## 编码后声明 - Workflow 恢复预算与历史 completed_chapters

时间：2026-06-03 01:34:00 +08:00

### 1. 复用了以下既有组件

- `run_book_loop`: 用于验证 existing_checkpoint 恢复预算累计和 checkpoint 输出语义，位于 `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`。
- `run_book_run_with_skill_runner`: 用于验证 adapter 恢复时 progress sink 仍保留历史章节，位于 `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`。
- `run_book_run_dispatch_payload`: 用于验证 dispatch payload 到 workflow request 的映射，位于 `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`。

### 2. 遵循了以下项目约定

- 命名约定：新增测试函数均使用 `test_` 蛇形命名，语义聚焦 resume、budget、historical skill_runs。
- 代码风格：继续使用 pytest 普通 `assert`，测试 docstring 使用简体中文。
- 文件组织：仅修改 workflow 层允许文件，未读取 `.env`，未触碰 `apps/api` 或 `apps/web`。

### 3. 对比了以下相似实现

- `test_book_loop_resume.py`: 沿用局部 `run_chapter` 与 `seen` 断言恢复跳章；新增预算与 skill_runs 断言。
- `test_book_run_adapter.py`: 沿用 `CapturingProgressSink` 与 `_passing_ports`；新增历史 completed_chapters 的 sink 断言。
- `test_book_run_dispatch_payload.py`: 沿用 `_dispatch_payload` 工厂；扩展 `existing_checkpoint` 参数以覆盖恢复输入。

### 4. 未重复造轮子的证明

- 检查了 `book_loop.py`、`book_run_adapter.py`、`test_book_loop_three_chapters.py`、`test_skill_audit_summary.py`，确认现有逻辑已有预算累计函数和 skill_runs 审计投影，不需要新增抽象。
- 修正仅扩展 `_checkpoint_entry` 字段，使现有 `_initial_budget` 和历史 completed_chapters 语义获得可恢复输入。

### 5. RED/GREEN 记录

- RED：`uv run pytest tests/test_book_loop_resume.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q`，结果 1 failed、12 passed；失败为 `KeyError: 'token_usage'`，证明新 checkpoint 条目丢预算字段。
- GREEN：扩展 `_checkpoint_entry` 保留 `status`、预算三字段与 `skill_runs`，同一命令结果 13 passed。
## P2 长篇上下文 readiness gate - 编码前检查

时间：2026-06-03 02:10:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-p2-longform-readiness-gate.md`

□ 将使用以下可复用组件：

- `BookRunBlockedError`: `apps/api/app/domains/book_runs/service.py` - dispatch 前置条件阻断。
- `list_memory_atoms` / `get_active_memory_atoms`: `apps/api/app/domains/story_memory/service.py` - 读取 Story Memory active fact。
- `list_character_bible_entries`: `apps/api/app/domains/character_bible/service.py` - 读取 synced Character Bible。
- `list_timeline_events`: `apps/api/app/domains/timeline/service.py` - 读取 TimelineEvent 证据。
- `apply_foreshadow_lifecycle_transition` / `list_foreshadow_lifecycle`: `apps/api/app/domains/story_memory/service.py` - 写入并读取伏笔生命周期证据。

□ 将遵循命名约定：Python snake_case；测试函数 `test_` 前缀；领域私有 helper 使用 `_` 前缀。

□ 将遵循代码风格：service 层抛领域错误，测试直接断言错误消息；不新增外部依赖。

□ 确认不重复造轮子，证明：已检查 BookRun dispatch、Story Memory、Character Bible、Timeline、Foreshadow lifecycle 现有实现；缺口是尚未在长篇/分卷 dispatch 前统一执行 readiness gate。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`，本地检索和读取使用 PowerShell 与 `rg` 作为替代。

## P2 长篇上下文 readiness gate - 实现与验证

时间：2026-06-03 02:28:00 +08:00

### 红灯验证

- 命令：`cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_workflow_dispatch.py -q -k "longform or single_volume"`
- 结果：1 failed, 3 passed, 7 deselected。
- 失败原因：`test_longform_volume_dispatch_requires_context_readiness` 未抛出 `BookRunBlockedError`，证明分卷 BookRun 仍可在缺少长篇上下文时生成 dispatch。

### 实现内容

- 修改 `apps/api/app/domains/book_runs/service.py`：
  - 在 `build_book_run_workflow_dispatch()` 中生成 `volume_plan` 后执行 `_require_longform_context_ready()`。
  - 新增 `_requires_longform_context()`，仅对 `longform_context_required`、多卷 `volume_plan` 或明确长篇/分卷模式启用门禁。
  - 新增 `_longform_context_missing_items()`，检查 Story Memory、Character Bible、Timeline、Foreshadow 四类 readiness 证据。
  - 复用 `list_memory_atoms()`、`list_character_bible_entries()`、`list_timeline_events()`，未新增外部依赖。
- 修改 `apps/api/tests/test_book_run_workflow_dispatch.py`：
  - 新增分卷缺上下文时阻断 dispatch 的测试。
  - 新增补齐 Story Memory、Character Bible、Timeline、Foreshadow 后 dispatch 通过的测试。
  - 新增普通单卷短篇不触发长篇门禁的回归测试。
  - 既有分卷计划测试补齐上下文造数，避免继续验证裸分卷 dispatch。

### 编码后声明

1. 复用了以下既有组件：

- `BookRunBlockedError`：用于 dispatch 前置条件阻断。
- `list_memory_atoms()`：用于 Story Memory 和 Foreshadow lifecycle 存在性证据读取。
- `list_character_bible_entries()`：用于 Character Bible synced 条目读取。
- `list_timeline_events()`：用于 TimelineEvent readiness 读取。
- `create_memory_atom()`、`create_character_bible_entry()`、`create_timeline_event()`、`apply_foreshadow_lifecycle_transition()`：用于测试造数。

2. 遵循了以下项目约定：

- service 层执行领域门禁并抛领域错误，router 保持异常映射。
- Python 使用 snake_case 私有 helper，测试使用中文 docstring 描述行为。
- 不新增外部依赖，不读取 `.env`，不写入或复述真实 API Key。

3. 对比了以下相似实现：

- `build_book_run_workflow_dispatch()` 既有章节计划缺失阻断：本轮沿用同一 dispatch 前置边界。
- Story Memory guard：本轮只复用事实源做 readiness，不扩大为完整文本冲突检测。
- Character Bible 同步 Story Memory：本轮直接读取 synced 条目，不重写同步逻辑。

4. 未重复造轮子的证明：

- 已检查 Story Memory、Character Bible、Timeline、Foreshadow lifecycle、Scene Packet 和 BookRun dispatch；当前缺口是四类能力未统一成为分卷 dispatch 前置门禁。

### 本地验证

- `cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：32 passed。
- `cd D:\StoryForge\apps\api; uv run ruff check app/domains/book_runs/service.py tests/test_book_run_workflow_dispatch.py`：All checks passed。

### 残留风险

- 当前 readiness gate 是 dispatch 前“存在性门禁”，不等同于真实长篇跨卷质量完成。
- Timeline Guard 本轮以 `TimelineEvent` readiness 作为证据，后续仍可升级为因果/时间冲突检查。
- 真实外部 LLM 10 章或 3-5 万字短篇仍未执行，不能宣称长程稳定生产。

## P2 真实 LLM 长程验收门禁 - 文档收口

时间：2026-06-03 02:38:00 +08:00

### Shrimp 异常记录

- `split_tasks` 曾创建 `P2 长篇上下文 readiness gate 测试与实现` 与 `P2 真实 LLM 长程验收门禁文档与报告模板` 两个任务。
- 在调用 `verify_task` 时，Shrimp 返回找不到 readiness gate 任务 ID；随后 `list_tasks` 显示任务面板已被其他 4 个 Timeline/Foreshadow 补强任务覆盖。
- 处理方式：不删除或覆盖当前 Shrimp 面板；以工作树、测试输出、`.codex` 报告和主计划为权威继续推进，并在本日志记录工具异常。

### 实现内容

- 新增 `.codex/context-summary-p2-real-llm-gate.md`：
  - 明确真实 LLM 长程声明必需证据字段。
  - 明确 deterministic/mock、模拟协议测试和 1/3 章 smoke 不能支持 10 章或 3-5 万字真实长程声明。
  - 明确不读取 `.env`、不运行真实外部 LLM、不落盘密钥。
- 更新 `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`：
  - 顶部未完成清单同步 deterministic/mock 已有本地证据、readiness gate 已有 dispatch 前置门禁。
  - P2 执行步骤同步长篇上下文 readiness gate 已完成。
  - 保留真实 LLM 10 章或 3-5 万字短篇未完成状态。
- 更新 `.codex/verification-report.md`：
  - 增加真实 LLM 长程验收门禁模板。
  - 明确当前结论是“门禁模板完成，真实长程验收未满足”。

### 敏感信息处理

- 未读取 `.env`。
- 未运行真实外部 LLM。
- 未写入真实 API Key、Authorization、Bearer token、密钥前缀或可复原凭据片段。

### 本地验证

- 敏感信息扫描：扫描 `.codex`、`docs`、`apps/api/app/domains/book_runs/service.py`、`apps/api/tests/test_book_run_workflow_dispatch.py` 的常见凭据形态，未命中真实密钥、Authorization、Bearer token 或可复原凭据片段。
- `git diff --check`：通过。
- 计划旧措辞扫描：未发现 `尚未作为本计划完成证据`、`长篇上下文硬门禁.*仍未完成`、`运行 deterministic 10 章`、`运行 deterministic 3-5`、`deterministic/mock 环境能跑通`、`升级到 deterministic` 等旧状态表述。
- `cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：32 passed。
- `cd D:\StoryForge\apps\api; uv run ruff check app/domains/book_runs/service.py tests/test_book_run_workflow_dispatch.py`：All checks passed。

### 当前结论

- P2 deterministic/mock 10 章与 3-5 万字基础证据、分卷恢复/预算/OpenAPI 契约、长篇 readiness gate 已完成并留痕。
- 真实 LLM 10 章或 3-5 万字长程验收仍未完成，缺真实长程产物、审计报告、成本统计、质量风险汇总和人工通读结论；不得宣称总计划完成。

## Assistant 连续会话上下文保留 - 编码前检查

时间：2026-06-03 03:16:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-continuous-session.md`

□ 将使用以下可复用组件：

- `HomeComposer`: `apps/web/components/home/HomeComposer.tsx` - 复用当前 `useSearchParams()` + `URLSearchParams` 白名单复制模式。
- `AssistantConversation`: `apps/web/components/home/AssistantConversation.tsx` - 确认 URL 中的 `target_chapter_ordinal` 已被读取并传递给操作条。
- `AssistantActionBar`: `apps/web/components/home/AssistantActionBar.tsx` - 确认章节审阅表单已携带 `assistant_session_id` 与 `target_chapter_ordinal`。
- `mapAssistantSessionToHomeRecentItem`: `apps/web/components/home/assistant-session-store.ts` - 确认最近记录 href 已携带 `artifact_id`。

□ 将遵循命名约定：TypeScript 代码使用 camelCase；URL/query/FormData 字段继续使用既有 snake_case，例如 `target_chapter_ordinal`、`artifact_id`。

□ 将遵循代码风格：源码契约测试继续使用 `node:test`、`node:assert/strict` 和中文断言说明；组件只扩展既有字符串白名单，不新增抽象。

□ 确认不重复造轮子，证明：已检查 `HomeComposer.tsx`、`assistant-session-store.ts`、`assistant-chapter-review-actions.ts`、`assistant-artifact-export-actions.ts`、`assistant-book-run-actions.ts` 与 `home-page.test.tsx`；缺口不是缺少 helper，而是 `HomeComposer` 现有白名单少了两个业务上下文 key。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`，本地检索和读取使用 PowerShell 与 `rg` 替代；源线程状态为 idle，没有正在运行的子代理句柄可释放。

## Assistant 连续会话上下文保留 - 编码前检查补充

时间：2026-06-03 03:25:00 +08:00

### 现状更正

- 重新核对当前工作树后确认：`apps/web/components/home/HomeComposer.tsx` 的客户端 `router.push()` 白名单已经包含 `target_chapter_ordinal` 和 `artifact_id`。
- `apps/web/tests/home-page.test.tsx` 已有上述两个字段的源码级断言。
- 因此本轮不重复补已存在的客户端白名单缺口，转为补齐同一输入框的原生 GET 降级上下文保留：`HomeComposer` 需要从 `AssistantConversation` 接收初始 `searchParams`，并把已有上下文字段渲染为 hidden input。

### 编码前检查

□ 已查阅并更新上下文摘要文件：`.codex/context-summary-assistant-continuous-session.md`

□ 将使用以下可复用组件：

- `HomeComposer`: `apps/web/components/home/HomeComposer.tsx` - 复用当前 `useSearchParams()` + `URLSearchParams` 白名单复制模式。
- `AssistantConversation`: `apps/web/components/home/AssistantConversation.tsx` - 复用服务端 `searchParams` 入参，向 `HomeComposer` 透传初始上下文。
- `AssistantActionBar`: `apps/web/components/home/AssistantActionBar.tsx` - 复用 hidden input 透传上下文的表单降级模式。
- `HomeSearchParams`: `apps/web/components/home/home-view.ts` - 复用首页 searchParams 类型契约。

□ 将遵循命名约定：TypeScript props 使用 camelCase，例如 `initialSearchParams`；URL/FormData 字段继续使用 snake_case，例如 `assistant_session_id`、`target_chapter_ordinal`、`artifact_id`。

□ 将遵循代码风格：源码契约测试继续使用 `node:test`、`node:assert/strict` 和中文断言说明；组件使用小型 `const` 白名单复用，不新增外部依赖。

□ 确认不重复造轮子，证明：已检查 `HomeComposer.tsx`、`AssistantConversation.tsx`、`AssistantActionBar.tsx`、`assistant-session-store.ts`、`assistant-chapter-review-actions.ts` 与 `home-page.test.tsx`；缺口是同一上下文参数列表未覆盖 GET 降级路径。

### 外部资料记录

- Context7 `/vercel/next.js`：确认 `useSearchParams()` 用于 Client Component 读取查询串，page `searchParams` prop 用于 Server Component 读取查询，`URLSearchParams` 合并后导航是官方推荐模式之一。
- GitHub `search_code`：查询 `useSearchParams URLSearchParams router.push preserve query params language:TypeScript`，作为通用参考；最终不引入外部实现。
- 工具缺失：当前会话未暴露 `desktop-commander`，已用 PowerShell 与 `rg` 替代并留痕。

## Assistant 连续会话上下文保留 - TDD 与验证

时间：2026-06-03 03:35:00 +08:00

### 红灯验证

- 测试改动：`apps/web/tests/home-page.test.tsx` 新增 GET 降级上下文保留契约，要求 `AssistantConversation` 向 `HomeComposer` 传入 `initialSearchParams`，并要求 `HomeComposer` 使用统一参数白名单渲染 hidden input。
- 命令：`pnpm --filter @storyforge/web test -- home-page`
- 结果：12 passed, 1 failed。
- 失败原因：`Assistant 对话层应把服务端 searchParams 传给输入框以支持 GET 降级保留上下文`，符合预期红灯，不是语法错误。

### 实现内容

- 修改 `apps/web/components/home/HomeComposer.tsx`：
  - 新增 `preservedContextQueryKeys`，包含 `book_id`、`assistant_session_id`、`book_run_id`、`scene_packet_id`、`repair_patch_id`、`target_chapter_ordinal`、`artifact_id`。
  - 客户端 `router.push()` 和 GET 降级 hidden input 共用同一白名单。
  - 新增 `initialSearchParams` props，仅对已有非空上下文字段渲染 hidden input。
- 修改 `apps/web/components/home/AssistantConversation.tsx`：
  - 将服务端 `searchParams` 传给 `<HomeComposer initialSearchParams={searchParams} />`。
- 修改 `apps/web/tests/home-page.test.tsx`：
  - 增加源码契约断言，覆盖 GET 降级路径。

### 编码后声明

1. 复用了以下既有组件：

- `HomeComposer`: 沿用 `useSearchParams()` + `URLSearchParams` 的客户端 query 保留模式。
- `AssistantConversation`: 复用服务端 `searchParams` 入口向输入框透传上下文。
- `AssistantActionBar`: 复用 hidden input 传递上下文的表单降级模式。
- `HomeSearchParams`: 复用首页 query 类型契约。

2. 遵循了以下项目约定：

- TypeScript props 使用 camelCase；URL/FormData 字段继续使用 snake_case。
- 测试沿用 `node:test`、`node:assert/strict` 和中文断言说明。
- 不新增外部依赖，不读取 `.env`，不运行真实外部 LLM。

3. 对比了以下相似实现：

- `HomeComposer` 客户端提交白名单：本轮抽为常量并复用到 GET 降级。
- `AssistantActionBar` hidden input：本轮沿用同类表单上下文透传方式。
- `assistant-session-store` 最近记录 href：本轮保持 `artifact_id` 从最近记录到继续输入链路可追溯。
- `assistant-chapter-review-actions` redirect 参数回流：本轮保持 `target_chapter_ordinal` 可连续审阅。

4. 未重复造轮子的证明：

- 已检查 `HomeComposer.tsx`、`AssistantConversation.tsx`、`AssistantActionBar.tsx`、`assistant-session-store.ts`、`assistant-chapter-review-actions.ts`、`assistant-artifact-export-actions.ts`、`assistant-book-run-actions.ts` 和 `home-page.test.tsx`；缺口是现有参数保留模式未覆盖 GET 降级，不需要新增公共 helper 或外部库。

### 本地验证

- `pnpm --filter @storyforge/web test -- home-page`：13 passed。
- `pnpm --filter @storyforge/web test -- assistant-session-store assistant-chapter-review-actions assistant-artifact-export-actions assistant-book-run-actions`：26 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。
- 敏感信息扫描：触及文件严格凭据形态扫描 0 命中。

### 敏感信息处理

- 未读取 `.env`。
- 未运行真实外部 LLM。
- 用户在本轮后续消息中提供了新的 provider 信息；本阶段未复述、未落盘、未使用该信息。
- 未写入真实凭据、认证头、密钥前缀或可复原凭据片段。

### 当前结论

- 连续会话参数保留已补齐到客户端提交和 GET 降级源码契约层面。
- 连续会话真实浏览器点击/刷新恢复已由后续 `verify:browser-session` 独立验证记录覆盖；该参数保留小节仍仅代表源码契约与 GET 降级实现。

## settings 页浏览器交互验证 - 编码前检查

时间：2026-06-03 04:18:00 +08:00

□ 已查阅并生成上下文摘要文件：`.codex/context-summary-settings-browser-interaction.md`

□ 将使用以下可复用组件：

- `apps/web/scripts/verify-continuous-session-browser.mjs`: 复用 Next dev 自启、探活、Playwright Chromium 生命周期和进程树清理模式。
- `apps/web/tests/settings-page.test.ts`: 复用 settings 页 `node:test` 源码契约入口。
- `apps/web/app/settings/ProviderSettingsPanel.tsx`: 复用 `Provider Base URL`、`storyforge-provider-settings`、保存按钮和 `/api/provider-models` 检测行为。
- `apps/web/app/settings/CreativePreferencesPanel.tsx`: 复用 `storyforge-creative-preferences`、创作偏好表单字段和保存行为。

□ 将遵循命名约定：Node 脚本函数和变量使用 camelCase；localStorage 和 API body 字段沿用既有 `baseUrl`、`genres`、`style`、`assistantBehavior`、`defaultFlow`。

□ 将遵循代码风格：新增 `.mjs` ESM 脚本，中文错误摘要，失败设置非零退出码；测试继续使用 `node:test`、`node:assert/strict` 和中文断言说明。

□ 确认不重复造轮子，证明：已检查 `verify-continuous-session-browser.mjs`、`settings-page.test.ts`、`ProviderSettingsPanel.tsx`、`CreativePreferencesPanel.tsx`、`apps/web/package.json`；当前缺口是缺少 settings 专属真实浏览器交互验证入口，不需要引入 `@playwright/test` 配置或新框架。

### 外部资料记录

- Context7 `/microsoft/playwright`：确认 `page.route()` 可拦截 API 请求，`request.postDataJSON()` 可读取 POST body，`route.fulfill({ json })` 可返回 mock JSON。
- GitHub `search_code`：查询 `playwright page.route request.postDataJSON localStorage evaluate language:JavaScript`，作为通用参考；最终实现沿用本仓库脚本式验证模式。
- 工具缺失：当前会话未暴露 `desktop-commander`，已用 PowerShell、`rg`、Context7、GitHub search 和 Playwright Node 脚本替代。

### 敏感信息边界

- 不读取 `.env`。
- 不运行真实外部 LLM。
- 不使用、复述或落盘用户提供的 provider 信息。
- 验证脚本使用非真实示例 Base URL，并通过 route mock 阻断真实 Provider 请求。

## settings 页浏览器交互验证 - TDD、调试与验证

时间：2026-06-03 04:28:00 +08:00

### 红灯验证

- 新增源码契约测试：`apps/web/tests/settings-page.test.ts` 要求存在 `apps/web/scripts/verify-settings-browser.mjs`，并要求 `apps/web/package.json` 暴露 `verify:settings-browser`。
- 命令：`pnpm --filter @storyforge/web test -- settings-page`
- 结果：5 passed, 1 failed。
- 失败原因：缺少 settings 专属 Playwright 浏览器验证脚本，符合预期红灯。

### 实现内容

- 新增 `apps/web/scripts/verify-settings-browser.mjs`：
  - 复用 Next dev 自启、探活和进程树清理模式。
  - 使用 Playwright Chromium 打开本地 `/settings`。
  - 填写 Provider Base URL 并保存，断言 `storyforge-provider-settings` 字段严格等于 `baseUrl`。
  - 拦截 `/api/provider-models`，断言请求方法为 POST，请求体字段严格等于 `baseUrl`，且不包含密钥类字段。
  - mock 返回模型列表，断言检测结果与模型列表在页面中渲染。
  - 填写创作偏好并保存，断言 `storyforge-creative-preferences` 字段严格等于 `genres`、`style`、`assistantBehavior`、`defaultFlow`，且与 Provider 设置分离。
- 修改 `apps/web/package.json`：
  - 新增 `verify:settings-browser`，指向 `node scripts/verify-settings-browser.mjs`。
- 修改 `apps/web/tests/settings-page.test.ts`：
  - 增加浏览器验证脚本和 package script 的源码契约断言。

### 调试记录

- 首次运行 `pnpm --filter @storyforge/web verify:settings-browser` 失败于等待 Provider localStorage 写入。
- 根因调查：页面输入框可见时 React hydration 可能尚未完成，过早点击保存按钮会丢失事件。
- 修正：保存 Provider 设置时使用条件式重试，循环填入、点击 Provider section 内保存按钮，并检查 localStorage 已写入预期 `baseUrl`；不使用固定延迟作为通过条件。

### 本地验证

- `pnpm --filter @storyforge/web verify:settings-browser`：通过。
- `pnpm --filter @storyforge/web test -- settings-page`：6 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。
- 敏感信息扫描：触及文件严格凭据形态扫描 0 命中。

### 子代理只读审查

- Hubble：建议使用可访问名称定位、严格断言 localStorage/API body keys、拦截 API 前置注册、等待结果文本、结束时断言页面错误为空；主线已采纳字段严格断言、路由 mock、结果文本等待和页面错误断言。
- Dalton：确认主计划、操作日志和验证报告中 settings 浏览器交互验证待更新位置；主线已同步更新测试矩阵、最终验收、P1 限制说明和 `.codex` 审计记录。

### shrimp-task-manager 状态

- 本轮已按 `plan_task`、`analyze_task`、`reflect_task`、`split_tasks` 完成规划；随后发现 shrimp 仪表盘只保留了“只读审查 settings Playwright 验证策略”任务，先前拆分出的四个本阶段任务 ID 查询失败，判断为面板状态被覆盖或未持久化。
- 已按 shrimp 状态机执行并验证保留的只读审查任务；本地代码、测试和文档交付不依赖该面板状态。

### 敏感信息处理

- 未读取 `.env`。
- 未运行真实外部 LLM。
- 未使用、复述或落盘用户提供的 provider 信息。
- 未写入真实凭据、认证头、密钥前缀或可复原凭据片段。

### 当前结论

- settings 页已补齐本地浏览器交互验证，覆盖 Provider Base URL localStorage 保存、模型检测 POST body 安全边界、模型列表渲染和创作偏好独立保存。
- 该结论不代表真实外部 LLM 10 章或 3-5 万字长程验收完成；真实长程仍需产物、审计报告、成本、质量风险和人工通读证据。

## P0 首页真实最近记录核验 - 编码前检查

时间：2026-06-03 05:05:00 +08:00

□ 已查阅并生成上下文摘要文件：`.codex/context-summary-assistant-recent-sessions.md`

□ 将使用以下可复用组件：

- `apps/web/app/page.tsx`: 首页 Server Component 读取最近 Assistant 会话并传入 `HomeShell`。
- `apps/web/components/home/assistant-session-store.ts`: 复用 `readRecentAssistantSessions()` 和 `mapAssistantSessionToHomeRecentItem()`。
- `apps/web/lib/api-client.ts`: 复用 `readJson()`、`apiFetch()`、`cache: 'no-store'` 和受控 API header 边界。
- `apps/web/components/home/HomeSidebar.tsx`: 复用 `recentItems` props 和 `homeRecentEmpty` 空状态。
- `apps/api/app/domains/assistant/router.py`: 复用 `GET /api/assistant/sessions` 最近列表 API。

□ 将遵循命名约定：前端使用 camelCase；API JSON 字段沿用 snake_case；可读文本使用简体中文。

□ 将遵循代码风格：本阶段不新增业务代码，验证沿用 `node:test`、pytest 和现有 `.codex` 留痕格式。

□ 确认不重复造轮子，证明：已检查 `page.tsx`、`HomeShell.tsx`、`HomeSidebar.tsx`、`home-data.ts`、`assistant-session-store.ts`、`api-client.ts`、Assistant API router/service/schema 和相关测试；当前代码已实现 P0 最近列表展示链路，本阶段只做证据核验和计划回填。

### 子代理只读审查

- Gibbs：确认 `GET /api/assistant/sessions` 契约、响应字段、排序和现有 API 测试；指出没有详情 GET、列表返回完整 messages、limit 边界和多会话排序仍可后续补测。
- Franklin：确认前端数据流为 `HomePage -> HomeShell -> HomeSidebar`，helper 复用 `api-client`；指出 API 失败静默空状态、重复标题作为 key、summary 普通用户不可见和可选字段校验不够严格等后续风险。

### 敏感信息边界

- 未读取 `.env`。
- 未运行真实外部 LLM。
- 未使用、复述或落盘用户提供的 provider 信息。
- 仅核验当前代码和本地测试，不输出任何凭据。

## P0 首页真实最近记录核验 - 验证与回填

时间：2026-06-03 05:12:00 +08:00

### 当前实现证据

- `apps/web/app/page.tsx` 已调用 `readRecentAssistantSessions()`，ready 时将真实最近会话映射结果传给 `HomeShell`，失败时回退空数组，不伪造历史。
- `apps/web/components/home/assistant-session-store.ts` 已通过统一 `readJson<readonly AssistantSessionRead[]>('/api/assistant/sessions', { params: { limit } })` 读取 Assistant sessions API。
- `mapAssistantSessionToHomeRecentItem()` 已把 `id` 映射为 `assistant_session_id` href，并保留 `book_run_id`、`artifact_id`、`blueprint_id` 追溯参数。
- `HomeSidebar` 有 `recentItems` 时渲染链接，无数据时展示 `homeRecentEmpty`。
- API `GET /api/assistant/sessions` 已按更新时间和 id 倒序读取最近会话，并通过 schema 拒收敏感额外字段。

### 本地验证

- `pnpm --filter @storyforge/web test -- home-page assistant-session-store`：20 passed。
- `cd apps/api; uv run pytest tests/test_assistant_sessions.py -q`：2 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。

### 当前结论

- P0“接通真实最近记录”最近列表展示链路已由当前代码和定向测试证明完成。
- 限制：最近记录点击当前只通过 query 恢复 Assistant 上下文；没有详情 GET，也没有按 `assistant_session_id` 拉取完整历史消息恢复对话，不能把该缺口宣称为已完成。
- 该结论不代表总计划完成，也不代表真实外部 LLM 长程验收完成。

## Assistant 连续会话浏览器验证 - 编码前检查

时间：2026-06-03 02:46:00 +08:00

□ 已查阅并生成上下文摘要文件：`.codex/context-summary-assistant-browser-session.md`

□ 将使用以下可复用组件：

- `apps/web/scripts/verify-legacy-redirects-http.mjs`: 复用 Next dev 自启、探活和进程树清理模式。
- `apps/web/scripts/verify-bookrun-eventsource-reconnect.mjs`: 复用独立 Node smoke 脚本和中文失败输出风格。
- `apps/web/components/home/HomeComposer.tsx`: 复用真实 aria-label 控件和上下文参数白名单。
- `apps/web/components/home/AssistantConversation.tsx`: 复用服务端 `searchParams` 到 `HomeComposer` 的透传。
- `apps/web/package.json`: 复用 `verify:*` 脚本入口命名。

□ 将遵循命名约定：Node 脚本函数和变量使用 camelCase；URL/query 字段继续使用 snake_case。

□ 将遵循代码风格：新增 `.mjs` ESM 脚本，中文错误摘要，失败设置非零退出码；不新增 `@playwright/test` 或配置文件。

□ 确认不重复造轮子，证明：已检查根 `package.json`、`apps/web/package.json`、`verify-legacy-redirects-http.mjs`、`verify-bookrun-eventsource-reconnect.mjs`、`HomeComposer.tsx`、`AssistantConversation.tsx`；当前缺口是缺少真实浏览器验证入口，不是缺少业务实现。

□ 工具缺失记录：当前会话未暴露 `desktop-commander` 或 Browser 点击工具；本阶段使用 PowerShell、`rg`、`apply_patch` 和 Playwright Node 脚本替代。

### 外部资料记录

- Context7 `/microsoft/playwright`：确认普通 Node 脚本可用 `chromium.launch()`，并可用 `getByLabel()`、`getByRole()` 与真实页面交互。
- GitHub `search_code`：查询 `waitForURL getByLabel chromium.launch language:JavaScript playwright`，仅作为通用参考；最终实现沿用本仓库脚本风格。

### 敏感信息边界

- 不读取 `.env`。
- 不运行真实外部 LLM。
- 不使用、复述或落盘用户提供的 provider 信息。
- 浏览器验证只访问本地 Next dev 页面并检查 URL/DOM 状态。

## Assistant 连续会话浏览器验证 - TDD、调试与验证

时间：2026-06-03 03:05:00 +08:00

### 红灯验证

- 新增源码契约测试：`apps/web/tests/home-page.test.tsx` 要求存在 `apps/web/scripts/verify-continuous-session-browser.mjs`，并要求脚本包含 Playwright Chromium、真实输入框填写、发送按钮点击、URL 等待和刷新后检查。
- 命令：`pnpm --filter @storyforge/web test -- home-page`
- 结果：13 passed, 1 failed。
- 失败原因：缺少可重复运行的连续会话浏览器验证脚本，符合预期红灯。

### 实现内容

- 新增 `apps/web/scripts/verify-continuous-session-browser.mjs`：
  - 复用 Next dev 自启、探活和进程树清理模式。
  - 使用 Playwright `chromium.launch()` 打开真实浏览器。
  - 打开带 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`artifact_id` 的首页 URL。
  - 检查 `form[action="/"]` 内 hidden input 保留上下文。
  - 填入 `审阅第二章`，点击 Composer 表单内的 submit 按钮。
  - 等待 URL 写入 `intent`，并确认上下文 query 未丢失。
  - 刷新页面后再次检查 hidden input 保留上下文。
- 修改 `apps/web/package.json`：
  - 新增 `verify:browser-session`，指向 `node scripts/verify-continuous-session-browser.mjs`。
- 修改 `apps/web/tests/home-page.test.tsx`：
  - 增加浏览器验证脚本和 package script 的源码契约断言。

### 调试记录

- 首次真实浏览器运行失败于 `waitForURL`，原因是脚本使用的等待方式不稳定。
- 第二次失败于按钮未启用；诊断显示 textarea 已有值但按钮仍 disabled，说明填入发生在 React 水合前后状态未同步。
- 第三次使用 ASCII 输入后提交成功，但 URL 进入 `view=projects`，刷新后没有 Assistant hidden input；根因是 ASCII 输入被解析为生成类任务。
- 最终修正：使用章节审阅意图 `审阅第二章`，并在填入前后循环清空再填写，等待 textarea 值和按钮启用条件成立；发送按钮定位收窄到 `form[action="/"]` 内。

### 本地验证

- `pnpm --filter @storyforge/web verify:browser-session`：通过。证据：真实浏览器自启 Next dev，提交后 URL 保留 `book_id=12`、`assistant_session_id=31`、`target_chapter_ordinal=2`、`artifact_id=88` 和 `intent=审阅第二章`，刷新后 hidden input 检查通过。
- `pnpm --filter @storyforge/web test -- home-page`：14 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。
- 敏感信息扫描：触及文件严格凭据形态扫描 0 命中。

### 子代理只读审查

- Darwin：确认脚本真实打开 Chromium、填写输入、点击发送、检查 URL 和刷新后 hidden input；指出按钮定位和诊断可收窄，主线已将按钮定位收窄到 Composer 表单内。
- Goodall：确认主计划中连续会话浏览器验证待补位置，并给出通过后应更新的措辞；主线已同步更新 Phase 5、测试矩阵、最终验收标准和 P1 限制说明。

### 敏感信息处理

- 未读取 `.env`。
- 未运行真实外部 LLM。
- 未使用、复述或落盘用户提供的 provider 信息。
- 未写入真实凭据、认证头、密钥前缀或可复原凭据片段。

### 当前结论

- 连续会话参数保留已覆盖源码契约、客户端提交、GET 降级和真实浏览器点击/刷新恢复。
- 该结论不代表真实外部 LLM 10 章或 3-5 万字长程验收完成；真实长程仍需产物、审计报告、成本、质量风险和人工通读证据。

## P0 Assistant 导出审计链路 - TDD 与验证回填

时间：2026-06-03 04:23:04 +08:00

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-artifact-export-p0.md`

□ 将使用以下可复用组件：

- `apps/web/components/home/assistant-intent.ts`: 复用 `artifact_export` 意图解析和 `requestedArtifacts` 契约。
- `apps/web/components/home/assistant-artifact-export-actions.ts`: 复用 completed BookRun 门禁、三类导出 API 调用、AssistantSession 写入和 redirect 回流。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: 复用 `Artifact.export` 工具节点映射和 audit_report 证据识别。
- `apps/api/app/domains/exports/book_markdown_exporter.py`: 复用 exporter 层 completed BookRun 前置校验和 Artifact 创建能力。

□ 将遵循命名约定：前端任务类型继续使用 `artifact_export`，工具节点继续使用 `Artifact.export`，API 路径继续使用 `/api/book-runs/{id}/exports/*`。

□ 将遵循代码风格：Web 测试继续使用 `node:test` 与 `assert`；API 测试继续使用 pytest；用户可见文案使用简体中文。

□ 确认不重复造轮子：已检查 action、工具树 mapper、BookRun export helper、后端 exporter 和现有测试；本轮只补摘要字段解析、测试证据和计划回填。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、`apply_patch` 和本地测试脚本替代，并记录验证结果。

### TDD 红灯

- 修改 `apps/web/tests/assistant-artifact-export-actions.test.ts`，要求导出成功摘要和 session payload 包含制品名、`#id`、`v版本`、`BookRun #id` 和“Artifacts 下载摘要可查看”提示。
- 命令：`pnpm --filter @storyforge/web test -- assistant-artifact-export-actions`
- 结果：4 passed, 2 failed。
- 失败原因：当前 `readArtifactSummary()` 只读取 `id/name`，`formatArtifactExportSummary()` 只输出 `name#id`，符合预期红灯。

### 实现内容

- `apps/web/components/home/assistant-artifact-export-actions.ts`
  - `ExportedArtifactSummary` 扩展 `version`、`mimeType`、`bookRunId`。
  - `readArtifactSummary()` 解析响应中的 `version`、`mime_type` 和 `payload.book_run_id`，并从请求路径兜底提取 BookRun ID。
  - `formatArtifactExportSummary()` 输出制品名、id、版本、BookRun 关联和 Artifacts 下载摘要提示。
- `apps/web/tests/assistant-intent.test.ts`
  - 增加“导出这次试读的 EPUB 和审计报告”精确输入用例。
- `apps/web/tests/assistant-tool-node-mapper.test.ts`
  - 增加非 completed BookRun 的 `Artifact.export` 等待原因断言。
- `apps/api/tests/test_book_exporter.py`
  - 增加 running BookRun 调用 Markdown、EPUB、audit-report 三类导出 API 均返回 400，且 Artifact 数量不增加的测试。

### 本地验证

- `pnpm --filter @storyforge/web test -- assistant-intent assistant-artifact-export-actions assistant-tool-node-mapper`：24 passed。
- `cd apps/api; uv run pytest tests/test_book_exporter.py -q`：4 passed。
- `pnpm --filter @storyforge/web test -- assistant-intent assistant-artifact-export-actions assistant-tool-node-mapper book-runs home-page`：40 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。
- 敏感信息扫描：本阶段触及文件按高风险凭据模式扫描 0 命中；未读取 `.env`。

### 编码后声明

1. 复用了以下既有组件：
   - `submitAssistantArtifactExport()`：用于保持 completed BookRun 导出门禁和 redirect 回流。
   - `exportMarkdownRequest()`、`exportEpubRequest()`、`exportAuditReportRequest()`：用于统一三类导出 API 请求。
   - `mapBookRunToAssistantToolNodes()`：用于展示 `Artifact.export` 的等待/完成状态。
   - `export_book_run_*()`：用于后端三类导出事实源。

2. 遵循了以下项目约定：
   - 命名约定：保持 `artifact_export`、`Artifact.export`、`book_run_id`、`assistant_session_id` 等既有字段。
   - 代码风格：前端保持 TypeScript server action 和 `node:test` 风格；后端保持 pytest 与中文测试说明。
   - 文件组织：未新增框架或脚本，测试放在现有 web/api 测试文件中。

3. 对比了以下相似实现：
   - `assistant-book-run-actions.ts`：继续使用 server action 依赖注入测试模式。
   - `assistant-chapter-review-actions.ts`：沿用失败 redirect 回流和 AssistantSession 追加消息模式。
   - `book_markdown_exporter.py`：沿用 exporter 层前置门禁，不在路由层重复实现业务判断。

4. 未重复造轮子的证明：
   - 检查了 Assistant action、BookRun API helper、Artifacts 页面与后端 exporter；已有导出链路可复用，本轮只补摘要质量和 API 门禁证据。

### 当前结论

- P0“完成 Assistant 导出审计链路”已由本地代码、定向测试和文档回填证明完成。
- 限制：该结论仅覆盖本地 completed BookRun 导出审计链路，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。

## Phase 0 上下文摘要与验证基线 - 状态回填

时间：2026-06-03 04:34:37 +08:00

### 任务目标

- 对账权威计划 `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md` 的 Task 1。
- 将“记录相似实现、测试命令与基线结果、计划范围和不做事项”三项从陈旧未勾选状态回填为已完成。
- 本轮不修改业务代码，不运行真实外部 LLM，不读取 `.env`。

### 证据来源

- `.codex/context-summary-storyforge-assistant-workflow.md` 已记录 7 个相似实现、项目约定、可复用组件、测试策略、依赖集成点、技术选型、风险点、外部资料和充分性检查。
- `.codex/operations-log.md` 已存在 “StoryForge Assistant 工作流计划执行 - Phase 0” 与后续 P0/P1/P2 验证记录。
- `.codex/verification-report.md` 已记录 P0/P1/P2 子任务评分和限制说明。

### 实施内容

- 更新主计划 Task 1 三项 checklist 为 `[x]`。
- 在 Task 1 下追加 `2026-06-03 回填证据`，说明证据来自现有上下文摘要、操作日志、验证报告和计划范围维护。

### 边界声明

- 这是 Phase 0 文档状态对账，不代表总计划完成。
- 真实外部 LLM 10 章或 3-5 万字长程验收仍未完成。
- 本轮未使用、复述或落盘用户提供的 provider 信息。

## 主计划当前完成度概览 - 状态校准

时间：2026-06-03 04:44:41 +08:00

### 任务目标

- 对账权威计划第 0.2 节和后续 P0/P1/P2 完成证据之间的状态漂移。
- 修正“最近记录、章节审阅、导出审计、Provider/预算仍需继续接线”的陈旧表述。
- 保留真实外部 LLM 长程未完成、完整会话历史详情恢复未完成等限制。

### 证据来源

- P0 最近记录：主计划 P0 段落和 `.codex/verification-report.md` 已记录 `home-page assistant-session-store` 20 passed、Assistant sessions API 2 passed。
- P0 导出审计：主计划 P0 段落和验证报告已记录前端定向 40 passed、API 导出 4 passed。
- P1 章节审阅修复：主计划 P1 段落已记录自然语言章节定位、真实 `scene_packet_id` 定位、Judge/Repair 主动创建和 Studio 写回证据。
- P1 Provider/预算：主计划 P1 段落和验证报告已记录预算门禁、Provider 不可用防伪装、settings 浏览器验证证据。

### 实施内容

- 将主计划 `0.2 已部分完成但仍需继续接线` 改为 `0.2 已完成本地闭环但仍有限制`。
- 用四条当前事实替换旧接线缺口表述，并逐条保留限制。

### 边界声明

- 本轮只校准权威计划概览，不修改业务代码。
- 真实外部 LLM 10 章或 3-5 万字长程验收仍未完成。
- 未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息。

## Assistant 会话详情恢复与历史消息回填

时间：2026-06-03 05:03:38 +08:00

### 任务目标

- 补齐最近记录携带 `assistant_session_id` 跳回 Assistant 后的完整会话历史恢复。
- 保持本地验证闭环，不运行真实外部 LLM，不读取 `.env`。
- 更新权威计划、上下文摘要、操作日志和验证报告，避免把局部能力误写成总计划完成。

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-assistant-session-detail-restore.md`。

□ 将使用以下可复用组件：

- `apps/api/app/domains/assistant/service.py` 的 `get_assistant_session()`：作为会话详情读取事实源。
- `apps/api/app/domains/assistant/schemas.py` 的 `AssistantSessionRead`：作为详情端点响应契约。
- `apps/web/components/home/assistant-session-store.ts` 的 `readJson()` 使用模式：作为前端 GET helper。
- `apps/web/components/home/AssistantMessageList.tsx` 和 `AssistantConversation.tsx`：用于恢复历史消息流。

□ 将遵循命名约定：后端 URL 和 query 使用 snake_case；前端 helper 使用 camelCase；任务类型沿用 `trial_generation`、`chapter_review`、`artifact_export`。

□ 将遵循代码风格：API 测试继续使用 pytest；Web 测试继续使用 `node:test` 源码/契约断言；用户可见文案使用简体中文。

□ 确认不重复造轮子：已检查 Assistant router/service/session store/Conversation 和现有测试，后端已有详情读取 service，前端已有统一 API client，本轮只补薄层端点和恢复映射。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、`apply_patch` 和本地测试脚本替代。

### TDD 与实现内容

- 后端测试 `apps/api/tests/test_assistant_sessions.py` 已覆盖创建后按 `GET /api/assistant/sessions/{id}` 读取详情，以及缺失会话返回 404。
- 后端 `apps/api/app/domains/assistant/router.py` 已新增详情端点，复用 `get_assistant_session()`，把 `AssistantSessionNotFoundError` 转为 404。
- 前端 `apps/web/components/home/assistant-session-store.ts` 已新增 `AssistantSessionDetail`、`isAssistantSessionDetail()` 和 `readAssistantSession()`。
- 前端 `apps/web/components/home/AssistantConversation.tsx` 已在存在 `assistant_session_id` 时读取历史 messages，映射为 `AssistantMessageList` 可展示消息，并避免 URL `intent` 与历史用户消息重复展示。
- 修复 lint 暴露的类型根因：`AssistantSessionDetail` 改用 `Omit<AssistantSessionRead, 'messages'>` 后重新定义 `messages`，避免 TypeScript 把 message 推断为 `unknown`。

### 本地验证

- `pnpm --filter @storyforge/web test -- assistant-session-store home-page`：21 passed。
- `cd apps/api; uv run pytest tests/test_assistant_sessions.py -q`：3 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。
- 敏感信息扫描：本轮触及 9 个文件按高风险凭据模式扫描 0 命中；未读取 `.env`。

### 编码后声明

1. 复用了以下既有组件：
   - `get_assistant_session()`：用于后端详情读取，不重复查询逻辑。
   - `AssistantSessionRead`：用于保持列表和详情响应字段一致。
   - `readJson()`：用于前端统一 API 读取和响应校验。
   - `AssistantMessageList`：用于渲染恢复的历史消息。

2. 遵循了以下项目约定：
   - 命名约定：保持 `assistant_session_id`、`book_run_id`、`artifact_id`、`task_type` 等既有字段。
   - 代码风格：前端保持 TypeScript helper 与 `node:test`；后端保持 FastAPI router/service 分层和 pytest。
   - 文件组织：未新增框架或脚本，变更集中在 Assistant API、首页 Assistant 组件和对应测试。

3. 对比了以下相似实现：
   - `apps/api/app/domains/assistant/router.py` 既有 create/list/message 端点：详情端点沿用 router/service/schema 分层。
   - `apps/web/components/home/assistant-session-store.ts` 既有 read/create/append helper：详情 helper 沿用 `ApiResult` 和类型守卫。
   - `apps/web/components/home/AssistantConversation.tsx` 既有 searchParams 构造消息流：历史恢复接入同一消息流，不新增并行状态。

4. 未重复造轮子的证明：
   - 检查了 Assistant session service、front-end session store、Conversation、HomeShell 和最近记录入口；已有可复用基础能力，本轮只补缺失详情读取与恢复映射。

### 当前结论

- Assistant 会话详情恢复本轮局部目标已由本地测试和 lint 证明可用。
- 边界：该结论只覆盖最近记录跳回后的 Assistant 历史消息恢复，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。

## P2 人工通读门禁审计证据闭包

时间：2026-06-03 05:24:00 +08:00

### 任务目标

- 验证 `manual_read_gate` 可作为 BookRun progress 门禁字段保存，并进入 `audit_report.json`。
- 为真实 LLM 长程声明门禁补充本地可审计支撑，但不运行真实外部 LLM，不读取 `.env`。
- 更新权威计划、上下文摘要、操作日志和验证报告；真实 LLM 10 章或 3-5 万字 checkbox 保持未完成。

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-p2-real-llm-gate.md`，并新增 `.codex/context-summary-p2-manual-read-gate-evidence.md`。

□ 将使用以下可复用组件：

- `apply_book_run_progress()`：保存 BookRun progress 和状态。
- `BookRunProgressUpdate`：作为 progress 更新输入契约。
- `export_book_run_audit_report()`：生成 `audit_report.json` Artifact。
- `_manual_read_gate_projection()`：从 progress 投影人工通读门禁。

□ 将遵循命名约定：后端字段继续使用 snake_case，例如 `manual_read_gate`、`completed_chapters`、`audit_report`。

□ 将遵循代码风格：后端验证继续使用 pytest；文档和日志使用简体中文；不新增重复实现。

□ 确认不重复造轮子：已检查 `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_book_exporter.py`、`apps/api/app/domains/exports/book_markdown_exporter.py`，现有实现和测试已覆盖门禁保存与审计投影，本轮不改业务代码。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、`apply_patch` 和本地测试脚本替代。

### 本地验证

- `cd apps/api; uv run pytest tests/test_book_runs.py::test_patch_book_run_progress_persists_manual_read_gate tests/test_book_exporter.py::test_book_run_markdown_and_audit_report_exports_artifacts -q`：2 passed。
- `.codex/context-summary-p2-manual-read-gate-evidence.md` 已创建。
- 本阶段首轮敏感信息扫描：相关 4 个文件按高风险凭据模式扫描 0 命中。

### 实施内容

- 主计划 P2 完成证据新增人工通读门禁本地审计证据条目。
- 上下文摘要记录 `manual_read_gate` 保存、`audit_report.json` 投影、测试命令和边界。
- 未修改业务代码，未运行真实外部 LLM。

### 编码后声明

1. 复用了以下既有组件：
   - `apply_book_run_progress()`：用于保存 `manual_read_gate`。
   - `export_book_run_audit_report()`：用于生成包含 `manual_read_gate` 的审计报告。
   - `_manual_read_gate_projection()`：用于字段投影。

2. 遵循了以下项目约定：
   - 命名约定：保持 `manual_read_gate`、`audit_report`、`completed_chapters` 等既有字段。
   - 代码风格：只运行 pytest 和更新 `.codex` 文档，不新增脚本或框架。
   - 文件组织：上下文摘要放在项目本地 `.codex/`。

3. 对比了以下相似实现：
   - `test_patch_book_run_progress_persists_manual_read_gate`：证明 progress 保存。
   - `test_book_run_markdown_and_audit_report_exports_artifacts`：证明 audit_report 投影。
   - `context-summary-p2-real-llm-gate.md`：提供真实长程声明字段边界。

4. 未重复造轮子的证明：
   - 现有 BookRun progress 与 export service 已能承载本轮门禁证据链，本轮只补验证和审计记录。

### 当前结论

- P2 人工通读门禁到审计报告的本地证据链已回归验证。
- 边界：该结论只证明字段保存和审计投影，不代表真实人工通读已完成，也不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。

## P2 长篇 readiness gate 本地复验

时间：2026-06-03 05:43:00 +08:00

### 任务目标

- 复验长篇/分卷 dispatch 前置门禁：缺 Story Memory、Character Bible、Timeline、Foreshadow 四类证据时阻断，补齐后通过。
- 确认普通单卷短篇不被长篇门禁误拦截。
- 更新权威计划、上下文摘要、操作日志和验证报告；真实 LLM 长程 checkbox 保持未完成。

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-p2-longform-readiness-gate.md`。

□ 将使用以下可复用组件：

- `build_book_run_workflow_dispatch()`：生成 workflow dispatch payload 的本地边界。
- `_require_longform_context_ready()`：长篇上下文 readiness gate。
- `BookRunBlockedError`：缺失前置证据时的领域阻断。
- `create_memory_atom()`、`create_character_bible_entry()`、`create_timeline_event()`、`apply_foreshadow_lifecycle_transition()`：测试中构造四类证据。

□ 将遵循命名约定：Python 使用 snake_case；领域错误继续使用 `BookRunBlockedError`；测试使用 `test_` 命名和中文 docstring。

□ 将遵循代码风格：后端验证继续使用 pytest；本轮只复验与文档回填，不新增实现。

□ 确认不重复造轮子：已检查 `apps/api/app/domains/book_runs/service.py` 和 `apps/api/tests/test_book_run_workflow_dispatch.py`，现有 readiness gate 与测试已覆盖目标行为。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、`apply_patch` 和本地测试脚本替代。

### 本地验证

- `cd apps/api; uv run pytest tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_requires_context_readiness tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_passes_after_context_readiness tests/test_book_run_workflow_dispatch.py::test_single_volume_dispatch_does_not_require_longform_context tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：24 passed。
- `.codex/context-summary-p2-longform-readiness-gate.md` 已追加本轮复验记录。
- 本阶段首轮敏感信息扫描：相关 3 个文件按高风险凭据模式扫描 0 命中。

### 实施内容

- 主计划 P2 长篇 readiness gate 证据追加 2026-06-03 复验命令和 24 passed 结果。
- 上下文摘要追加本轮复验范围与边界。
- 未修改业务代码，未启动 workflow，未运行真实外部 LLM。

### 编码后声明

1. 复用了以下既有组件：
   - `build_book_run_workflow_dispatch()`：用于验证 dispatch 前置门禁。
   - `_require_longform_context_ready()`：用于阻断缺失四类证据的长篇请求。
   - 四类领域服务：用于构造 Story Memory、Character Bible、Timeline、Foreshadow 证据。

2. 遵循了以下项目约定：
   - 命名约定：保持 `longform_context_required`、`volume_count`、`BookRunBlockedError` 等既有命名。
   - 代码风格：只运行 pytest 和更新 `.codex` 文档，不新增脚本或框架。
   - 文件组织：上下文摘要和审计记录均写入项目本地 `.codex/`。

3. 对比了以下相似实现：
   - `test_longform_volume_dispatch_requires_context_readiness`：证明缺证据阻断。
   - `test_longform_volume_dispatch_passes_after_context_readiness`：证明补齐证据后通过。
   - `test_single_volume_dispatch_does_not_require_longform_context`：证明普通单卷不误拦截。

4. 未重复造轮子的证明：
   - 现有 readiness gate 和领域事实源已能承载本轮复验目标，本轮只补新鲜验证和审计记录。

### 当前结论

- P2 长篇 readiness gate 本地回归已复验通过。
- 边界：该结论只证明 dispatch 前置门禁，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。

## P2 phase9b 本地模拟预检与脱敏输出验证

时间：2026-06-03 06:05:00 +08:00

### 任务目标

- 复验 phase9b 真实 LLM smoke 边界的本地模拟协议测试。
- 确认缺私有运行配置时 preflight 阻止，pytest 内本地模拟 1 章/10 章路径可产出 BookRun 与审计制品，CLI 摘要保持脱敏。
- 更新权威计划、上下文摘要、操作日志和验证报告；真实 LLM 长程 checkbox 保持未完成。

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-p2-real-llm-gate.md`。

□ 将使用以下可复用组件：

- `run_phase9b_real_llm_smoke()`：受控章节数 smoke 入口，由 pytest 注入本地模拟配置。
- `missing_phase9b_real_llm_env()`：preflight 缺配置检查。
- `main()`：CLI 摘要输出路径。
- `tests/test_phase9b_real_llm_smoke.py` 中的本地 HTTP 模拟服务：验证协议边界，不访问真实供应商。

□ 将遵循命名约定：保持 `chapter_count`、`token_budget`、`target_word_count`、`audit_artifact` 等既有字段。

□ 将遵循代码风格：后端验证继续使用 pytest；本轮只复验与文档回填，不新增实现。

□ 确认不重复造轮子：已检查 phase9b smoke 入口和对应 pytest，现有测试已覆盖本轮目标。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、`apply_patch` 和本地测试脚本替代。

### 本地验证

- `cd apps/api; uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：7 passed。
- `.codex/context-summary-p2-real-llm-gate.md` 已追加本轮本地模拟预检记录。
- 本阶段首轮敏感信息扫描：新写上下文摘要按高风险凭据模式扫描 0 命中。

### 实施内容

- 主计划 P2 完成证据新增 phase9b 本地模拟预检条目。
- 上下文摘要追加本轮模拟预检范围与边界。
- 未修改业务代码，未运行真实 smoke 命令行入口，未运行真实外部 LLM。

### 编码后声明

1. 复用了以下既有组件：
   - `run_phase9b_real_llm_smoke()`：用于 pytest 内模拟 1 章和 10 章路径。
   - `missing_phase9b_real_llm_env()`：用于缺配置 preflight。
   - `main()`：用于 CLI 摘要脱敏路径。

2. 遵循了以下项目约定：
   - 命名约定：保持 phase9b 现有字段和产物摘要字段。
   - 代码风格：只运行 pytest 和更新 `.codex` 文档，不新增脚本或框架。
   - 文件组织：上下文摘要和审计记录均写入项目本地 `.codex/`。

3. 对比了以下相似实现：
   - `test_phase9b_real_llm_smoke_reports_missing_private_env`：证明缺配置阻断。
   - `test_phase9b_real_llm_smoke_runs_one_chapter_and_records_evidence`：证明 1 章模拟路径产出证据。
   - `test_phase9b_real_llm_smoke_runs_ten_chapters_with_word_targets`：证明 10 章与目标字数模拟路径。
   - `test_phase9b_real_llm_smoke_cli_prints_summary_without_secret`：证明 CLI 摘要不输出高风险凭据字段值。

4. 未重复造轮子的证明：
   - 现有 phase9b pytest 已能承载本轮预检目标，本轮只补新鲜验证和审计记录。

### 当前结论

- P2 phase9b 本地模拟协议预检与脱敏输出验证已通过。
- 边界：该结论只证明 pytest 内本地模拟协议和摘要脱敏，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。

## 本地核心门禁快照验证

时间：2026-06-03 06:35:00 +08:00

### 任务目标

- 运行根目录 `pnpm verify`，获取 Web/API/Workflow/OpenAPI 等核心门禁的新鲜证据。
- 修复本轮核心门禁暴露的本地 lint 和契约同步问题。
- 更新权威计划、上下文摘要、操作日志和验证报告；真实 LLM 长程 checkbox 保持未完成。

### 编码前检查

□ 已查阅根 `package.json` 和 `scripts/verify-ci.mjs`，确认 `pnpm verify` 是项目核心门禁聚合入口。

□ 将使用以下可复用组件：

- `pnpm verify`：根核心门禁。
- `pnpm run lint`：根 ESLint 与 Prettier 门禁。
- `pnpm --filter @storyforge/shared generate:types`：根据 OpenAPI 刷新 shared 类型。
- `pnpm openapi`：由 `verify-ci` 刷新 OpenAPI 契约。

□ 将遵循命名约定：保持 `verify:ci`、`verify:browser-session`、`verify:settings-browser` 等既有脚本命名。

□ 将遵循代码风格：JavaScript/TypeScript 走 ESLint 与 Prettier；API/Workflow 走 pytest 与 Ruff。

□ 确认不重复造轮子：已有 `scripts/verify-ci.mjs` 聚合核心门禁，本轮不新增验证脚本。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、`apply_patch`、Prettier 和本地测试脚本替代。

### 失败与修复

- 首次 `pnpm verify` 失败阶段：根静态检查与格式检查。
  - 根因：`apps/web/scripts/verify-*-browser.mjs` 中 `page.evaluate()` 回调使用浏览器全局，但 `eslint.config.mjs` 未对 Web 浏览器验证脚本声明浏览器全局。
  - 同时 Prettier 点名 `apps/web/tests/home-page.test.tsx` 与 `apps/web/tests/settings-page.test.ts` 格式不一致。
  - 修复：在 `eslint.config.mjs` 为 `apps/web/scripts/verify-*-browser.mjs` 添加浏览器全局；清理 `verify-continuous-session-browser.mjs` 的无用变量/参数；对两个测试文件运行 Prettier。
  - 复验：`pnpm run lint` 通过。
- 第二次 `pnpm verify` 失败阶段：OpenAPI 契约漂移检查。
  - 根因：`verify-ci` 会比较 OpenAPI 刷新前后 digest；本轮 Assistant sessions 等新增契约尚未被当前工作树的 OpenAPI 快照接收。
  - 修复：保留 `pnpm openapi` 刷新的 `storyforge.openapi.json`，并运行 `pnpm --filter @storyforge/shared generate:types` 同步 shared generated types。

### 本地验证

- `pnpm run lint`：通过。
- `pnpm --filter @storyforge/shared generate:types`：通过。
- 最终 `pnpm verify`：通过。
  - 根静态检查与格式检查：通过。
  - Web 类型检查：通过。
  - Shared 契约测试：通过。
  - Web 契约测试：209 passed。
  - API 单元测试：376 passed，6 warnings。
  - API Ruff：通过。
  - Workflow 单元测试：164 passed。
  - Workflow Ruff：通过。
  - OpenAPI 契约刷新后无漂移。
- 本阶段敏感信息扫描：6 个相关文件按高风险凭据模式扫描 0 命中。

### 实施内容

- `eslint.config.mjs`：为 Web 浏览器验证脚本声明浏览器全局。
- `apps/web/scripts/verify-continuous-session-browser.mjs`：清理无用变量和未使用参数。
- `apps/web/tests/home-page.test.tsx`、`apps/web/tests/settings-page.test.ts`：按 Prettier 格式化。
- `packages/shared/src/contracts/storyforge.openapi.json`：刷新 OpenAPI 契约。
- `packages/shared/src/generated/api-types.ts`：刷新 shared generated types。
- `.codex/context-summary-local-core-gate-snapshot.md`：新增本轮门禁快照上下文。

### 编码后声明

1. 复用了以下既有组件：
   - `scripts/verify-ci.mjs`：用于核心门禁聚合。
   - `pnpm openapi` 与 shared `generate:types`：用于契约同步。
   - `verify-*-browser.mjs`：继续作为浏览器级本地验证脚本。

2. 遵循了以下项目约定：
   - 命名约定：未新增脚本名，沿用现有 verify 命名体系。
   - 代码风格：所有前端脚本和测试通过 ESLint/Prettier。
   - 文件组织：上下文摘要写入项目本地 `.codex/`。

3. 对比了以下相似实现：
   - 根 `verify-ci` 历史记录：本轮继续以 `pnpm verify` 作为核心门禁证据。
   - 浏览器验证脚本：本轮只修正 lint 环境声明，不改变验证行为。
   - OpenAPI 生成流程：本轮继续由 `pnpm openapi` 生成契约，再由 shared 生成类型。

4. 未重复造轮子的证明：
   - 已有 verify 聚合脚本和生成脚本满足需求，本轮没有新增并行验证工具。

### 当前结论

- 本地核心门禁快照已通过。
- 边界：该结论只证明本地 Web/API/Workflow/OpenAPI 核心门禁，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。

## 本地浏览器与 E2E 门禁复验

时间：2026-06-03 06:10:00 +08:00

### 任务目标

- 重新对账 Assistant 连续会话、settings 浏览器交互和根 E2E 状态，补充本轮新鲜验证证据。
- 修复 `verify:browser-session` 在真实 Chromium 中暴露的 React 水合竞态，避免把短暂启用状态误判为可点击。
- 更新权威计划、上下文摘要、操作日志和验证报告；真实 LLM 10 章或 3-5 万字 checkbox 保持未完成。

### 编码前检查

□ 已查阅 `.codex/context-summary-assistant-continuous-session.md`、`.codex/context-summary-local-core-gate-snapshot.md` 和本轮新建 `.codex/context-summary-local-e2e-browser-gate.md`。

□ 将使用以下可复用组件：

- `apps/web/scripts/verify-continuous-session-browser.mjs`：Assistant 连续会话真实 Chromium 验证。
- `apps/web/scripts/verify-settings-browser.mjs`：settings 页真实 Chromium 安全边界验证。
- `apps/web/tests/home-page.test.tsx`：首页与连续会话源码契约。
- `scripts/run-e2e.mjs`：根 E2E 合约、API 和 Workflow 验证。

□ 将遵循命名约定：继续使用 `verify:browser-session`、`verify:settings-browser` 和 `pnpm e2e`，不新增验证框架。

□ 将遵循代码风格：Node 脚本保持直接函数拆分；测试断言和文档说明使用简体中文。

□ 确认不重复造轮子：本轮复用既有 Playwright 普通 Node 脚本，不引入新的 Playwright test config。

□ 工具缺失记录：当前会话未暴露 `desktop-commander`；本阶段使用 PowerShell、`rg`、Context7、GitHub code search、子代理和本地测试脚本替代。

### 子代理只读核验

- 文档核验子代理确认：权威计划中连续会话、Assistant 会话恢复、settings 浏览器验证和 `pnpm verify` 核心门禁状态没有明显漂移；早期日志中“仍待补”的句子属于历史过程记录，后续记录已覆盖；真实 LLM 10 章或 3-5 万字长程门禁仍应保持未完成。
- Web 核验子代理确认：`HomeComposer` 已保留 `book_id`、`assistant_session_id`、`book_run_id`、`scene_packet_id`、`repair_patch_id`、`target_chapter_ordinal`、`artifact_id`；GET 降级表单按同一白名单渲染 hidden input；`verify:browser-session` 和 `verify:settings-browser` 是 Playwright/Chromium 级脚本。

### 红灯、根因与修复

- `pnpm --filter @storyforge/web test -- home-page`：初次通过 14 passed，确认已有源码契约覆盖连续会话入口。
- `pnpm --filter @storyforge/web verify:browser-session`：失败。Playwright 在点击 `form[action="/"] button[type="submit"]` 时超时，实际按钮仍为 disabled。
- 根因：脚本把“填入并观察按钮启用”和“真实点击”拆成两个阶段；React 水合或受控输入状态回写期间，按钮可能在点击前重新变为 disabled，导致真实 Chromium 点击失败。
- TDD 红灯：先在 `apps/web/tests/home-page.test.tsx` 补断言，要求脚本包含 `submitIntentAfterHydration` 和 `lastClickError`；`pnpm --filter @storyforge/web test -- home-page` 结果为 13 passed、1 failed，失败命中预期契约。
- 修复：将填入、按钮状态读取、点击和 URL intent 等待合并到 `submitIntentAfterHydration()` 的同一重试循环；失败时输出最后一次 DOM 状态与点击错误。

### 本地验证

- `pnpm --filter @storyforge/web test -- home-page`：绿灯 14 passed。
- `pnpm --filter @storyforge/web verify:browser-session`：通过；真实 Chromium 提交后 URL 保留 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`artifact_id` 和 `intent`，刷新后 hidden input 恢复通过。
- `pnpm --filter @storyforge/web verify:settings-browser`：通过。
- `pnpm --filter @storyforge/web lint`：通过。
- `pnpm e2e`：通过；OpenAPI refresh/drift passed，Node 合约 28 passed，API verification 59 passed，Workflow verification 37 passed。
- `git diff --check`：通过。

### 实施内容

- `apps/web/tests/home-page.test.tsx`：补充浏览器验证脚本源码契约，要求水合后重试提交和失败诊断信息。
- `apps/web/scripts/verify-continuous-session-browser.mjs`：修复真实 Chromium 下提交按钮 disabled 竞态。
- `.codex/context-summary-local-e2e-browser-gate.md`：新增本轮上下文摘要。
- `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`：补充 2026-06-03 浏览器与 E2E 复验证据。

### 编码后声明

1. 复用了以下既有组件：
   - `verify-continuous-session-browser.mjs`：继续作为 Assistant 连续会话真实浏览器验证脚本。
   - `verify-settings-browser.mjs`：作为水合后重试交互模式参考，并复验 settings 安全边界。
   - `run-e2e.mjs`：作为根 E2E 合约门禁。

2. 遵循了以下项目约定：
   - 命名约定：沿用 `verify:*` 脚本命名。
   - 代码风格：脚本使用清晰 helper，测试断言使用简体中文。
   - 文件组织：上下文摘要和审计记录均写入项目本地 `.codex/`。

3. 对比了以下相似实现：
   - `verify-settings-browser.mjs`：采用循环交互等待真实浏览器状态稳定。
   - `home-page.test.tsx`：沿用源码契约断言模式。
   - `run-e2e.mjs`：沿用根 E2E 顺序验证模式。

4. 未重复造轮子的证明：
   - 已有浏览器验证脚本和根 E2E 脚本满足本轮目标，本轮只修复竞态并补充断言。

### 当前结论

- Assistant 连续会话真实浏览器点击/刷新恢复本轮复验通过，且脚本对 React 水合竞态更稳健。
- settings 页本地浏览器交互和根 E2E 合约门禁均复验通过。
- 边界：该结论只证明本地浏览器交互、OpenAPI/API/Workflow 合约和连续会话参数恢复，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。
- 安全边界：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘用户提供的 provider 信息。
