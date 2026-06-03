# Assistant 审阅/导出持久回流缺口验证报告

生成时间：2026-06-02 21:54:40 +08:00

## 需求完整性

- 目标：把 Assistant 审阅、导出交付物、Studio 批准写回的持久回流缺口记录到项目本地 `.codex` 文档。
- 范围：仅写入 `.codex/operations-log.md`、`.codex/verification-report.md`，并新增 `.codex/context-summary-assistant-session-persistence.md`。
- 交付物映射：上下文摘要记录证据和下一阶段建议；操作日志记录工具、边界和事实；验证报告记录评分、验证建议和风险。
- 审查要点：不包含密钥；不读取 `.env`；不读取或写入 API Key、token、secret、credential；不修改业务代码。

## 缺口结论

- 章节审阅当前主要通过 URL 参数临时回流：证据文件 `apps/web/components/home/assistant-chapter-review-actions.ts` 与 `apps/web/tests/assistant-chapter-review-actions.test.ts`。
- 导出交付物当前主要通过 URL 参数临时回流：证据文件 `apps/web/components/home/assistant-artifact-export-actions.ts` 与 `apps/web/tests/assistant-artifact-export-actions.test.ts`。
- Studio 批准写回当前主要通过 URL 参数临时回流：证据文件 `apps/web/app/studio/approval-action-core.ts`、`apps/web/app/studio/actions.tsx` 与 `apps/web/tests/studio.test.tsx`。
- BookRun 命令已持久写 AssistantSession：证据文件 `apps/web/components/home/assistant-book-run-actions.ts` 与 `apps/web/tests/assistant-book-run-actions.test.ts`。
- 后端 AssistantSession API 已存在：证据文件 `apps/api/app/domains/assistant/router.py`、`apps/api/app/domains/assistant/service.py`、`apps/api/app/domains/assistant/models.py`、`apps/api/tests/test_assistant_sessions.py`、`apps/api/alembic/versions/20260602_0001_add_assistant_sessions.py`。

## 下一阶段最小写集建议

- `apps/web/components/home/assistant-chapter-review-actions.ts`：在审阅成功路径复用 `createAssistantSession` 或 `appendAssistantSessionMessage` 写入短摘要。
- `apps/web/components/home/assistant-artifact-export-actions.ts`：在导出成功路径写入交付物摘要。
- `apps/web/app/studio/approval-action-core.ts`：在批准写回成功路径写入状态消息。
- `apps/web/tests/assistant-chapter-review-actions.test.ts`、`apps/web/tests/assistant-artifact-export-actions.test.ts`、`apps/web/tests/studio.test.tsx`：补齐成功写会话、失败不写会话、敏感正文不入库断言。
- 不建议新增后端 API、数据库表、配置项或凭据读取；优先复用 `apps/web/components/home/assistant-session-store.ts`。

## 验证建议

- Web 定向测试：运行 `pnpm --filter @storyforge/web test`，或按项目既有脚本定向覆盖 Assistant action 测试。
- API 契约测试：运行 `apps/api/tests/test_assistant_sessions.py`，确认 AssistantSession 创建、追加和敏感 payload key 拒绝逻辑保持有效。
- 静态安全检查：检索下一阶段 diff，确认没有 `.env`、API Key、token、secret、credential、正文全文、补丁全文或导出内容写入会话。
- 行为检查：确认成功路径写会话在 `redirect` 前完成；失败、无效参数、未完成导出、API 异常路径不写会话。

## 风险评估

- 可追溯性风险：继续只依赖 URL 参数会导致审阅、导出、批准写回在刷新或跨会话后不可追溯。
- 重复写入风险：如果在渲染层消费 query 后写会话，刷新页面可能重复写入；应限制在 Server Action 成功路径。
- 信息泄露风险：若持久消息直接写入正文、补丁、导出内容或错误详情，可能扩大敏感信息留存面；应只写短摘要和业务 ID。
- 一致性风险：URL query 展示与 AssistantSession 持久记录并存时，需要避免成功状态消息重复显示或语义不一致。
- 性能风险：每个成功动作新增一次轻量 API 写入，风险低；但不应在轮询、渲染或失败重试路径重复写入。

## 技术维度评分

- 代码质量：95/100。本次未改业务代码，文档清晰映射缺口、证据和建议。
- 测试覆盖：88/100。本次为文档任务，已给出下一阶段验证建议；未运行业务测试，因为无业务代码变更。
- 规范遵循：96/100。仅写允许文件，使用简体中文，未读取 `.env` 或凭据。

技术维度综合：93/100。

## 战略维度评分

- 需求匹配：96/100。完整记录缺口、证据文件路径、最小写集建议、验证建议和风险。
- 架构一致：94/100。建议复用已有 AssistantSession helper 和后端 API，避免新增自研持久层。
- 风险评估：93/100。覆盖可追溯性、重复写入、信息泄露、一致性和性能风险。

战略维度综合：94/100。

## 综合评分

```Scoring
score: 94
```

建议：通过。

## 本地验证结果

- 已完成非敏感检索：未读取 `.env`，未读取或写入 API Key、token、secret、credential 文件。
- 已生成 `.codex/context-summary-assistant-session-persistence.md`。
- 已追加 `.codex/operations-log.md`。
- 已更新 `.codex/verification-report.md`。
- `rg -n "缺口|证据文件|下一阶段最小写集建议|验证建议|风险|AssistantSession|chapter_review_status|artifact_export_status|writeback_status" .codex/context-summary-assistant-session-persistence.md .codex/operations-log.md .codex/verification-report.md`：通过，三份文档均存在关键要求覆盖。
- `rg -n "API Key|token|secret|credential|凭据|密钥|\\.env" .codex/context-summary-assistant-session-persistence.md .codex/operations-log.md .codex/verification-report.md`：命中内容均为安全边界说明或历史日志说明，未新增任何密钥值或凭据内容。
- `git diff --check -- .codex/operations-log.md .codex/verification-report.md .codex/context-summary-assistant-session-persistence.md`：通过，无空白错误。
- `git status --short -- .codex/operations-log.md .codex/verification-report.md .codex/context-summary-assistant-session-persistence.md`：仅包含允许写集内的 `.codex/operations-log.md`、`.codex/verification-report.md` 和 `.codex/context-summary-assistant-session-persistence.md`。
## BookRun 完章同步 TimelineEvent 验证报告

时间：2026-06-02 22:02:23 +08:00

### 需求字段完整性

- 目标：BookRun `completed_chapters` 出现时自动同步为 TimelineEvent。
- 范围：修改 `apps/api/app/domains/book_runs/service.py` 与 `apps/api/tests/test_book_runs.py`，只读 timeline service/schema。
- 交付物：服务层同步逻辑、幂等测试、受控默认字段测试、上下文摘要、操作日志、验证报告。
- 审查要点：复用 timeline service/schema；不新增事件模型；重复提交不产生重复事件；缺失 `volume_id` 使用受控默认。

### 本地验证结果

- `uv run pytest tests/test_book_runs.py::test_apply_book_run_progress_syncs_completed_chapter_to_timeline_once -q`：先失败，失败原因为事件数量为 0；实现后 1 passed。
- `uv run pytest tests/test_book_runs.py tests/test_timeline_events.py -q`：17 passed，1 warning。
- `uv run ruff check app/domains/book_runs/service.py tests/test_book_runs.py`：All checks passed。
- `git diff --check -- apps/api/app/domains/book_runs/service.py apps/api/tests/test_book_runs.py .codex/context-summary-bookrun-timeline-sync.md .codex/operations-log.md`：通过。

### 技术维度评分

- 代码质量：28/30。复用既有 TimelineEvent 创建契约，helper 职责清晰；扣分项为 JSON 载荷去重未上升到唯一约束。
- 测试覆盖：28/30。覆盖同步创建、重复回填去重、`volume_id` 和 `project_id` 受控默认；未覆盖并发竞态。
- 规范遵循：29/30。遵循中文输出、限定写集、TDD、本地验证；当前环境无 desktop-commander，已记录 PowerShell 替代。

技术综合评分：95/100。

### 战略维度评分

- 需求匹配：30/30。显性需求均有代码或测试证据。
- 架构一致：28/30。未新增自研事件模型，复用 timeline service/schema；BookRun service 新增 timeline 依赖符合本需求。
- 风险评估：27/30。已识别服务层幂等和事务提交边界风险，并提出后续 source key 或唯一索引方向。

战略综合评分：93/100。

### 综合结论

```Scoring
score: 94
```

建议：通过。

summary: 'BookRun 完章进度已在 apply_book_run_progress 中同步为 TimelineEvent，复用现有 timeline service/schema，并通过 evidence_refs/payload 实现重复回填去重；缺失 volume_id 时使用受控默认 1 并记录原因。'

## 阶段整合验证报告

时间：2026-06-02 22:07:13 +08:00

### 需求字段完整性

- 目标：继续执行 StoryForge Assistant 工作流计划，完成 Story Memory guard、BookRun 完章到 TimelineEvent 自动同步、OpenAPI/TypeScript 契约刷新，并记录 Assistant 持久回流缺口。
- 范围：API 领域守卫、BookRun/Timeline 集成、shared 契约产物、项目本地 `.codex` 文档。
- 交付物映射：`guard.py`、Timeline 同步逻辑与测试、OpenAPI/TS 生成产物、`.codex/context-summary-assistant-session-persistence.md`、操作日志和验证报告。
- 审查要点：本地验证通过；不读取 `.env`；不写入密钥；复用既有 service/schema；不回滚非本阶段改动。

### 审查结论

- Story Memory guard：通过。新增模块只读复用 Story Memory active 查询，输出 NovelLoop 静态质量端口兼容 issue，局部测试 14 passed。
- Timeline 自动同步：通过。BookRun `completed_chapters` 可同步为 TimelineEvent，重复回填保持幂等，局部测试纳入 API 组合 40 passed。
- OpenAPI/TS 契约：通过。shared OpenAPI 与生成类型已包含 `volume_plan`，shared `tsc --noEmit` 通过。
- Assistant 持久回流缺口：通过文档化。已记录证据、最小写集、验证建议和风险；业务实现留到下一阶段。

### 本地验证结果

- `uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`：14 passed。
- `uv run pytest tests/test_book_runs.py tests/test_timeline_events.py tests/test_book_run_workflow_dispatch.py tests/test_book_exporter.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`：40 passed，1 warning。
- `uv run pytest tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py tests/test_novel_loop_skill_runner_integration.py tests/test_novel_loop_single_chapter.py -q`：18 passed。
- `pnpm --filter @storyforge/shared test`：通过。
- `uv run ruff check app/domains/story_memory/guard.py app/domains/book_runs/service.py tests/test_story_memory_contract.py tests/test_book_runs.py`：通过。
- `git diff --check`：通过。

### 技术维度评分

- 代码质量：27/30。新 guard 小而独立，Timeline 复用现有契约；扣分项是 `create_timeline_event()` 内部 commit 导致事务边界仍可优化。
- 测试覆盖：28/30。覆盖 Story Memory active/非误杀/过期事实、Timeline 幂等和默认字段、BookRun dispatch/export、Workflow adapter；真实 LLM 长程验收未执行。
- 规范遵循：29/30。全程简体中文、项目本地 `.codex` 留痕、本地验证、敏感信息不落盘。

技术维度综合：93/100。

### 战略维度评分

- 需求匹配：28/30。本阶段阻塞点均处理，Assistant 持久回流已形成下一阶段可执行输入。
- 架构一致：28/30。复用 Story Memory、Timeline、AssistantSession、OpenAPI 生成链路；未新增自研持久层或事件模型。
- 风险评估：28/30。已记录事务边界、文本启发式误杀、前端持久回流和真实 LLM 门禁风险。

战略维度综合：93/100。

### 综合评分

```Scoring
score: 93
```

建议：通过。

summary: '本阶段已完成 Story Memory 连续性守卫、BookRun completed_chapters 到 TimelineEvent 同步、OpenAPI/TypeScript 契约刷新，并记录 Assistant 审阅/导出/批准写回持久回流缺口。所有可本地执行的 API、Workflow、shared 类型和 diff 检查均已通过。'

## AssistantSession 持久回流闭环验证报告

时间：2026-06-02 22:25:40 +08:00

### 需求字段完整性

- 目标：章节审阅、导出交付物、Studio 批准写回成功结果持久写入 AssistantSession。
- 范围：三个前端 Server Action 与对应测试；后端 AssistantSession API 不新增。
- 交付物映射：章节审阅 action/test、导出 action/test、Studio approval core/actions/test、操作日志和验证报告。
- 审查要点：成功路径写会话；失败、invalid、not_ready 不写；有 `assistant_session_id` 时追加；无会话 ID 时创建新会话；持久消息不写正文、补丁全文、导出内容或凭据。

