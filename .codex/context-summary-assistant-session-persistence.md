## 项目上下文摘要（Assistant 审阅/导出持久回流缺口）

生成时间：2026-06-02 21:54:40 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-chapter-review-actions.ts`
  - 模式：章节审阅 Server Action 调用 Studio 相关接口后，通过 `URLSearchParams` 构造 `chapter_review_status`、`chapter_review_summary`、`repair_patch_id` 等 query 参数，再 redirect 回首页。
  - 可复用：已有参数读取、摘要截断和错误回流模式。
  - 缺口：审阅结果只作为当前跳转的临时 query 状态进入 Assistant 对话，不会写入 `AssistantSession`。
- **实现2**: `apps/web/components/home/assistant-artifact-export-actions.ts`
  - 模式：导出 Markdown、EPUB、审计报告后，通过 `artifact_export_status`、`artifact_export_summary`、`artifact_export_error` 等 query 参数回流。
  - 可复用：导出完成摘要和失败摘要的短消息组织。
  - 缺口：导出交付物摘要只存在于 URL 回流链路，未持久写入 Assistant 会话。
- **实现3**: `apps/web/app/studio/approval-action-core.ts`
  - 模式：Studio 批准写回通过 `buildApprovalResultUrl` 写入 `writeback_status`、`approved_chapter_id`、`unavailable_reason` 等 query 参数。
  - 可复用：批准写回结果字段和目标页面参数构造。
  - 缺口：批准写回状态当前主要服务页面跳转展示，未形成 AssistantSession 的可追溯消息。
- **实现4**: `apps/web/components/home/assistant-book-run-actions.ts`
  - 模式：BookRun 暂停、恢复、停止、重试命令在成功后调用 `createAssistantSession` 或 `appendAssistantSessionMessage`，持久记录 `book_run_id`、`blueprint_id` 和命令消息。
  - 可复用：`writeAssistantBookRunSession` 的最小写入边界、成功后 `revalidatePath('/')` 再 redirect 的顺序。
  - 需注意：这是当前已闭环的持久写回参照。
- **实现5**: `apps/web/components/home/assistant-session-store.ts`
  - 模式：封装 `/api/assistant/sessions` 创建、追加消息、读取最近会话，并映射为首页最近记录。
  - 可复用：`createAssistantSession`、`appendAssistantSessionMessage`、响应校验和最近记录映射。
  - 需注意：后端字段使用 snake_case，前端 helper 已处理 API 调用和结果校验。
- **实现6**: `apps/api/app/domains/assistant/router.py`
  - 模式：后端已提供 `POST /api/assistant/sessions`、`GET /api/assistant/sessions`、`POST /api/assistant/sessions/{assistant_session_id}/messages`。
  - 可复用：现有 AssistantSession API，不需要新增后端路由。
  - 需注意：服务层和测试包含敏感 payload key 拒绝逻辑。

### 2. 项目约定

- **命名约定**: TypeScript 函数和变量使用 camelCase，类型使用 PascalCase；后端 Python 函数和字段使用 snake_case。
- **文件组织**: 首页 Assistant action/helper 位于 `apps/web/components/home/`；Studio action 位于 `apps/web/app/studio/`；Assistant 后端 API 位于 `apps/api/app/domains/assistant/`。
- **导入顺序**: 测试优先 Node 内置模块，业务文件先框架或本地 API helper，再导入类型。
- **代码风格**: 两空格 TypeScript、中文用户可见文案；Python 测试使用 plain assert 和中文 docstring 风格。

### 3. 可复用组件清单

- `apps/web/components/home/assistant-session-store.ts`: `createAssistantSession`、`appendAssistantSessionMessage`、`readRecentAssistantSessions`。
- `apps/web/components/home/assistant-book-run-actions.ts`: `writeAssistantBookRunSession` 作为持久写回最小参照。
- `apps/web/components/home/assistant-chapter-review-actions.ts`: 章节审阅临时回流字段来源。
- `apps/web/components/home/assistant-artifact-export-actions.ts`: 导出交付物临时回流字段来源。
- `apps/web/app/studio/approval-action-core.ts`: Studio 批准写回临时回流字段来源。
- `apps/api/app/domains/assistant/router.py`: AssistantSession 后端 API 入口。
- `apps/api/app/domains/assistant/service.py`: AssistantSession 创建、追加、读取服务。
- `apps/api/app/domains/assistant/models.py`: `AssistantSession` 与 `AssistantMessage` 持久化模型。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` 和 `node:assert/strict`；API 使用 pytest。
- **参考文件**:
  - `apps/web/tests/assistant-book-run-actions.test.ts`
  - `apps/web/tests/assistant-session-store.test.ts`
  - `apps/web/tests/assistant-chapter-review-actions.test.ts`
  - `apps/web/tests/assistant-artifact-export-actions.test.ts`
  - `apps/web/tests/studio.test.tsx`
  - `apps/api/tests/test_assistant_sessions.py`
