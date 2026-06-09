# Phase 1 AssistantToolCall 事实源验证报告

生成时间：2026-06-09 22:08:00 +08:00

## 1. 需求字段完整性

- **目标**：新增 Assistant tool call 事实源，使工具树不再只依赖 BookRun 推导。
- **范围**：后端 ORM/schema/service/router/API/迁移；前端 tool call helper 与 mapper；BookRun 控制、章节审阅、产物导出 action 写入 tool call。
- **交付物**：代码、测试、OpenAPI JSON、generated api-types、上下文摘要、操作日志、本报告。
- **审查要点**：可追溯、可重放、不保存敏感凭据、保留 BookRun 兜底、失败路径不写脏会话。

## 2. 交付物映射

- `apps/api/app/domains/assistant/models.py`：新增 `AssistantToolCall` ORM 和 `AssistantSession.tool_calls`。
- `apps/api/app/domains/assistant/schemas.py`：新增 create/update/read schema，`extra=forbid`。
- `apps/api/app/domains/assistant/service.py`：新增创建、更新、列表读取 service。
- `apps/api/app/domains/assistant/router.py`：新增 POST/GET/PATCH tool call API。
- `apps/api/alembic/versions/20260609_0002_add_assistant_tool_calls.py`：新增迁移。
- `apps/web/components/home/assistant-session-store.ts`：新增 read/create/update tool call helper。
- `apps/web/components/home/assistant-tool-node-mapper.ts`：新增 tool call 到工具树节点映射。
- `apps/web/components/home/AssistantConversation.tsx`：tool calls 优先，BookRun 推导兜底。
- 三个 action 文件：成功写 `completed`，已有会话下失败写 `failed`。
## 3. 本地验证结果

- `cd apps/api && uv run pytest tests/test_assistant_tool_calls.py tests/test_assistant_sessions_migration.py`：6/6 passed，退出码 0。
- `pnpm --filter @storyforge/web test -- assistant-tool-node-mapper.test.ts assistant-session-store.test.ts assistant-book-run-actions.test.ts assistant-chapter-review-actions.test.ts assistant-artifact-export-actions.test.ts`：42/42 passed，退出码 0。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过，退出码 0。
- `pnpm --filter @storyforge/shared test`：`tsc --noEmit` 通过，退出码 0。
- `cd apps/api && uv run ruff check app tests/test_assistant_tool_calls.py tests/test_assistant_sessions_migration.py`：All checks passed，退出码 0。
- `pnpm run openapi`：OpenAPI JSON 生成成功，退出码 0。
- `pnpm --filter @storyforge/shared generate:types`：`api-types.ts` 生成成功，退出码 0。
- `git diff --check -- <本轮相关文件>`：无空白错误，退出码 0。

## 4. 风险与补偿

- **SQLite 时区细节**：内存 SQLite 不保留 `DateTime(timezone=True)` 原始偏移；测试改为验证时间被保存并返回，不把 SQLite 当作时区保真验证。
- **tool call 写入失败策略**：成功业务动作若审计写入失败，会沿用现有 failed redirect，不伪造成功；这是 Phase 1 可审计优先策略。
- **读取 tool call 失败兜底**：前端读取 tool calls 失败时继续使用 BookRun 推导，避免工具树消失。
- **子代理审查**：当前多代理工具规则要求用户明确要求委派才可 spawn；本轮未调用子代理，改用本地 sequential-thinking 审查并记录原因。

## 5. 评分

- **代码质量**：92/100。沿用现有 assistant 域薄层和前端 helper 模式，未引入过度 orchestrator。
- **测试覆盖**：93/100。覆盖后端 API、迁移、前端 helper、mapper、action 成功/失败/invalid 路径。
- **规范遵循**：91/100。完成上下文摘要、操作日志、TDD 红绿、OpenAPI 与 generated types 同步。
- **需求匹配**：92/100。完整覆盖 Phase 1，不越界到 Phase 2/3。
- **架构一致**：92/100。保持 `AssistantSession -> AssistantToolCall` 会话事实源边界，BookRun 推导继续作为补充事实。
- **风险评估**：91/100。主要风险已记录并通过本地验证覆盖。

## 6. 结论

综合评分：92/100。

明确建议：通过。

审查结论已留痕，时间戳：2026-06-09 22:08:00 +08:00。