### 审查结论

- 章节审阅：通过。ready 成功路径写入 Scene Packet、Repair Patch 和短摘要；失败路径不写。
- 导出交付物：通过。三类导出全部成功后写入 BookRun 和 artifact id/name 摘要；invalid、not_ready、导出失败不写。
- Studio 批准写回：通过。批准 API 成功且响应格式有效后写入 writeback 状态和业务 ID；失败路径不写。
- 既有 BookRun 命令和 AssistantSession helper 回归：通过。

### 本地验证结果

- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions assistant-artifact-export-actions studio assistant-book-run-actions assistant-session-store`：26 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。
- `pnpm --filter @storyforge/web test`：191 passed。
- `git diff --check`：通过。
- 敏感字段检索仅命中 `token_budget/tokens_used` 测试字段名，未发现密钥值、凭据、正文全文、补丁全文或导出内容持久化。

### 技术维度评分

- 代码质量：28/30。复用既有 AssistantSession helper，依赖注入便于测试；扣分项为三个 action 各自维护短消息格式，后续可在复用需求出现三次后再抽取。
- 测试覆盖：29/30。覆盖成功创建/追加、失败不写、Web 全量测试、API AssistantSession 回归；未覆盖真实浏览器表单携带当前会话 ID。
- 规范遵循：29/30。保持简体中文、本地验证、敏感信息不落盘、未新增后端自研存储。

技术维度综合：95/100。

### 战略维度评分

- 需求匹配：29/30。解决审阅、导出、批准写回的持久追溯缺口；当前会话 ID 生命周期留作后续。
- 架构一致：28/30。沿用 Server Action 成功副作用、AssistantSession helper、后端现有 API；不新增数据库或路由。
- 风险评估：28/30。已记录会话分裂、写会话失败是否阻断外部动作的产品取舍风险。

战略维度综合：94/100。

### 综合评分

```Scoring
score: 95
```

建议：通过。

summary: 'Assistant 章节审阅、导出交付物、Studio 批准写回三条成功路径已持久写入 AssistantSession，并保留失败路径不写会话的安全边界。Web 定向、Web 全量、Web 类型检查、API AssistantSession 回归和 diff 检查均已通过。'

## Studio 批准写回 AssistantSession 验证报告

时间：2026-06-02 22:24:00 +08:00

### 需求字段完整性

- 目标：Studio 批准写回成功后将精简结果写入 AssistantSession。
- 范围：`approval-action-core.ts`、`actions.tsx`、`studio.test.tsx`。
- 交付物映射：core 依赖注入与成功分支调用、action 真实写入实现、定向测试覆盖、验证记录。
- 审查要点：失败路径不写会话；消息不包含正文、补丁全文或敏感字段；保留 redirect、resultTarget、revalidate 行为。

### 审查结论

- 技术维度评分：代码质量 28/30，测试覆盖 29/30，规范遵循 29/30。
- 战略维度评分：需求匹配 30/30，架构一致 29/30，风险控制 28/30。

```Scoring
score: 96
```

建议：通过。

summary: 'Studio 批准写回成功路径已写入 AssistantSession，复用现有 session-store，并通过依赖注入覆盖追加、新建和失败不写场景；定向 Web 测试与 TypeScript 检查均通过。'

## 导出交付物成功结果写入 AssistantSession 验证报告

时间：2026-06-02 22:18:08 +08:00

### 审查结论

- 需求字段完整性：通过，覆盖成功写入、已有会话追加、新会话创建、失败不写入、保留 redirect。
- 交付物映射：代码为 `apps/web/components/home/assistant-artifact-export-actions.ts`，测试为 `apps/web/tests/assistant-artifact-export-actions.test.ts`。
- 依赖与风险：复用 `assistant-session-store.ts`；消息仅包含 BookRun ID 与 artifact id/name 摘要，不包含导出内容或敏感字段。
- 本地验证：`pnpm --filter @storyforge/web test assistant-artifact-export-actions` 通过 5/5；限定文件 Prettier 检查通过。
- 残留风险：`pnpm --filter @storyforge/web lint` 失败于未修改的 `apps/web/tests/assistant-chapter-review-actions.test.ts` 既有类型错误，未在本次限定写集内修复。

### 评分

- 代码质量：29/30
- 测试覆盖：29/30
- 规范遵循：20/20
- 风险控制：18/20

```Scoring
score: 96
```

建议：通过。

summary: '导出交付物成功路径已在三类导出全部完成后写入 AssistantSession，并通过依赖注入测试覆盖已有会话追加、新会话创建以及 invalid、not_ready、POST 失败不写入分支。'

## 章节审阅成功结果写入 AssistantSession 验证报告

时间：2026-06-02 22:40:00 +08:00

### 审查结论

- 需求字段完整性：通过，覆盖 ready 成功写入、已有会话追加、新会话创建、缺 `scene_packet_id` 不写入、Studio API 失败不写入。
- 交付物映射：代码为 `apps/web/components/home/assistant-chapter-review-actions.ts`，测试为 `apps/web/tests/assistant-chapter-review-actions.test.ts`。
- 依赖与风险：复用 `appendAssistantSessionMessage` 与 `createAssistantSession`；消息仅包含 Scene Packet ID、Repair Patch ID、短摘要，不包含章节正文、补丁全文或敏感字段。
- 本地验证：`pnpm --filter @storyforge/web test -- assistant-chapter-review-actions` 通过 5/5；`pnpm --filter @storyforge/web lint` 通过。
- 残留风险：目标文件当前在工作树中为未跟踪文件，未处理其他 worker 产生的既有脏改。

### 评分

- 代码质量：28/30
- 测试覆盖：28/30
- 规范遵循：20/20
- 风险控制：16/20

```Scoring
score: 92
```

建议：通过。

summary: '章节审阅 ready 成功路径已写入 AssistantSession，并通过依赖注入测试覆盖有无 assistant_session_id、缺 scene_packet_id、Studio API 失败和摘要安全截断行为。'

## BookRun AssistantSession ID 贯穿收尾验证报告

时间：2026-06-02 22:50:00 +08:00

### 需求字段完整性

- 目标：BookRun 命令成功后保持 Assistant 会话连续性，避免已有会话操作后分裂到无会话 URL。
- 范围：`apps/web/tests/assistant-book-run-actions.test.ts` 的 redirect 契约修正；运行时代码保持不变。
- 交付物映射：无会话成功路径不凭空携带旧 ID；已有 `assistant_session_id=31` 成功路径保留该 ID；新建会话成功路径继续回传新 ID。
- 审查要点：失败和 invalid 路径不误写会话；消息只包含业务 ID 和状态；不记录正文、补丁全文、导出内容或凭据。

### 本地验证结果

- `pnpm --filter @storyforge/web test -- assistant-book-run-actions assistant-chapter-review-actions assistant-artifact-export-actions studio home-page`：36 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `git diff --check`：通过。
- `pnpm --filter @storyforge/web test`：194 passed。
- `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。

### 技术维度评分

- 代码质量：29/30。只修正测试契约，不扰动运行时代码，保持现有 Server Action 结构。
- 测试覆盖：30/30。覆盖无会话、已有会话、新建会话、无正文命令和 invalid 参数，并通过相关 Assistant action、Studio、首页与 Web 全量测试。
- 规范遵循：30/30。遵循简体中文、本地验证、`.codex` 留痕和不写入敏感信息要求。

技术维度综合：99/100。

### 战略维度评分

- 需求匹配：30/30。验证 BookRun 命令成功后可持续携带或回传 `assistant_session_id`。
- 架构一致：29/30。沿用现有 action、session-store 和测试注入模式；运行时仍有后续可优化的多 action 消息格式统一空间。
- 风险评估：29/30。已通过宽验证降低回归风险；真实浏览器端连续会话体验仍需后续端到端路径观察。

战略维度综合：98/100。

### 综合评分

```Scoring
score: 98
```

建议：通过。

summary: 'BookRun AssistantSession ID 贯穿收尾已完成，测试契约与当前实现一致；定向 Web 测试、Web 全量测试、TypeScript 检查、API AssistantSession 回归和 diff 检查均通过。'

## Assistant 最近记录可追溯链接验证报告

时间：2026-06-02 22:57:07 +08:00

### 需求字段完整性

- 目标：首页左侧最近记录来自真实 Assistant 会话，并能跳回关联会话和任务上下文。
- 范围：`home-data.ts`、`assistant-session-store.ts`、`HomeSidebar.tsx`、`assistant-session-store.test.ts`、`home-page.test.tsx`。
- 交付物映射：`HomeRecentItem` 增加 `href`；最近会话映射包含 `assistant_session_id` 与可用的 `book_run_id`、`artifact_id`、`blueprint_id`；侧栏用 `Link` 渲染最近记录。
- 审查要点：不恢复静态伪历史；不新增后端接口；不写入凭据或正文内容。

### 本地验证结果

- TDD 红灯：`pnpm --filter @storyforge/web test -- assistant-session-store home-page` 首次失败 3 项，失败点均为缺少 `href`。
- TDD 绿灯：`pnpm --filter @storyforge/web test -- assistant-session-store home-page`：19 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `git diff --check`：通过。
- `uv run pytest tests/test_assistant_sessions.py -q`：2 passed。

### 技术维度评分

- 代码质量：29/30。改动集中在前端投影和展示层，使用 `URLSearchParams` 避免手写 query。
- 测试覆盖：29/30。覆盖映射 helper、读取 helper、首页源码契约和 API 会话回归；尚未增加浏览器级点击测试。
- 规范遵循：30/30。全程本地验证、简体中文留痕、未触碰凭据。

技术维度综合：98/100。

### 战略维度评分

- 需求匹配：30/30。最近记录不只展示真实会话，也能回到 Assistant 会话和关联任务。
- 架构一致：29/30。沿用现有 AssistantConversation URL 参数恢复模式，不新增路由层。
- 风险评估：28/30。链接到 artifact/blueprint 的后续展示仍依赖对应页面继续消费这些 query，当前已保证参数不丢失。

战略维度综合：97/100。

### 综合评分

```Scoring
score: 98
```

建议：通过。

summary: 'Assistant 最近记录已从真实会话读取扩展为可追溯链接，侧栏记录可携带 assistant_session_id 及关联业务 ID 回到首页上下文；定向 Web 测试、TypeScript 检查、API 会话回归和 diff 检查均通过。'

## Artifact.export 真实审计导出证据映射验证报告

时间：2026-06-02 23:02:10 +08:00

### 需求字段完整性

- 目标：Assistant 工具树能根据真实审计导出证据展示 `Artifact.export` 已完成，不再在导出后持续显示等待。
- 范围：`assistant-tool-node-mapper.ts` 与 `assistant-tool-node-mapper.test.ts`。
- 交付物映射：无导出证据的 completed BookRun 仍为 waiting；存在 `progress.audit_report`、`exported_artifacts` 或 `artifact_exports` 中的 `audit_report.json`/`book_audit_report`/`skill_chain` 证据时为 completed。
- 审查要点：completed 状态必须来自事实源；不修改后端契约；摘要只展示 artifact id/name 和追溯链，不包含正文、prompt 或凭据。

### 本地验证结果

- TDD 红灯：`pnpm --filter @storyforge/web test -- assistant-tool-node-mapper` 首次失败 1 项。
- TDD 绿灯：`pnpm --filter @storyforge/web test -- assistant-tool-node-mapper`：6 passed。
- `pnpm --filter @storyforge/web test -- assistant-tool-node-mapper assistant-artifact-export-actions book-runs`：14 passed。
- `uv run pytest tests/test_book_exporter.py -q`：3 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `git diff --check`：通过。
- `pnpm --filter @storyforge/web test`：195 passed。

### 技术维度评分

- 代码质量：29/30。状态判断集中在 mapper 局部 helper，避免扩大运行时代码面。
- 测试覆盖：30/30。覆盖无证据 waiting、有 audit_report 证据 completed、导出 action、BookRun helper、后端 exporter 和 Web 全量回归。
- 规范遵循：30/30。保持本地验证、简体中文留痕和敏感信息不落盘。

技术维度综合：99/100。

### 战略维度评分

- 需求匹配：29/30。补齐导出成功后工具树可追踪状态；后续仍可进一步把 audit Artifact ID 回写到 BookRun progress 的后端事实源。
- 架构一致：29/30。沿用 BookRun progress 作为工具树事实源，不新增 Agent 平台或前端伪状态。
- 风险评估：28/30。当前兼容多个可能字段名，后续应在后端正式统一 `progress.audit_report` 写入规范。

战略维度综合：96/100。

### 综合评分

```Scoring
score: 98
```

建议：通过。