- **下一阶段覆盖建议**: 为章节审阅、导出、Studio 批准写回分别增加“成功后写 AssistantSession 或追加消息”的测试，并保留失败路径不写会话的断言。

### 5. 依赖和集成点

- **外部依赖**: Next.js Server Action 的 `redirect` 与 `revalidatePath`。Context7 查询 `/vercel/next.js` 文档确认：数据变更后如需新鲜数据，应在 `redirect` 前调用 `revalidatePath` 或同类缓存刷新函数；`redirect` 是框架控制流。
- **内部依赖**: `apiFetch`、AssistantSession helper、章节审阅 action、导出 action、Studio approval action。
- **集成方式**: 当前缺口不要求新增后端；下一阶段最小实现应在对应 Server Action 成功副作用完成后调用既有 AssistantSession helper。
- **配置来源**: 不新增配置；不得读取或写入 `.env`、API Key 或凭据。

### 6. 技术选型理由

- **为什么用这个方案**: 后端 AssistantSession API 和前端 helper 已存在，BookRun 命令已证明该路径可用；审阅、导出、批准写回只缺少同类持久写入调用。
- **优势**: 最小写集可集中在前端 action/helper 测试层，复用现有 API 契约，不扩展数据库或路由。
- **劣势和风险**: URL query 与持久会话并存期间可能出现重复消息、旧参数刷新重复展示、失败路径误写会话等风险，需要测试约束。

### 7. 关键风险点

- **数据一致性**: 临时 URL 参数不是长期事实源，刷新、分享或二次跳转可能丢失上下文。
- **可追溯性**: 章节审阅、导出交付物、Studio 批准写回缺少 AssistantSession 消息后，最近记录无法还原这些行动。
- **重复写入**: 若直接在渲染层根据 query 写会话，可能因刷新重复写入；应只在 Server Action 成功路径写。
- **安全考虑**: 持久消息只能写入短摘要、业务 ID 和状态，不应写入正文、补丁全文、导出内容、API Key 或任何凭据。
- **性能影响**: 每次成功动作新增一次轻量 API 写入；需避免在失败、无效参数或重复渲染路径中写入。

### 8. 下一阶段最小写集建议

- `apps/web/components/home/assistant-chapter-review-actions.ts`: 成功 ready 后写入或追加章节审阅摘要消息。
- `apps/web/components/home/assistant-artifact-export-actions.ts`: 成功导出后写入或追加交付物摘要消息。
- `apps/web/app/studio/approval-action-core.ts`: 批准写回成功后写入或追加写回状态消息。
- `apps/web/tests/assistant-chapter-review-actions.test.ts`: 覆盖审阅成功写会话、失败不写会话。
- `apps/web/tests/assistant-artifact-export-actions.test.ts`: 覆盖导出成功写会话、未完成或失败不写会话。
- `apps/web/tests/studio.test.tsx`: 覆盖批准写回成功写会话、API 失败不写会话。

### 9. 外部参考记录

- Context7：查询 `/vercel/next.js`，用途是确认 Server Action 中 `redirect` 与 `revalidatePath` 的顺序语义。
- GitHub `search_code`：查询 `URLSearchParams redirect server action revalidatePath language:TypeScript`，用途是确认该类临时跳转状态在社区实践中常见；本任务最终以仓库内实现为事实依据。