summary: 'Artifact.export 工具节点已能识别真实 audit_report 导出证据并映射为 completed，无证据时仍保持 waiting；Web 定向、Web 全量、TypeScript、API exporter 和 diff 检查均通过。'

## Assistant 工具树移除硬编码预算摘要验证报告

时间：2026-06-02 23:04:45 +08:00

### 需求字段完整性

- 目标：工具树顶部不得展示静态假耗时、假 token 或假思考耗时，避免与真实预算节点并存。
- 范围：`AssistantToolTree.tsx` 与 `home-page.test.tsx`。
- 交付物映射：顶部说明改为“耗时、token、预算和成本只来自真实工具节点”；测试禁止 `2m 45s`、`7.7k tokens`、`thought for 8s` 回流。
- 审查要点：真实预算仍由每个 `AssistantToolNode` 的 `elapsedLabel`、`tokenLabel`、`toolUseLabel` 渲染。

### 本地验证结果

- TDD 红灯：`pnpm --filter @storyforge/web test -- home-page` 首次失败 1 项。
- TDD 绿灯：`pnpm --filter @storyforge/web test -- home-page assistant-tool-node-mapper`：19 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `git diff --check`：通过。
- `pnpm --filter @storyforge/web test`：195 passed。

### 综合评分

```Scoring
score: 97
```

建议：通过。

summary: 'Assistant 工具树顶部硬编码演示预算摘要已移除，真实耗时、token、预算和成本继续由工具节点数据展示；首页定向、mapper 定向、Web 全量、TypeScript 和 diff 检查均通过。'

## Assistant 章节审阅主动创建验证报告

时间：2026-06-03 00:02:17 +08:00

### 需求字段完整性

- 目标：Assistant 章节审阅不再只读取已有 Judge/Repair，而是能通过 `scene_packet_id` 主动创建 JudgeIssue 与 RepairPatch，并返回批准摘要。
- 范围：`apps/api/app/domains/studio/{schemas,service,router}.py`、`apps/api/tests/test_studio_book_list_api.py`、`apps/web/components/home/assistant-chapter-review-actions.ts`、`apps/web/tests/assistant-chapter-review-actions.test.ts`、OpenAPI/shared 生成物。
- 交付物映射：新增 `POST /api/studio/chapter-review`；前端 action 一次 POST 新端点；API 测试覆盖有问题、clean 空态和空正文错误；Web 测试覆盖 POST、摘要压缩、会话写入和失败回流。
- 审查要点：不复制 Judge/Repair 业务逻辑；不泄露正文或凭据；clean 空态不能误报 404；批准写回仍走既有 Studio 批准门禁。

### 本地验证结果

- `uv run pytest tests/test_studio_book_list_api.py -q`：23 passed。
- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions`：6 passed。
- `pnpm openapi`：通过并刷新契约。
- `pnpm --filter @storyforge/shared generate:types`：通过并刷新类型。
- `uv run pytest tests/test_studio_book_list_api.py tests/test_judge_repair.py -q`：24 passed。
- `pnpm --filter @storyforge/shared test`：通过。
- `pnpm --filter @storyforge/web test -- assistant-chapter-review-actions home-page studio`：25 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `uv run pytest tests/test_api_surface.py -q`：1 passed。
- `uv run pytest -q`：364 passed，6 warnings。
- `pnpm --filter @storyforge/web test`：195 passed。
- `uv run ruff check .`：通过。
- `git diff --check`：通过。
- `pnpm verify`：通过；核心门禁全部通过，含 Workflow 161 passed 与 OpenAPI 漂移检查。

### 技术维度评分

- 代码质量：29/30。新增端点保持薄编排，不复制领域判定；Redis 缓存降级补了全量测试暴露的根因。
- 测试覆盖：30/30。覆盖 API 主动创建、clean 空态、输入错误、Web action、OpenAPI/shared、Web/API/Workflow 全量门禁。
- 规范遵循：30/30。简体中文留痕、无凭据落盘、本地自动验证闭环完整。

技术维度综合：99/100。

### 战略维度评分

- 需求匹配：29/30。指定 `scene_packet_id` 后 Assistant 可主动串联 Judge、Repair 和批准摘要；自然语言章节定位仍需后续补齐。
- 架构一致：30/30。复用 Studio、Judge、Repair 和 API client 既有边界，未引入新 Agent 平台。
- 风险评估：28/30。真实 LLM 长程验收、浏览器级连续会话和“第二章”到 Scene Packet 的解析仍需后续阶段处理。

战略维度综合：97/100。

### 综合评分

```Scoring
score: 98
```

建议：通过。

summary: 'Assistant 章节审阅已从只读已有 Judge/Repair 升级为通过 scene_packet_id 主动创建 JudgeIssue 与 RepairPatch 的 Studio 薄端点，前端 action 改为一次 POST 并保留会话与 redirect 契约；pnpm verify 已通过。真实外部 LLM 长程生产和自然语言章节定位仍不得宣称完成。'

## Assistant 章节审阅自然语言定位验证报告

时间：2026-06-03 00:39:00 +08:00

### 需求字段完整性

- 目标：用户输入“审阅第二章/第2章/2章”后，Assistant 能解析目标章节序号；在存在真实 `book_id` 时先定位 `scene_packet_id`，再发起章节审阅。
- 范围：`assistant-intent.ts`、`HomeComposer.tsx`、`AssistantConversation.tsx`、`AssistantActionBar.tsx`、`assistant-chapter-review-actions.ts` 和对应 Web 测试。
- 交付物映射：新增 `targetChapterOrdinal`；章节审阅 action 支持 `book_id + target_chapter_ordinal` 定位；HomeComposer 按任务类型分流，章节审阅留在 Assistant 对话台并保留 `book_id`。
- 审查要点：缺 `book_id` 时返回选择作品状态；Scene Packet 定位失败时返回可读失败；不伪造默认作品；不读取 `.env` 或写入凭据。

### 本地验证结果

- `pnpm --filter @storyforge/web test -- assistant-intent assistant-chapter-review-actions home-page`：29 passed。
- `pnpm --filter @storyforge/web test`：200 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `pnpm exec prettier --check` 触及文件：通过。
- `git diff --check` 触及文件：通过。
- 敏感值检查：未发现用户提供的 API Key 前缀写入触及文件或 `.codex` 新摘要。

### 技术维度评分

- 代码质量：28/30。实现沿用现有解析、query、Server Action 和消息回流模式；HomeComposer 分流保持生成类 Projects 链路。
- 测试覆盖：27/30。覆盖解析、定位成功、缺作品、定位失败、源码参数传递和类型检查；尚未补浏览器级点击测试。
- 规范遵循：29/30。简体中文留痕、本地验证、无凭据落盘；`desktop-commander` 未暴露，已记录替代工具。

技术维度综合：94/100。

### 战略维度评分

- 需求匹配：28/30。`book_id + 自然语言章序` 已可定位到真实 Scene Packet 并发起审阅；缺真实作品上下文时仍需要用户选择。
- 架构一致：29/30。复用 Studio 既有 API 和 Assistant 薄编排，不新增后端路由。
- 风险评估：27/30。真实 LLM 长程验收和浏览器连续会话仍未完成，需要后续阶段处理。

战略维度综合：93/100。

### 综合评分

```Scoring
score: 94
```

建议：通过。

summary: 'Assistant 已支持从“审阅第二章/第2章/2章”解析目标章序，并在存在真实 book_id 时通过 /api/studio/scene-packets 定位 scene_packet_id 后调用 /api/studio/chapter-review；缺 book_id 或定位失败均回流可读状态。真实外部 LLM 长程和浏览器级连续会话仍未完成。'

## Provider、预算和暂停原因可视化验证报告

时间：2026-06-03 01:16:35 +08:00

### 需求字段完整性

- 目标：Provider 不可用时不能伪装 running/completed；BookRun token/time/chapter 预算触顶后自动暂停并展示原因；API Key 不进入普通前端本地状态。
- 范围：`apps/api/app/domains/book_runs/service.py`、`apps/api/tests/test_book_runs.py`、`apps/web/components/home/assistant-tool-node-mapper.ts`、`apps/web/tests/assistant-tool-node-mapper.test.ts`、`apps/web/app/settings/ProviderSettingsPanel.tsx`、`apps/web/tests/settings-page.test.ts`。
- 交付物映射：后端统一预算门禁、completed 防误暂停回归测试、Provider 不可用和预算展示 mapper 测试、P1 上下文摘要和计划勾选。
- 审查要点：状态必须来自 BookRun progress 和 Provider resolution；不得写入真实 API Key；不得把预算暂停或 Provider 不可用伪装为成功。

### 本地验证结果

- `uv run pytest tests/test_book_runs.py -q`：19 passed，1 warning。
- `pnpm --filter @storyforge/web test -- settings-page assistant-tool-node-mapper`：14 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- 子代理只读核查：后端预算、前端工具树、计划 P1、P2 入口扫描均已完成；前端核查代理额外报告 `pnpm --filter @storyforge/web test` 为 203 passed。

### 技术维度评分

- 代码质量：28/30。预算门禁集中在 BookRun service，前端 mapper 只做事实源映射；未新增外部依赖或凭据存储。
- 测试覆盖：29/30。覆盖 token/time/chapter 自动暂停、token/time/chapter completed 防误暂停、Provider 不可用 running/completed 防伪装、预算展示和暂停原因兜底；settings 页已由后续浏览器交互验证补齐本地存储与模型检测请求体安全边界。
- 规范遵循：29/30。简体中文留痕完整，未读取 `.env`，未落盘真实 API Key；子代理核查和本地验证均记录。

技术维度综合：94/100。

### 战略维度评分

- 需求匹配：28/30。P1 Provider、预算和暂停原因核心验收已满足；浏览器级连续会话和真实 LLM 长程证据仍未完成。
- 架构一致：29/30。复用 BookRun、Provider Gateway、Assistant mapper 和 settings 既有边界，不新增大 Agent 平台。
- 风险评估：27/30。多预算同时触顶只显示首个原因；Provider 不可用前端判断依赖 `provider_resolution.ok === false` 的后端契约。

战略维度综合：93/100。

### 综合评分

```Scoring
score: 94
```

建议：通过。

summary: 'P1 Provider、预算和暂停原因可视化已补齐核心门禁：BookRun progress 回填统一执行 token/time/chapter 预算暂停，completed 防误暂停有回归测试；Assistant 工具树展示 Provider 不可用、预算用量、成本和暂停原因；Provider 设置页不保存 API Key。真实 LLM 长程和浏览器级连续会话仍未完成。'

## P2 前端规模意图与 Blueprint 元数据验证报告

时间：2026-06-03 01:26:21 +08:00

### 需求字段完整性

- 目标：Assistant 对 10 章、3-5 万字、分卷数量、每批章节数的自然语言解析必须进入 Blueprint 创建链路。
- 范围：`assistant-intent.ts`、`assistant-intent.test.ts`、`app/blueprints/api.tsx`、`BlueprintWorkspacePanel.tsx`、`blueprints.test.tsx`。
- 交付物映射：解析测试覆盖 `volumeCount=2`；Blueprint helper payload 覆盖 `metadata.volume_count`；Server Action 测试覆盖从 `FormData.intent` 创建 10 章/50000 字/2 卷/前 3 章批次 Blueprint；UI 源码契约覆盖创建表单透传 `intent`。
- 审查要点：不新增 API Key 状态；不新增 LLM 意图解析；不让 URL intent 在工作台创建表单处丢失。

### 本地验证结果

- TDD 红灯：`pnpm --filter @storyforge/web test -- assistant-intent blueprints` 首次失败 1 项，失败点为工作台未读取 URL intent。
- TDD 绿灯：`pnpm --filter @storyforge/web test -- assistant-intent blueprints`：13 passed。
- `pnpm --filter @storyforge/web lint`：通过。
- `pnpm exec prettier --check` 触及文件：通过。
- `git diff --check` 触及文件：通过。
- 敏感信息扫描：触及文件未命中真实用户 key 或 key 前缀。

### 技术维度评分

- 代码质量：29/30。修复点极小，复用现有 hidden input 和 Server Action intent 解析。
- 测试覆盖：28/30。覆盖解析、helper payload、Server Action、UI 源码链路；尚未做浏览器级表单提交。
- 规范遵循：30/30。简体中文留痕、无凭据落盘、未新增依赖。

技术维度综合：97/100。

### 战略维度评分

- 需求匹配：29/30。10 章、3-5 万字、分卷和批次已能从首页 URL intent 进入 Blueprint 创建链路；字数范围仍只保留上限。
- 架构一致：30/30。沿用现有前端表单和 Blueprint metadata，不扩展后端 schema。
- 风险评估：27/30。后续还需 deterministic 产物证据、分卷恢复链路和真实 LLM 门禁。

战略维度综合：95/100。

### 综合评分

```Scoring
score: 96
```

建议：通过。

summary: 'P2 前端规模意图链路已补齐：用户输入的 10 章、3-5 万字、2 卷、前 3 章批次目标不会在 Blueprint 工作台创建表单处丢失，并会进入 Blueprint payload 与 metadata。deterministic 产物证据、长篇上下文门禁和真实 LLM 长程验收仍在后续 P2 子任务中。'

## P2 API 恢复 dispatch 契约验证报告

时间：2026-06-03 01:31:11 +08:00

### 需求字段完整性

- 目标：resume/retry 后的 `/workflow-dispatch` 必须从正确章节继续，不能从第一章重跑，也不能被陈旧 progress 字段带回旧章节。
- 范围：`apps/api/app/domains/book_runs/service.py`、`apps/api/tests/test_book_run_workflow_dispatch.py`、`apps/api/tests/test_book_runs.py`、`apps/api/tests/test_book_run_resume.py`。
- 交付物映射：新增 resume 后 dispatch 测试；新增 retry 后 stale resume 优先级测试；修复 retry 清理旧 resume 字段和 dispatch 起点优先级。
- 审查要点：不新增 API；不改 workflow；只修 API dispatch 起点契约。

### 本地验证结果

- TDD 红灯：`uv run pytest tests/test_book_run_workflow_dispatch.py -q` 首次失败 1 项，`dispatch.start_chapter_index` 实际为 2，预期为 3。
- TDD 绿灯：`uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_book_runs.py tests/test_book_run_resume.py -q`：28 passed，1 warning。
- `uv run ruff check app/domains/book_runs/service.py tests/test_book_run_workflow_dispatch.py`：通过。

### 技术维度评分

- 代码质量：29/30。修复局部，直接消除 retry 与 stale resume 的优先级冲突。
- 测试覆盖：28/30。覆盖 resume/retry 后 dispatch 起点、checkpoint 和 volume_plan；跨 workflow adapter 的预算延续仍在并行任务中。
- 规范遵循：30/30。无凭据、无新依赖、简体中文留痕。

技术维度综合：97/100。

### 战略维度评分

- 需求匹配：29/30。证明 API dispatch 可以按 checkpoint 继续，不会因 retry 旧字段重跑旧章节。
- 架构一致：29/30。保持 BookRun service 为恢复与 dispatch 单一边界。
- 风险评估：27/30。workflow 预算延续、OpenAPI/shared 同步仍需后续任务。

战略维度综合：95/100。

### 综合评分

```Scoring
score: 96
```

建议：通过。

summary: 'API 恢复 dispatch 契约已补齐：resume 后 dispatch 从最新 checkpoint 下一章开始并保留分卷计划；retry 后优先使用 retry_from_chapter_index，且清理陈旧 resume_from_chapter_index，避免 worker 回到旧章节。Workflow 预算延续和 OpenAPI/shared 同步仍在后续 P2 任务中。'

## OpenAPI 与共享类型契约同步验证报告

时间：2026-06-03 01:35:55 +08:00

### 需求字段完整性

- 目标：BookRunWorkflowDispatch、BookRunVolumeProgress、BookRunProgressUpdate 的 OpenAPI 与 shared generated types 保持同步。
- 范围：`packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`、`apps/api/tests/test_book_runs.py`。
- 交付物映射：OpenAPI schema 中存在 `BookRunVolumeProgress`；`BookRunProgressUpdate.volume_progress` 引用该 schema；generated types 中存在 `BookRunWorkflowDispatch.volume_plan`。
- 审查要点：不得手写生成物；不得遗漏 shared 类型同步；不得写入敏感信息。

### 本地验证结果

- `pnpm openapi`：通过。
- `pnpm --filter @storyforge/shared generate:types`：通过。
- `rg "BookRunVolumeProgress|volume_progress|volume_plan|BookRunWorkflowDispatch" packages/shared/src/contracts/storyforge.openapi.json packages/shared/src/generated/api-types.ts apps/api/tests/test_book_runs.py`：确认字段存在。
- `pnpm --filter @storyforge/shared test`：通过。
- `pnpm exec prettier --check` 触及文件：通过。
- `git diff --check` 触及文件：通过。
- 敏感信息扫描：触及文件未命中真实用户 key 或 key 前缀。

### 技术维度评分

- 代码质量：30/30。使用既有生成链路，无手工改写生成物。
- 测试覆盖：28/30。schema/type 字段和 shared tsc 已验证；全量 verify 尚未在本子任务中运行。
- 规范遵循：30/30。简体中文留痕、无凭据落盘。

技术维度综合：96/100。

### 战略维度评分

- 需求匹配：29/30。BookRun 分卷/volume progress 契约已同步给前端和 worker 消费方。
- 架构一致：30/30。沿用 OpenAPI 单一事实源和 generated types。
- 风险评估：27/30。仍需最终阶段跑全量 `pnpm verify`，真实 LLM 长程另行验收。

战略维度综合：95/100。

### 综合评分

```Scoring
score: 96
```

建议：通过。

summary: 'OpenAPI 与 shared generated types 已同步 BookRunVolumeProgress、BookRunProgressUpdate.volume_progress 和 BookRunWorkflowDispatch.volume_plan；生成、字段检索、shared tsc、Prettier、diff check 和敏感扫描均通过。'
## Workflow 恢复预算与历史 completed_chapters 补测与修正

审查时间：2026-06-03 01:34:00 +08:00

### 需求字段完整性

- 目标：补测并修正 workflow 层 existing_checkpoint 恢复预算与历史 completed_chapters 语义。
- 范围：`apps/workflow` 的 BookLoop、BookRun adapter 与三份指定测试。
- 交付物：测试补充、BookLoop checkpoint 输出模型修正、本地验证记录。
- 审查要点：预算不从 0 重新累计；历史 completed_chapters 不丢 `skill_runs`；checkpoint 保留预算摘要供下次恢复。

### 交付物映射

- 代码：`apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
- 测试：`apps/workflow/tests/test_book_loop_resume.py`、`apps/workflow/tests/test_book_run_adapter.py`、`apps/workflow/tests/test_book_run_dispatch_payload.py`
- 文档：`.codex/context-summary-workflow-resume-budget.md`、`.codex/operations-log.md`、`.codex/verification-report.md`

### 依赖与风险评估

- 依赖：pytest、既有 workflow dataclass 与 progress sink，不新增外部依赖。
- 风险：旧历史 checkpoint 若本身缺少预算字段仍按既有逻辑回落 0；本次明确并验证“带预算摘要的 checkpoint 必须在恢复链路中保留并累计”。
- 安全：未读取 `.env`，未输出密钥，未修改 `apps/api` 或 `apps/web`。

### 技术评分

- 代码质量：93/100。修正集中在 `_checkpoint_entry`，复用现有预算累计逻辑。
- 测试覆盖：94/100。覆盖 BookLoop、adapter、dispatch payload 三个恢复边界。
- 规范遵循：92/100。遵循简体中文注释和 pytest 风格，未引入新依赖。

### 战略评分

- 需求匹配：94/100。直接覆盖预算累计、历史 completed_chapters 与 skill_runs 保留。
- 架构一致：93/100。维持 workflow 层端口隔离，不触碰 API ORM。
- 风险评估：90/100。保留历史缺字段回落行为，避免破坏既有旧数据路径。

### 综合结论

- 综合评分：93/100
- 建议：通过
- 审查结论：本地目标测试通过后可交付；无需 API/Web 侧改动。
## P2 长篇上下文 readiness gate 验证报告

生成时间：2026-06-03 02:28:00 +08:00

### 需求字段完整性

- 目标：长篇/分卷 BookRun 不得只靠扩章节数生成 workflow dispatch，必须具备 Story Memory、Character Bible、Timeline、Foreshadow 四类上下文证据。
- 范围：API BookRun dispatch service 与 `test_book_run_workflow_dispatch.py` 回归测试。
- 交付物：`service.py` readiness helper、分卷阻断/放行/单卷不误拦截测试、上下文摘要、操作日志和本报告。
- 审查要点：普通短篇不得被误拦截；真实 LLM 长程不得借此声明完成；不得读取 `.env` 或落盘真实 API Key。

### 覆盖原始意图

- 已覆盖“长篇/分卷必须引入 Story Memory、Character Bible、Timeline Guard 和伏笔回收状态”的 dispatch 前置门禁。
- 已明确当前为 readiness 存在性门禁，不替代真实长篇运行、人工通读或完整质量审查。

### 交付物映射

- 代码：`apps/api/app/domains/book_runs/service.py`
- 测试：`apps/api/tests/test_book_run_workflow_dispatch.py`
- 文档：`.codex/context-summary-p2-longform-readiness-gate.md`
- 日志：`.codex/operations-log.md`

### 依赖与风险评估

- 依赖：复用 Story Memory、Character Bible、Timeline 和 Foreshadow lifecycle 现有服务。
- 风险：Timeline Guard 仍是事件存在性门禁；真实跨卷质量和真实 LLM 长程验收仍未完成。
- 安全：本阶段未读取 `.env`，未写入真实 API Key。

### 本地验证

- `cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：32 passed。
- `cd D:\StoryForge\apps\api; uv run ruff check app/domains/book_runs/service.py tests/test_book_run_workflow_dispatch.py`：All checks passed。

### 评分

- 代码质量：28/30。实现集中在 BookRun service 私有 helper，未引入大框架。
- 测试覆盖：29/30。覆盖缺失阻断、补齐放行、普通单卷不误拦截及相关领域回归。
- 规范遵循：30/30。简体中文留痕完整，TDD 红绿记录完整，未读取 `.env`。
- 需求匹配：29/30。分卷 dispatch 已有四类上下文硬门禁；真实生产质量仍需后续。
- 架构一致：28/30。沿用现有 service/router/test 模式；Timeline Guard 后续仍可细化。
- 风险评估：27/30。明确真实 LLM 和人工通读门禁仍未满足。

```Scoring
score: 93
```

summary: 'P2 长篇上下文 readiness gate 已接入 BookRun workflow dispatch：分卷或显式长篇请求缺 Story Memory、Character Bible、Timeline、Foreshadow 证据时会被阻断，补齐四类证据后可生成 dispatch，普通单卷短篇不受影响。真实外部 LLM 长程验收仍未完成。'

## P2 真实 LLM 长程验收门禁模板验证报告

生成时间：2026-06-03 02:38:00 +08:00

### 需求字段完整性

- 目标：补齐真实 LLM 10 章或 3-5 万字短篇的长程验收门禁清单，避免把 deterministic/mock 或模拟协议测试误报为真实长程完成。
- 范围：`.codex/context-summary-p2-real-llm-gate.md`、本报告、主计划 P2/Phase10/M8-M9 状态。
- 交付物：真实运行证据字段模板、当前未完成声明、敏感信息处理规则。
- 审查要点：默认不运行真实外部 LLM；不读取 `.env`；不写入 API Key、Authorization、Bearer token 或密钥前缀。

### 真实 LLM 长程声明门禁字段

- 脱敏 Provider、脱敏 Base URL 标识、模型名。
- `chapter_count`、`target_word_count`、每章字数范围、实际总字数统计口径。
- `token_budget`、`time_budget_sec`、`chapter_budget`、completion token 上限。
- `tokens_used`、`elapsed_time_sec`、`estimated_cost`、暂停或失败原因。
- `book_run_id`、`markdown_artifact_id`、`audit_artifact_id`、产物路径或下载引用。
- 每章 Judge 分数、平均分、Judge issue 数、Repair rounds、降级或空响应记录。
- 人工通读人、通读时间、通过结论、主要问题、是否允许对外声明。
- 报告、日志、audit、CLI 输出不含密钥的扫描结论。

### 当前证据判定

- deterministic/mock 10 章和 3-5 万字导出已有本地测试证据。
- phase9b 10 章和 3-5 万字参数能力已有本地模拟协议测试。
- 真实外部 LLM 目前只有 1 章和 3 章 smoke 级证据，不能支撑 10 章或 3-5 万字真实长程声明。
- 当前没有真实 10 章或 3-5 万字产物、审计报告、成本统计、质量风险汇总和人工通读结论，因此真实长程验收门禁未满足。

### 本地验证计划

- 文档一致性：检查主计划顶部、Phase10、M8/M9、P2 执行状态措辞一致。
- 敏感信息扫描：扫描 `.codex`、`docs`、触及 API/Web/Workflow 文件中常见密钥模式，不输出真实密钥或密钥前缀。
- 格式检查：运行 `git diff --check`。

### 本地验证结果

- 敏感信息扫描：扫描 `.codex`、`docs`、`apps/api/app/domains/book_runs/service.py`、`apps/api/tests/test_book_run_workflow_dispatch.py` 的常见凭据形态，未命中真实密钥、Authorization、Bearer token 或可复原凭据片段。
- `git diff --check`：通过。
- 计划旧措辞扫描：未发现旧的 deterministic 未完成或长篇门禁未完成表述。
- `cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：32 passed。
- `cd D:\StoryForge\apps\api; uv run ruff check app/domains/book_runs/service.py tests/test_book_run_workflow_dispatch.py`：All checks passed。

### 评分

- 需求匹配：28/30。门禁字段完整，且明确真实长程未完成。
- 架构一致：29/30。沿用 `.codex` 与主计划留痕，不新增运行时机制。
- 安全合规：30/30。未读取 `.env`，未落盘真实凭据。
- 风险评估：29/30。明确 1/3 章 smoke、deterministic、模拟协议测试均不能外推。

```Scoring
score: 94
```

summary: 'P2 真实 LLM 长程验收门禁模板已补齐，明确真实 10 章或 3-5 万字声明必须具备脱敏运行参数、预算与消耗、产物与审计报告、Judge/Repair 风险、人工通读和敏感扫描证据。当前真实长程验收仍未满足，不能宣称完成。'

## Assistant 连续会话参数保留验证报告

生成时间：2026-06-03 03:40:00 +08:00

### 需求字段完整性

- 目标：补齐 Assistant 连续会话上下文不丢失的参数保留缺口，尤其是章节目标 `target_chapter_ordinal` 和产物追溯 `artifact_id`。
- 范围：`apps/web/components/home/HomeComposer.tsx`、`apps/web/components/home/AssistantConversation.tsx`、`apps/web/tests/home-page.test.tsx`、主计划和 `.codex` 留痕。
- 交付物：源码契约测试、GET 降级 hidden input 实现、上下文摘要、操作日志、本报告和主计划状态更新。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不落盘凭据；不得把源码契约测试包装成真实浏览器点击验证。

### 覆盖原始意图

- 已覆盖客户端提交路径：`HomeComposer` 保留 `book_id`、`assistant_session_id`、`book_run_id`、`scene_packet_id`、`repair_patch_id`、`target_chapter_ordinal` 和 `artifact_id`。
- 已覆盖 GET 降级路径：`AssistantConversation` 将服务端 `searchParams` 传入 `HomeComposer`，`HomeComposer` 用同一 `preservedContextQueryKeys` 渲染已有上下文 hidden input。
- 已明确未覆盖范围：本小节只证明源码契约和 GET 降级参数保留；真实浏览器点击、刷新恢复已由后续 `verify:browser-session` 独立验证记录覆盖。

### 交付物映射

- 代码：`apps/web/components/home/HomeComposer.tsx`、`apps/web/components/home/AssistantConversation.tsx`
- 测试：`apps/web/tests/home-page.test.tsx`
- 文档：`.codex/context-summary-assistant-continuous-session.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`

### 依赖与风险评估

- 依赖：Next.js `useSearchParams()`、`useRouter()`、浏览器 `URLSearchParams`；不新增外部依赖。
- 风险：源码契约测试不能证明真实浏览器点击和刷新恢复；该风险已由后续 `verify:browser-session` 独立验证记录关闭。
- 安全：未读取 `.env`，未运行真实外部 LLM；用户后续提供的 provider 信息未复述、未落盘、未使用。

### 本地验证

- 红灯：`pnpm --filter @storyforge/web test -- home-page`：12 passed, 1 failed；失败命中 `AssistantConversation` 未传 `initialSearchParams` 的目标契约。
- 绿灯：`pnpm --filter @storyforge/web test -- home-page`：13 passed。
- 回归：`pnpm --filter @storyforge/web test -- assistant-session-store assistant-chapter-review-actions assistant-artifact-export-actions assistant-book-run-actions`：26 passed。
- 静态检查：`pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- 空白检查：`git diff --check`：通过。
- 敏感信息扫描：触及文件严格凭据形态扫描 0 命中。

### 技术评分

- 代码质量：28/30。改动集中，参数白名单复用于客户端提交和 GET 降级，未引入新依赖。
- 测试覆盖：27/30。TDD 红绿灯和相关 action/store 回归充分；浏览器级 E2E 仍缺。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：92/100。

### 战略评分

- 需求匹配：27/30。连续会话参数保留已补齐；真实浏览器连续会话验证仍待补。
- 架构一致：29/30。沿用 HomeComposer、AssistantConversation、AssistantActionBar 和 HomeSearchParams 既有边界。
- 风险评估：28/30。明确源码契约与浏览器验证边界，后续风险可追踪。

战略维度综合：90/100。

### 综合评分

```Scoring
score: 91
```

建议：通过本轮局部目标；不得声明总计划完成。

summary: 'Assistant 连续会话参数保留已补齐到客户端提交和 GET 降级源码契约层面：HomeComposer 使用统一 preservedContextQueryKeys 保留会话、BookRun、章节、Repair Patch 和 Artifact 上下文，AssistantConversation 传入服务端 searchParams。home-page 13 passed，相关 Assistant 回归 26 passed，web lint、diff check 和敏感扫描通过；真实浏览器点击/刷新恢复已由后续 verify:browser-session 独立验证记录覆盖。'

## Assistant 连续会话浏览器验证报告

生成时间：2026-06-03 03:10:00 +08:00

### 需求字段完整性

- 目标：补齐 Assistant 连续会话的真实浏览器点击和刷新恢复验证，避免仅用源码契约证明浏览器行为。
- 范围：`apps/web/scripts/verify-continuous-session-browser.mjs`、`apps/web/package.json`、`apps/web/tests/home-page.test.tsx`、主计划和 `.codex` 留痕。
- 交付物：可重复浏览器验证脚本、Web package 验证入口、源码契约测试、操作日志、验证报告和主计划状态更新。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 凭据；真实浏览器验证必须有命令、退出码和结果。

### 覆盖原始意图

- 已覆盖真实浏览器打开 Assistant 首页并读取初始上下文 query。
- 已覆盖真实 textarea 输入、submit 按钮点击和客户端 URL 更新。
- 已覆盖提交后 URL 保留 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`artifact_id`。
- 已覆盖刷新后 `HomeComposer` hidden input 恢复上下文。
- 已明确未覆盖范围：真实外部 LLM 长程验收、真实 API 后端会话历史拉取。settings 页专属浏览器交互已由后续 `verify:settings-browser` 独立验证记录覆盖。

### 交付物映射

- 代码：`apps/web/scripts/verify-continuous-session-browser.mjs`
- 配置：`apps/web/package.json`
- 测试：`apps/web/tests/home-page.test.tsx`
- 文档：`.codex/context-summary-assistant-browser-session.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`

### 依赖与风险评估

- 依赖：根 `package.json` 已提供 Playwright；脚本使用 `chromium.launch()` 和本地 Next dev。
- 风险：首页仍会尝试读取最近 Assistant 会话 API，但失败会回退为空列表；脚本未携带 `book_run_id`，不会触发 BookRun 详情读取，不依赖真实 LLM 或 provider。
- 安全：未读取 `.env`，未运行真实外部 LLM，未写入或输出 provider 凭据。

### 本地验证

- 红灯 1：`pnpm --filter @storyforge/web test -- home-page`：13 passed, 1 failed；失败命中缺少浏览器验证脚本。
- 红灯 2：`pnpm --filter @storyforge/web test -- home-page`：13 passed, 1 failed；失败命中缺少 `verify:browser-session` package 入口。
- 调试失败：`pnpm --filter @storyforge/web verify:browser-session` 曾失败于等待 URL、按钮未启用和误跳 `view=projects`；已通过根因定位分别修正等待方式、输入时机和章节审阅 intent。
- 绿灯：`pnpm --filter @storyforge/web verify:browser-session`：通过。
- 回归：`pnpm --filter @storyforge/web test -- home-page`：14 passed。
- 静态检查：`pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- 空白检查：`git diff --check`：通过。
- 敏感信息扫描：触及文件严格凭据形态扫描 0 命中。

### 技术评分

- 代码质量：28/30。脚本范围集中，复用现有 Next dev 启动和清理模式，按钮定位已收窄到 Composer 表单。
- 测试覆盖：29/30。覆盖源码契约、真实浏览器点击、URL 参数保留和刷新后 hidden input；settings 专属浏览器交互由独立 `verify:settings-browser` 覆盖，不与连续会话验证互相替代。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：94/100。

### 战略评分

- 需求匹配：29/30。连续会话浏览器级缺口已关闭；真实外部 LLM 长程仍独立未完成。
- 架构一致：29/30。不引入新测试框架，沿用 Web package `verify:*` 入口和本地脚本模式。
- 风险评估：28/30。明确根 Playwright 依赖和最近会话 API 回退风险，后续可补 settings 浏览器交互。

战略维度综合：93/100。

### 综合评分

```Scoring
score: 94
```

建议：通过本轮局部目标；总计划仍不得声明完成。

summary: 'Assistant 连续会话浏览器验证已补齐：新增 verify-continuous-session-browser.mjs 和 verify:browser-session，真实 Chromium 打开带上下文参数的 Assistant 页面，提交“审阅第二章”后 URL 保留会话、作品、章节和产物追溯参数，刷新后 hidden input 恢复通过。home-page 14 passed，web lint、diff check 和敏感扫描通过。真实外部 LLM 长程验收仍未完成。'

## settings 页浏览器交互验证报告

生成时间：2026-06-03 04:35:00 +08:00

### 需求字段完整性

- 目标：补齐 settings 页专属本地浏览器交互验证，避免仅用源码契约证明 Provider 设置安全边界。
- 范围：`apps/web/scripts/verify-settings-browser.mjs`、`apps/web/package.json`、`apps/web/tests/settings-page.test.ts`、`.codex/context-summary-settings-browser-interaction.md`、主计划和 `.codex` 留痕。
- 交付物：可重复浏览器验证脚本、Web package 验证入口、源码契约测试、上下文摘要、操作日志、本报告和主计划状态更新。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 凭据；不得把本地页面交互包装成真实外部 LLM 长程验收。

### 覆盖原始意图

- 已覆盖真实浏览器打开 `/settings` 页面。
- 已覆盖 Provider Base URL 填写、保存和 `storyforge-provider-settings` localStorage 写入。
- 已覆盖 `/api/provider-models` POST 请求体拦截，断言请求体字段严格为 `baseUrl`，且不含密钥类字段。
- 已覆盖 mock 模型列表返回后的检测结果和模型渲染。
- 已覆盖创作偏好保存到 `storyforge-creative-preferences`，并断言与 Provider 设置分离。
- 已明确未覆盖范围：真实外部 LLM 长程验收、真实供应商 Provider 连通性、真实凭据注入。

### 交付物映射

- 代码：`apps/web/scripts/verify-settings-browser.mjs`
- 配置：`apps/web/package.json`
- 测试：`apps/web/tests/settings-page.test.ts`
- 文档：`.codex/context-summary-settings-browser-interaction.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`

### 依赖与风险评估

- 依赖：根 Playwright 依赖、本地 Next dev、settings 页面客户端表单、`/api/provider-models` 本地 route。
- 风险：脚本启动 Next dev 期间会打印既有 Sentry/Next 警告；这些警告不影响断言和退出码。React hydration 过早点击风险已用条件式重试处理。
- 安全：未读取 `.env`，未运行真实外部 LLM，未写入或输出 provider 凭据；脚本使用非真实示例 Base URL，并通过 `page.route()` mock 本地 API 响应。

### 本地验证

- 红灯：`pnpm --filter @storyforge/web test -- settings-page`：5 passed, 1 failed；失败命中缺少 settings 浏览器验证脚本。
- 调试失败：`pnpm --filter @storyforge/web verify:settings-browser` 曾失败于 localStorage 写入等待；根因是点击发生在 React hydration 可能尚未完成时。
- 绿灯：`pnpm --filter @storyforge/web verify:settings-browser`：通过。
- 回归：`pnpm --filter @storyforge/web test -- settings-page`：6 passed。
- 静态检查：`pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- 空白检查：`git diff --check`：通过。
- 敏感信息扫描：触及文件严格凭据形态扫描 0 命中。

### 技术评分

- 代码质量：28/30。脚本范围集中，复用现有 Next dev 启动和清理模式；Provider 保存使用条件式重试处理 hydration 时序。
- 测试覆盖：29/30。覆盖源码契约、真实浏览器 localStorage、模型检测 POST body、mock 模型渲染和创作偏好分离；不覆盖真实供应商网络连通性。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：94/100。

### 战略评分

- 需求匹配：29/30。settings 页浏览器交互级缺口已关闭；真实外部 LLM 长程仍独立未完成。
- 架构一致：29/30。不引入新测试框架，沿用 Web package `verify:*` 入口和本地脚本模式。
- 风险评估：29/30。明确本地验证、mock API 和真实长程 LLM 边界，敏感字段断言已覆盖 storage 与请求体。

战略维度综合：94/100。

### 综合评分

```Scoring
score: 94
```

建议：通过本轮局部目标；总计划仍不得声明完成。

summary: 'settings 页浏览器交互验证已补齐：新增 verify-settings-browser.mjs 和 verify:settings-browser，真实 Chromium 打开本地 /settings，验证 Provider Base URL 仅以 baseUrl 写入 localStorage，/api/provider-models POST body 不携带密钥类字段，mock 模型列表渲染，并验证创作偏好与 Provider 设置分离。settings-page 6 passed，web lint、diff check 和敏感扫描通过。真实外部 LLM 长程验收仍未完成。'

## P0 首页真实最近记录核验报告

生成时间：2026-06-03 05:15:00 +08:00

### 需求字段完整性

- 目标：核验并回填 P0“接通真实最近记录”，确保首页左侧最近记录从 Assistant 会话 API 读取真实数据，而不是静态伪历史或硬编码空数组。
- 范围：`apps/web/app/page.tsx`、`apps/web/components/home/HomeShell.tsx`、`apps/web/components/home/HomeSidebar.tsx`、`apps/web/components/home/assistant-session-store.ts`、`apps/web/lib/api-client.ts`、Assistant sessions API 和相关测试。
- 交付物：上下文摘要、定向验证结果、主计划 P0 状态回填、操作日志和本报告。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不输出或落盘凭据；不得把最近列表接通包装成完整会话历史恢复。

### 覆盖原始意图

- 已覆盖首页服务端读取 `readRecentAssistantSessions()`。
- 已覆盖最近会话通过统一 `api-client` 读取 `/api/assistant/sessions`，保持 `cache: 'no-store'` 和受控 API header 边界。
- 已覆盖 Assistant session 到 `HomeRecentItem` 的映射：标题、任务类型摘要、`assistant_session_id`、`book_run_id`、`artifact_id`、`blueprint_id`。
- 已覆盖 `HomeShell` 到 `HomeSidebar` 的 props 传递。
- 已覆盖有数据时渲染可追溯链接、无数据或 API 失败时展示真实空状态，不伪造历史。
- 已明确未覆盖范围：没有 `GET /api/assistant/sessions/{id}` 详情端点；没有按 `assistant_session_id` 拉取完整历史消息恢复对话。

### 交付物映射

- 代码证据：`apps/web/app/page.tsx`、`apps/web/components/home/assistant-session-store.ts`、`apps/web/components/home/HomeShell.tsx`、`apps/web/components/home/HomeSidebar.tsx`、`apps/api/app/domains/assistant/router.py`
- 测试证据：`apps/web/tests/home-page.test.tsx`、`apps/web/tests/assistant-session-store.test.ts`、`apps/api/tests/test_assistant_sessions.py`
- 文档证据：`.codex/context-summary-assistant-recent-sessions.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`

### 依赖与风险评估

- 依赖：Next.js Server Component、统一 `api-client`、Assistant sessions API、FastAPI TestClient。
- 风险：列表 API 当前返回完整 `messages`，首页只展示摘要时可能偏重；`HomeSidebar` 用标题作为 key，重复标题时稳定性较弱；API 失败静默为空状态，用户无法区分无记录和读取失败。
- 安全：Assistant session schema 禁止额外敏感字段；测试覆盖敏感载荷拒收；本阶段未读取 `.env`，未运行真实外部 LLM。

### 本地验证

- `pnpm --filter @storyforge/web test -- home-page assistant-session-store`：20 passed。
- `cd apps/api; uv run pytest tests/test_assistant_sessions.py -q`：2 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。

### 技术评分

- 代码质量：28/30。链路使用既有 helper 和 props 传递，不在客户端绕开 API 边界；扣分项为列表 key 使用标题和错误状态不可见。
- 测试覆盖：29/30。覆盖源码契约、helper 映射、API 读取、异常响应、创建/追加会话和敏感字段拒收；未覆盖详情端点和多会话排序边界。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：94/100。

### 战略评分

- 需求匹配：29/30。P0 最近列表展示和追溯链接已满足；完整历史恢复属于独立后续能力。
- 架构一致：29/30。沿用 `api-client`、Assistant session store、HomeShell/HomeSidebar 边界。
- 风险评估：28/30。明确错误空状态、完整 messages、详情 GET 缺口和 key 稳定性风险。

战略维度综合：93/100。

### 综合评分

```Scoring
score: 94
```

建议：通过本轮局部目标；总计划仍不得声明完成。

summary: 'P0 首页真实最近记录已核验完成：HomePage 服务端读取 readRecentAssistantSessions，assistant-session-store 通过统一 api-client 读取 /api/assistant/sessions 并映射为 HomeRecentItem，HomeShell/HomeSidebar 展示真实最近记录链接或空状态。web 最近记录相关测试 20 passed，Assistant sessions API 测试 2 passed，web lint 和 diff check 通过。完整会话历史详情恢复与真实外部 LLM 长程验收仍未完成。'

## P0 Assistant 导出审计链路验证报告

生成时间：2026-06-03 04:23:04 +08:00

### 需求字段完整性

- 目标：完成 Assistant 内导出审计链路，让用户基于 completed BookRun 导出 Markdown、EPUB 和 audit_report.json，并在消息流展示可追溯制品摘要。
- 范围：Assistant 意图解析、导出 server action、AssistantSession 写入摘要、`Artifact.export` 工具节点、BookRun 三类导出 API 测试、主计划和 `.codex` 留痕。
- 交付物：前端 action 实现补强、前端定向测试、后端 API 门禁测试、上下文摘要、操作日志、主计划回填和本报告。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不输出或落盘凭据；不得把本地 completed BookRun 导出链路包装成真实外部 LLM 长程验收。

### 覆盖原始意图

- 已覆盖“导出这次试读的 EPUB 和审计报告”进入 `artifact_export`，并请求 Markdown、EPUB、audit 三类制品。
- 已覆盖 completed BookRun 依次调用 `/exports/markdown`、`/exports/epub`、`/exports/audit-report`。
- 已覆盖非 completed BookRun 前端回流 `not_ready`，不调用导出 API、不写 AssistantSession。
- 已覆盖导出成功摘要包含制品名、`#id`、`v版本`、`BookRun #id` 和“Artifacts 下载摘要可查看”提示。
- 已覆盖 `Artifact.export` 工具节点在 completed 等待导出、非 completed 等待原因、audit_report 证据完成态下的映射。
- 已覆盖后端 running BookRun 调用三类导出 API 返回 400，且 Artifact 数量不增加。
- 已明确未覆盖范围：真实供应商 LLM 调用、真实长程 10 章或 3-5 万字产物、人工通读验收。

### 交付物映射

- 代码：`apps/web/components/home/assistant-artifact-export-actions.ts`
- 测试：`apps/web/tests/assistant-intent.test.ts`、`apps/web/tests/assistant-artifact-export-actions.test.ts`、`apps/web/tests/assistant-tool-node-mapper.test.ts`、`apps/api/tests/test_book_exporter.py`
- 文档：`.codex/context-summary-assistant-artifact-export-p0.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`

### 依赖与风险评估

- 依赖：Next.js Server Actions、统一 BookRun API helper、AssistantSession store、FastAPI BookRun export endpoints、Artifact 服务。
- 风险：导出 action 顺序调用三类导出 API，重复触发可能创建多个 Artifact 版本；本轮未额外调用下载端点，下载摘要为 Artifacts 页面可查看提示。
- 安全：本阶段未读取 `.env`，未运行真实外部 LLM；触及文件敏感扫描 0 命中；用户提供的 provider 信息未被使用、复述或落盘。

### 本地验证

- 红灯：`pnpm --filter @storyforge/web test -- assistant-artifact-export-actions`：4 passed, 2 failed；失败命中摘要缺少版本、BookRun 关联和下载摘要提示。
- 绿灯：`pnpm --filter @storyforge/web test -- assistant-intent assistant-artifact-export-actions assistant-tool-node-mapper`：24 passed。
- API：`cd apps/api; uv run pytest tests/test_book_exporter.py -q`：4 passed。
- 扩展前端定向：`pnpm --filter @storyforge/web test -- assistant-intent assistant-artifact-export-actions assistant-tool-node-mapper book-runs home-page`：40 passed。
- 静态检查：`pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- 空白检查：`git diff --check`：通过。
- 敏感信息扫描：本阶段触及文件按高风险凭据模式扫描 0 命中。

### 技术评分

- 代码质量：28/30。实现范围集中，复用既有导出 action 和 API helper；摘要格式化清晰，未引入额外网络调用。
- 测试覆盖：29/30。覆盖意图、action 成功/失败/非 completed、工具节点、API 层非 completed 门禁和 Artifact 不创建；未覆盖真实下载端点返回内容。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：95/100。

### 战略评分

- 需求匹配：29/30。P0 导出审计链路已满足本地 completed BookRun 闭环；真实外部 LLM 长程仍是独立验收。
- 架构一致：29/30。沿用 Assistant action、BookRun API、Artifacts 和 pytest/node:test 既有边界。
- 风险评估：29/30。明确重复导出版本、下载摘要提示和真实长程边界。

战略维度综合：95/100。

### 综合评分

```Scoring
score: 95
```

建议：通过本轮局部目标；总计划仍不得声明完成。

summary: 'P0 Assistant 导出审计链路已完成本地闭环：意图解析识别导出试读 EPUB 与审计报告，completed BookRun 依次导出 Markdown、EPUB、audit_report.json，成功摘要包含制品名、id、版本、BookRun 关联和 Artifacts 下载摘要提示，非 completed 前端和 API 均拒绝导出且不创建 Artifact。前端定向测试 40 passed，API 导出测试 4 passed，web lint、diff check 和敏感扫描通过。真实外部 LLM 长程验收仍未完成。'

## Phase 0 上下文摘要与验证基线状态回填报告

生成时间：2026-06-03 04:34:37 +08:00

### 需求字段完整性

- 目标：对账主计划 Task 1，将上下文摘要、测试基线、范围与不做事项三项陈旧未勾选状态回填为已完成。
- 范围：`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`、`.codex/operations-log.md`、`.codex/verification-report.md`。
- 交付物：主计划 Task 1 checklist 回填、操作日志、本报告。
- 审查要点：只做文档状态校准；不读取 `.env`；不运行真实外部 LLM；不得把 Phase 0 回填包装成总计划完成。

### 覆盖原始意图

- 已确认 `.codex/context-summary-storyforge-assistant-workflow.md` 包含 7 个相似实现与可复用路径。
- 已确认上下文摘要包含测试策略、项目约定、依赖集成点、风险和不做事项。
- 已确认 `.codex/operations-log.md` 记录 Phase 0 和后续 P0/P1/P2 子任务验证结果。
- 已在主计划 Task 1 下追加 2026-06-03 回填证据。

### 依赖与风险评估

- 依赖：现有 `.codex` 审计文档和权威计划文件。
- 风险：该回填不新增功能能力，不能作为真实外部 LLM 长程验收依据。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息。

### 本地验证

- `git diff --check`：通过。
- 本轮新增段落敏感扫描：0 命中。

### 技术评分

- 文档一致性：29/30。主计划 Task 1 状态与已有上下文摘要、日志和报告对齐。
- 审计完整性：29/30。记录了证据来源、边界和验证方式。
- 规范遵循：30/30。全程简体中文，未读取 `.env`，未运行真实外部 LLM。

技术维度综合：96/100。

### 战略评分

- 需求匹配：28/30。推进总计划可审计性，但不解决真实外部 LLM 长程缺口。
- 架构一致：30/30。不改业务代码，不引入新工具。
- 风险评估：29/30。明确 Phase 0 回填与总计划完成之间的边界。

战略维度综合：95/100。

### 综合评分

```Scoring
score: 96
```

建议：通过本轮文档状态回填；总计划仍不得声明完成。

summary: 'Phase 0 上下文摘要与验证基线状态已回填：主计划 Task 1 三项 checklist 已根据 .codex/context-summary-storyforge-assistant-workflow.md、operations-log 和 verification-report 的现有证据更新为完成，并追加 2026-06-03 回填证据。本轮仅做文档对账，不运行真实外部 LLM，不代表总计划完成。'

## 主计划当前完成度概览状态校准报告

生成时间：2026-06-03 04:44:41 +08:00

### 需求字段完整性

- 目标：修正主计划第 0.2 节的陈旧状态描述，使其与后续 P0/P1/P2 完成证据一致。
- 范围：`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`、`.codex/operations-log.md`、`.codex/verification-report.md`。
- 交付物：主计划 0.2 概览更新、操作日志、本报告。
- 审查要点：只做文档状态校准；不读取 `.env`；不运行真实外部 LLM；不得把本地闭环包装成真实外部 LLM 长程验收。

### 覆盖原始意图

- 已将最近记录从“仍需接线”更新为“已读取真实 Assistant 会话”，并保留缺少详情端点和完整历史恢复的限制。
- 已将章节审阅修复从“仍需继续完成”更新为“已接入 Assistant 对话内编排”，并保留缺少真实作品选择时不伪造默认作品的限制。
- 已将导出审计从“仍需继续完成”更新为“completed BookRun 本地导出闭环已完成”，并保留真实外部 LLM 长程产物未验收限制。
- 已将 Provider/预算从“仍需接到 Assistant 消息流”更新为“已接入工具树和 settings 浏览器验证”，并保留真实供应商连通性和真实外部 LLM 长程限制。
- 0.3 真实外部 LLM 未完成边界保持不变。

### 依赖与风险评估

- 依赖：主计划后续 P0/P1/P2 完成证据、`.codex/verification-report.md` 和 `.codex/operations-log.md`。
- 风险：文档概览更新不能替代业务测试；本轮未新增功能，只减少后续执行误读。
- 安全：未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息。

### 本地验证

- `git diff --check`：通过。
- 本轮新增段落敏感扫描：0 命中。

### 技术评分

- 文档一致性：30/30。0.2 概览与 P0/P1/P2 完成证据对齐。
- 审计完整性：29/30。记录了证据来源、保留限制和验证方式。
- 规范遵循：30/30。全程简体中文，未读取 `.env`，未运行真实外部 LLM。

技术维度综合：97/100。

### 战略评分

- 需求匹配：29/30。推进总计划状态准确性，但不解决真实外部 LLM 长程缺口。
- 架构一致：30/30。不改业务代码，不引入新工具。
- 风险评估：29/30。明确本地闭环与真实长程验收边界。

战略维度综合：96/100。

### 综合评分

```Scoring
score: 97
```

建议：通过本轮文档状态校准；总计划仍不得声明完成。

summary: '主计划当前完成度概览已校准：第 0.2 节不再把最近记录、章节审阅修复、导出审计、Provider/预算描述为仍需接线，而是改为已完成本地闭环并逐项保留限制。0.3 真实外部 LLM 长程未完成边界保持不变。本轮仅做文档对账，不运行真实外部 LLM，不代表总计划完成。'

## Assistant 会话详情恢复验证报告

生成时间：2026-06-03 05:03:38 +08:00

### 需求字段完整性

- 目标：补齐最近记录点击携带 `assistant_session_id` 后，Assistant 能按会话 ID 读取完整历史消息并恢复消息流。
- 范围：Assistant sessions API、前端 session store、AssistantConversation、相关测试、权威计划和 `.codex` 记录。
- 交付物：`GET /api/assistant/sessions/{assistant_session_id}`、`readAssistantSession()`、历史消息映射、缺失会话提示、测试和文档回填。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 信息；不得把本轮局部能力包装成总计划完成。

### 覆盖原始意图

- 已补齐后端详情端点，复用 `get_assistant_session()`，不存在会话时返回 404。
- 已补齐前端详情读取 helper，统一走 `api-client` 和响应类型守卫。
- 已补齐 Assistant 会话历史恢复：最近记录跳回时读取 session messages 并映射到 `AssistantMessageList`。
- 已避免 URL `intent` 与历史用户消息重复展示；详情读取失败时显示可读提示。
- 已修复 lint 发现的 `message` 被推断为 `unknown` 的类型根因。

### 交付物映射

- 代码：`apps/api/app/domains/assistant/router.py`、`apps/web/components/home/assistant-session-store.ts`、`apps/web/components/home/AssistantConversation.tsx`。
- 测试：`apps/api/tests/test_assistant_sessions.py`、`apps/web/tests/assistant-session-store.test.ts`、`apps/web/tests/home-page.test.tsx`。
- 文档：`.codex/context-summary-assistant-session-detail-restore.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。

### 依赖与风险评估

- 依赖：Assistant sessions ORM/service/schema、统一 `api-client`、Next.js App Router Server Component 取数、首页 searchParams 传递。
- 风险：源码契约和本地 API 测试不能替代真实外部 LLM 长程质量验收；未来若会话消息很多，仍需分页或压缩策略。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；高风险凭据模式扫描 0 命中。

### 本地验证

- `pnpm --filter @storyforge/web test -- assistant-session-store home-page`：21 passed。
- `cd apps/api; uv run pytest tests/test_assistant_sessions.py -q`：3 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `git diff --check`：通过。
- 敏感信息扫描：本轮触及 9 个文件按高风险凭据模式扫描 0 命中。

### 技术评分

- 代码质量：29/30。实现复用既有 service、schema、api-client 和消息流组件，改动集中；类型收窄问题已通过 lint 修复。
- 测试覆盖：28/30。覆盖详情读取、404、前端 helper 和 Conversation 源码契约；未新增真实浏览器点击级断言。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：96/100。

### 战略评分

- 需求匹配：29/30。补齐最近记录跳回后的会话历史恢复，直接消除 Phase 5 关键缺口。
- 架构一致：29/30。沿用 Assistant 薄层和首页 Server Component 取数，不新增 Agent 框架或重复状态源。
- 风险评估：29/30。明确本轮能力与真实外部 LLM 长程验收、未来消息分页之间的边界。

战略维度综合：96/100。

### 综合评分

```Scoring
score: 96
```

建议：通过本轮局部目标；总计划仍不得声明完成。

summary: 'Assistant 会话详情恢复已完成本地闭环：后端新增 GET /api/assistant/sessions/{assistant_session_id} 详情端点，前端新增 readAssistantSession() 并在 AssistantConversation 中按 assistant_session_id 恢复历史 messages，同时处理缺失会话提示和重复 intent 展示。Web 定向测试 21 passed，API 测试 3 passed，web lint、git diff --check 和敏感扫描通过。真实外部 LLM 长程验收仍未完成。'

## P2 人工通读门禁审计证据验证报告

生成时间：2026-06-03 05:24:00 +08:00

### 需求字段完整性

- 目标：验证 `manual_read_gate` 能保存到 BookRun progress，并在 `audit_report.json` 中可追溯展示。
- 范围：BookRun progress 更新、BookRun 导出器、audit_report Artifact payload、权威计划和 `.codex` 记录。
- 交付物：本地定向 pytest 证据、`.codex/context-summary-p2-manual-read-gate-evidence.md`、操作日志、本报告和主计划 P2 证据补充。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 信息；不得勾选真实 LLM 长程完成项。

### 覆盖原始意图

- 已确认 `test_patch_book_run_progress_persists_manual_read_gate` 覆盖 `manual_read_gate` 保存和 `awaiting_review` 阻断状态。
- 已确认 `test_book_run_markdown_and_audit_report_exports_artifacts` 覆盖 `audit_report.json` 中的 `manual_read_gate` 投影。
- 已在主计划 P2 完成证据中补充本地门禁回归证据，并明确真实人工通读和真实外部 LLM 长程仍未完成。

### 交付物映射

- 代码证据：`apps/api/app/domains/exports/book_markdown_exporter.py`。
- 测试证据：`apps/api/tests/test_book_runs.py`、`apps/api/tests/test_book_exporter.py`。
- 文档证据：`.codex/context-summary-p2-manual-read-gate-evidence.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。

### 依赖与风险评估

- 依赖：BookRun progress、BookRun export service、Artifacts。
- 风险：fixture 中的人工通读门禁不能替代真实人工通读；本地审计报告投影不能替代真实 LLM 10 章或 3-5 万字长程质量验收。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；高风险凭据模式扫描 0 命中。

### 本地验证

- `cd apps/api; uv run pytest tests/test_book_runs.py::test_patch_book_run_progress_persists_manual_read_gate tests/test_book_exporter.py::test_book_run_markdown_and_audit_report_exports_artifacts -q`：2 passed。
- 首轮敏感信息扫描：相关 4 个文件按高风险凭据模式扫描 0 命中。

### 技术评分

- 代码质量：29/30。复用现有 BookRun progress 与 export service，无新增重复实现；本轮未改业务代码。
- 测试覆盖：28/30。覆盖门禁保存和 audit_report 投影；未覆盖真实人工通读流程，因为该流程需要真实运行与人工证据。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：96/100。

### 战略评分

- 需求匹配：28/30。为真实长程声明门禁补充本地证据闭包，但不完成真实长程验收。
- 架构一致：30/30。沿用 BookRun progress、Artifacts 和 audit_report 既有边界。
- 风险评估：29/30。明确本地 fixture 与真实人工通读、真实外部 LLM 长程之间的边界。

战略维度综合：95/100。

### 综合评分

```Scoring
score: 96
```

建议：通过本轮局部门禁证据闭包；总计划仍不得声明完成。

summary: 'P2 人工通读门禁审计证据已完成本地回归：BookRun progress 可保存 manual_read_gate，audit_report.json 可投影该门禁；定向 pytest 2 passed，已新增 context-summary-p2-manual-read-gate-evidence.md，并更新主计划、operations-log 和 verification-report。本轮未读取 .env，未运行真实外部 LLM；真实 10 章或 3-5 万字长程验收仍未完成。'

## P2 长篇 readiness gate 本地复验报告

生成时间：2026-06-03 05:43:00 +08:00

### 需求字段完整性

- 目标：复验长篇/分卷 dispatch 前必须具备 Story Memory、Character Bible、Timeline、Foreshadow 四类证据。
- 范围：BookRun workflow dispatch、本地领域证据测试、上下文摘要、主计划和 `.codex` 审计记录。
- 交付物：本地 pytest 矩阵结果、`.codex/context-summary-p2-longform-readiness-gate.md` 复验记录、操作日志、本报告和主计划 P2 证据补充。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 信息；不得勾选真实 LLM 长程完成项。

### 覆盖原始意图

- 已复验分卷或显式长篇缺四类证据时，`build_book_run_workflow_dispatch()` 抛 `BookRunBlockedError`。
- 已复验补齐 Story Memory、Character Bible、Timeline、Foreshadow 四类证据后，dispatch payload 可生成。
- 已复验普通单卷短篇不触发长篇门禁，不被误拦截。
- 已复验四类领域证据相关测试：Story Memory、Character Bible、Timeline、Foreshadow lifecycle。

### 交付物映射

- 代码证据：`apps/api/app/domains/book_runs/service.py`。
- 测试证据：`apps/api/tests/test_book_run_workflow_dispatch.py`、`apps/api/tests/test_story_memory_contract.py`、`apps/api/tests/test_character_bible_api.py`、`apps/api/tests/test_timeline_events.py`、`apps/api/tests/test_foreshadow_lifecycle.py`。
- 文档证据：`.codex/context-summary-p2-longform-readiness-gate.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。

### 依赖与风险评估

- 依赖：BookRun service、Story Memory、Character Bible、Timeline、Foreshadow lifecycle。
- 风险：该复验只证明 dispatch 前置门禁和本地域内证据，不代表真实长篇跨卷生产质量，也不代表真实外部 LLM 长程验收。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；高风险凭据模式扫描 0 命中。

### 本地验证

- `cd apps/api; uv run pytest tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_requires_context_readiness tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_passes_after_context_readiness tests/test_book_run_workflow_dispatch.py::test_single_volume_dispatch_does_not_require_longform_context tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：24 passed。
- 首轮敏感信息扫描：相关 3 个文件按高风险凭据模式扫描 0 命中。

### 技术评分

- 代码质量：29/30。复用现有 BookRun dispatch readiness gate 和领域事实源；本轮未改业务代码。
- 测试覆盖：29/30。覆盖缺证据阻断、补齐证据通过、单卷不误拦截和四类领域证据测试；不覆盖真实外部 LLM 生产。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：97/100。

### 战略评分

- 需求匹配：29/30。直接支撑长篇/分卷真实运行前的本地硬门禁复验。
- 架构一致：30/30。门禁仍位于 dispatch payload 生成前，领域事实源边界清晰。
- 风险评估：29/30。明确本地门禁复验与真实长程质量验收之间的边界。

战略维度综合：97/100。

### 综合评分

```Scoring
score: 97
```

建议：通过本轮局部门禁复验；总计划仍不得声明完成。

summary: 'P2 长篇 readiness gate 本地复验已完成：分卷或显式长篇缺 Story Memory、Character Bible、Timeline、Foreshadow 四类证据时 dispatch 被 BookRunBlockedError 阻断，补齐后通过，普通单卷短篇不被误拦截；本地 pytest 矩阵 24 passed，并已更新 context summary、主计划、operations-log 和 verification-report。本轮未读取 .env，未运行真实外部 LLM；真实 10 章或 3-5 万字长程验收仍未完成。'

## P2 phase9b 本地模拟预检验证报告

生成时间：2026-06-03 06:05:00 +08:00

### 需求字段完整性

- 目标：复验 phase9b 真实 LLM smoke 边界的本地模拟协议测试和 CLI 摘要脱敏。
- 范围：phase9b smoke preflight、pytest 内本地模拟 1 章/10 章路径、目标字数、审计制品、CLI 摘要、主计划和 `.codex` 审计记录。
- 交付物：本地 pytest 结果、`.codex/context-summary-p2-real-llm-gate.md` 复验记录、操作日志、本报告和主计划 P2 证据补充。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 信息；不得勾选真实 LLM 长程完成项。

### 覆盖原始意图

- 已复验缺少私有运行配置时 preflight 阻止。
- 已复验 pytest 内本地 HTTP 模拟服务覆盖 1 章路径并生成 BookRun、Markdown artifact 和 audit artifact。
- 已复验 pytest 内本地 HTTP 模拟服务覆盖 10 章路径、目标字数和章节字数范围。
- 已复验 CLI 摘要输出保持脱敏，不输出高风险凭据字段值。
- 已在主计划 P2 完成证据中补充本地模拟预检结果，并明确真实外部 LLM 长程仍未完成。

### 交付物映射

- 代码证据：`apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`。
- 测试证据：`apps/api/tests/test_phase9b_real_llm_smoke.py`。
- 文档证据：`.codex/context-summary-p2-real-llm-gate.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。

### 依赖与风险评估

- 依赖：BookRun、Blueprint、ModelRun、Scene、Book export、phase9b smoke runner 和 pytest 内本地模拟服务。
- 风险：本地模拟协议测试不能替代真实供应商响应、真实中文质量、真实成本统计或真实人工通读。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；新写文档高风险凭据模式扫描 0 命中。

### 本地验证

- `cd apps/api; uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：7 passed。
- 首轮敏感信息扫描：新写上下文摘要按高风险凭据模式扫描 0 命中。

### 技术评分

- 代码质量：29/30。复用现有 phase9b smoke runner 和 pytest 本地模拟服务；本轮未改业务代码。
- 测试覆盖：29/30。覆盖 preflight、1 章、10 章、目标字数、审计制品和 CLI 摘要脱敏；不覆盖真实外部 LLM。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：97/100。

### 战略评分

- 需求匹配：28/30。加固真实 LLM 长程前的本地协议和脱敏门禁，但不完成真实长程验收。
- 架构一致：30/30。沿用 phase9b runner、BookRun 和 export 既有边界。
- 风险评估：29/30。明确模拟预检与真实长程验收之间的边界。

战略维度综合：96/100。

### 综合评分

```Scoring
score: 97
```

建议：通过本轮本地模拟预检；总计划仍不得声明完成。

summary: 'P2 phase9b 本地模拟预检已完成：pytest 内本地 HTTP 模拟协议覆盖缺配置 preflight、1 章和 10 章路径、目标字数、Markdown/audit artifact 生成和 CLI 摘要脱敏；测试 7 passed，并已更新 context summary、主计划、operations-log 和 verification-report。本轮未读取 .env，未运行真实外部 LLM；真实 10 章或 3-5 万字长程验收仍未完成。'

## 本地核心门禁快照验证报告

生成时间：2026-06-03 06:35:00 +08:00

### 需求字段完整性

- 目标：运行根目录 `pnpm verify`，获取本地 Web/API/Workflow/OpenAPI 核心门禁的新鲜证据。
- 范围：根 lint、Web 类型检查、Shared 契约测试、Web 契约测试、API pytest/Ruff、Workflow pytest/Ruff、OpenAPI 契约刷新与漂移检查。
- 交付物：`pnpm verify` 结果、`.codex/context-summary-local-core-gate-snapshot.md`、操作日志、本报告和主计划当前完成度更新。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 信息；不得把本地核心门禁通过包装成真实 LLM 长程完成。

### 覆盖原始意图

- 已修复首次核心门禁暴露的浏览器验证脚本 lint 环境问题和 Prettier 格式问题。
- 已刷新 OpenAPI 契约并同步 shared generated types，解决 OpenAPI digest 漂移。
- 已重新运行完整 `pnpm verify` 并通过所有核心门禁。
- 已在主计划中更新最新本地核心门禁快照。

### 交付物映射

- 代码/配置：`eslint.config.mjs`、`apps/web/scripts/verify-continuous-session-browser.mjs`。
- 格式化：`apps/web/tests/home-page.test.tsx`、`apps/web/tests/settings-page.test.ts`。
- 契约：`packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`。
- 文档：`.codex/context-summary-local-core-gate-snapshot.md`、`.codex/operations-log.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。

### 依赖与风险评估

- 依赖：pnpm、uv、pytest、Ruff、ESLint、Prettier、OpenAPI 生成脚本、openapi-typescript。
- 风险：本地核心门禁不包含真实外部 LLM 长程验收；API 测试存在 6 条警告，未阻断本轮门禁，但后续可单独清理。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；相关文件高风险凭据模式扫描 0 命中。

### 本地验证

- `pnpm run lint`：通过。
- `pnpm --filter @storyforge/shared generate:types`：通过。
- `pnpm verify`：通过。
- `pnpm verify` 关键结果：
  - Web 契约测试：209 passed。
  - API 单元测试：376 passed，6 warnings。
  - Workflow 单元测试：164 passed。
  - API/Workflow Ruff：通过。
  - OpenAPI 契约刷新后无漂移。
- 敏感信息扫描：6 个相关文件按高风险凭据模式扫描 0 命中。

### 技术评分

- 代码质量：29/30。修复集中在 lint 环境声明和无用参数清理，未改变浏览器验证行为。
- 测试覆盖：30/30。本地核心门禁完整通过，覆盖 Web/API/Workflow/OpenAPI。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：98/100。

### 战略评分

- 需求匹配：29/30。为当前计划提供最新本地核心门禁快照；真实 LLM 长程仍是独立未完成项。
- 架构一致：30/30。复用根 verify 和既有 OpenAPI/shared 类型生成流程。
- 风险评估：29/30。明确本地门禁与真实长程验收边界，并记录 API warnings。

战略维度综合：97/100。

### 综合评分

```Scoring
score: 98
```

建议：通过本轮本地核心门禁快照；总计划仍不得声明完成。

summary: '本地核心门禁快照已完成：修复浏览器验证脚本 lint 环境和格式问题，刷新 OpenAPI 契约与 shared generated types 后，pnpm verify 通过；Web 契约测试 209 passed，API 376 passed（6 warnings），Workflow 164 passed，API/Workflow Ruff 和 OpenAPI 漂移检查均通过。本轮未读取 .env，未运行真实外部 LLM；真实 10 章或 3-5 万字长程验收仍未完成。'

## 本地浏览器与 E2E 门禁复验报告

生成时间：2026-06-03 06:10:00 +08:00

### 需求字段完整性

- 目标：补齐并复验 Assistant 连续会话真实浏览器点击/刷新恢复、settings 页浏览器交互和根 E2E 合约门禁的新鲜证据。
- 范围：`home-page` 源码契约、`verify:browser-session`、`verify:settings-browser`、Web TypeScript lint、`pnpm e2e`、`git diff --check`。
- 交付物：`apps/web/scripts/verify-continuous-session-browser.mjs` 竞态修复、`apps/web/tests/home-page.test.tsx` 契约补强、`.codex/context-summary-local-e2e-browser-gate.md`、操作日志、本报告和主计划证据回填。
- 审查要点：不读取 `.env`；不运行真实外部 LLM；不使用、复述或落盘 provider 信息；不得把本地浏览器和 E2E 验证包装成真实 LLM 长程完成。

### 覆盖原始意图

- 已对账权威计划和 `.codex` 历史记录，确认早期“浏览器连续会话仍待补”的句子属于历史过程记录，后续已被独立验证覆盖。
- 已确认 `HomeComposer` 保留 `target_chapter_ordinal` 和 `artifact_id`，GET 降级表单也按同一白名单保留上下文。
- 已复现并修复真实 Chromium 下连续会话脚本提交按钮 disabled 竞态。
- 已用源码契约锁住浏览器脚本的水合后重试提交路径，避免未来退化为“观察可点但真实点击失败”。
- 已重新运行连续会话和 settings 浏览器脚本，并运行根 `pnpm e2e`。
- 已更新主计划，明确本轮只是本地浏览器/E2E 复验，不代表真实外部 LLM 长程验收。

### 交付物映射

- 代码：`apps/web/scripts/verify-continuous-session-browser.mjs`。
- 测试：`apps/web/tests/home-page.test.tsx`。
- 文档：`.codex/context-summary-local-e2e-browser-gate.md`、`.codex/operations-log.md`、`.codex/verification-report.md`、`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。
- 复验命令：`pnpm --filter @storyforge/web test -- home-page`、`pnpm --filter @storyforge/web verify:browser-session`、`pnpm --filter @storyforge/web verify:settings-browser`、`pnpm --filter @storyforge/web lint`、`pnpm e2e`、`git diff --check`。

### 依赖与风险评估

- 依赖：Playwright、Next.js dev server、Web TypeScript、OpenAPI 生成、API pytest、Workflow pytest。
- 风险：浏览器脚本启动 Next dev 时仍会输出 Sentry 配置警告；这些 warning 未阻断本地验证，但后续可单独清理。
- 风险：`verify:browser-session` 只显式覆盖 `assistant_session_id`、`book_id`、`target_chapter_ordinal` 和 `artifact_id`；其余上下文参数由源码白名单和 GET hidden input 契约覆盖。
- 安全：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；后续仍需敏感扫描作为最终收尾门禁。

### 本地验证

- 红灯 1：`pnpm --filter @storyforge/web verify:browser-session` 失败，Playwright 点击提交按钮超时，按钮仍为 disabled。
- 红灯 2：`pnpm --filter @storyforge/web test -- home-page` 13 passed、1 failed；失败命中缺少 `submitIntentAfterHydration` 和 `lastClickError` 的脚本契约。
- 绿灯：`pnpm --filter @storyforge/web test -- home-page` 14 passed。
- 绿灯：`pnpm --filter @storyforge/web verify:browser-session` 通过；真实 Chromium 提交后 URL 保留 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`artifact_id` 和 `intent`，刷新后 hidden input 恢复通过。
- 绿灯：`pnpm --filter @storyforge/web verify:settings-browser` 通过。
- 绿灯：`pnpm --filter @storyforge/web lint` 通过。
- 绿灯：`pnpm e2e` 通过；OpenAPI refresh/drift passed，Node 合约 28 passed，API verification 59 passed，Workflow verification 37 passed。
- 绿灯：`git diff --check` 通过。

### 技术评分

- 代码质量：29/30。修复集中在验证脚本水合竞态，逻辑保持单一职责；失败诊断包含最后状态和点击错误。
- 测试覆盖：30/30。包含 TDD 红灯、真实浏览器复验、settings 浏览器复验、Web 类型检查和根 E2E 合约。
- 规范遵循：30/30。全程简体中文留痕，未读取 `.env`，未运行真实外部 LLM，未落盘凭据。

技术维度综合：99/100。

### 战略评分

- 需求匹配：30/30。直接覆盖“浏览器级连续会话验证 / Assistant 会话上下文不丢失”的关键缺口，并补充 E2E 复验证据。
- 架构一致：30/30。复用既有 Web 包浏览器脚本和根 E2E 门禁，没有新增测试框架。
- 风险评估：29/30。已明确本地浏览器/E2E 与真实 LLM 长程验收边界；Sentry warning 作为非阻断后续清理项保留。

战略维度综合：99/100。

### 综合评分

```Scoring
score: 99
```

建议：通过本轮本地浏览器与 E2E 门禁复验；总计划仍不得声明完成，真实外部 LLM 10 章或 3-5 万字长程验收继续保持未完成。

summary: '本地浏览器与 E2E 门禁复验已完成：修复 verify-continuous-session-browser.mjs 在真实 Chromium 中因 React 水合导致按钮 disabled 的竞态，补 home-page 源码契约，复验 verify:browser-session、verify:settings-browser、Web lint、pnpm e2e 和 git diff --check 均通过。连续会话点击/刷新恢复与 settings 本地浏览器交互有新鲜本地证据；本轮未读取 .env，未运行真实外部 LLM；真实 10 章或 3-5 万字长程验收仍未完成。'
