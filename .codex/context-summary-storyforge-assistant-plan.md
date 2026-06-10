## 项目上下文摘要（StoryForge Assistant 计划补齐）

生成时间：2026-06-10 08:48:09 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/assistant/models.py:17`
  - 模式：`AssistantSession` 聚合 `AssistantMessage` 与 `AssistantToolCall`，后端数据库作为会话与工具事实源。
  - 可复用：`AssistantToolCall`、`AssistantSession.tool_calls`。
  - 需注意：只保存摘要和业务关联，不保存 Provider 凭据或大 payload。
- **实现2**: `apps/api/app/domains/assistant/service.py:23`
  - 模式：Assistant 域保持 model/schema/service/router 分层，service 负责事务和存在性校验。
  - 可复用：`create_assistant_tool_call`、`list_assistant_tool_calls`、`get_assistant_session`。
  - 需注意：不存在的 session/tool call 必须返回明确 404。
- **实现3**: `apps/web/components/home/assistant-session-store.ts:284`
  - 模式：前端 API helper 统一通过 `readJson`/`postAssistantJson` 和 type guard 校验后端响应。
  - 可复用：`createAssistantToolCall`、`AssistantToolCallCreate`、`AssistantToolCallRead`。
  - 需注意：API JSON 字段保持 snake_case，TypeScript 调用侧保持 camelCase。
- **实现4**: `apps/web/components/home/assistant-tool-node-mapper.ts:21`
  - 模式：工具树优先消费 `AssistantToolCall`，没有事实源时才从 BookRun 推导。
  - 可复用：`mapAssistantToolCallsToAssistantToolNodes`、`mapBookRunToAssistantToolNodes`。
  - 需注意：前端不能伪造 running/completed 状态，Provider 不可用时必须展示失败。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case 字段与 PascalCase ORM/schema 类；TypeScript helper 使用 camelCase，类型使用 PascalCase。
- **文件组织**: API 领域按 `models.py`、`schemas.py`、`service.py`、`router.py` 分层；Web 首页 Assistant 代码集中在 `apps/web/components/home/`。
- **导入顺序**: 先外部库，再项目内部模块；类型导入可与函数导入同源合并。
- **代码风格**: Web 测试使用 Node 内置 `node:test` 与 `assert`；Server Action 通过依赖注入测试 `apiFetch`、`redirect`、`revalidatePath`。

### 3. 可复用组件清单

- `apps/web/components/home/assistant-session-store.ts`: Assistant session/tool call API helper。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: tool call 与 BookRun 到工具节点映射。
- `apps/web/components/home/assistant-book-run-actions.ts`: BookRun 控制 action 的依赖注入测试模式。
- `apps/web/components/home/assistant-chapter-review-actions.ts`: chapter review action 的错误回流与摘要压缩模式。
- `apps/web/components/home/assistant-artifact-export-actions.ts`: artifact export action 的批量导出与 tool call 写入模式。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 单测临时转译脚本，新 runtime 模块需要加入映射。

### 4. 测试策略

- **测试框架**: Web 使用 `node --test`，由 `apps/web/scripts/phase1-contract-test.mjs` 转译 TypeScript 后执行。
- **测试模式**: 先写源代码约束测试证明重复写入未被收敛，再抽共享适配器；保留三个 action 的行为回归测试。
- **参考文件**:
  - `apps/web/tests/assistant-book-run-actions.test.ts`
  - `apps/web/tests/assistant-chapter-review-actions.test.ts`
  - `apps/web/tests/assistant-artifact-export-actions.test.ts`
  - `apps/web/tests/assistant-tool-node-mapper.test.ts`
- **覆盖要求**: 成功路径、失败路径、缺少上下文路径、已有会话和新建会话回传 AssistantSession ID。

### 5. 依赖和集成点

- **外部依赖**: Next.js Server Actions、`redirect`、`revalidatePath`；Context7 官方文档确认 Server Action 可导入普通工具模块并在 mutation 后 revalidate + redirect。
- **内部依赖**: 三个 Assistant action 依赖 `createAssistantToolCall` 的后端契约；本次收束为共享 `assistant-tools/tool-call-writer.ts`。
- **集成方式**: Server Action 保持现有表单入口和 redirect URL 协议，默认 writer 统一调用后端 `/api/assistant/sessions/{id}/tool-calls`。
- **配置来源**: `apps/web/package.json` 的 `test` 和 `lint` 脚本；根 `package.json` 的 `pnpm --filter @storyforge/web` 命令。

### 6. 技术选型理由

- **为什么用这个方案**: 文档 Phase 2 要求统一现有前端 actions，但当前 Phase 0/1 已实现；最小可靠改动是抽共享 tool call writer，保留现有 action 外部行为。
- **优势**: 删除三处重复的 tool call payload 转换逻辑，后续扩展 `AssistantToolRegistry/ToolExecutor` 时只需替换一个适配点。
- **劣势和风险**: 仍停留在前端 Server Action 层，尚未实现后端 orchestrator、权限策略和 LLM intent；这些属于文档后续 Phase 3-5。

### 7. 关键风险点

- **并发问题**: 三个 action 仍各自执行真实 API 和 session 写入，本次没有引入共享状态。
- **边界条件**: invalid 参数、缺少 book/scene packet、API 失败时不得写成功 tool call；现有测试覆盖这些路径。
- **性能瓶颈**: 新共享 writer 不增加额外 API 调用，只替换原有重复逻辑。
- **安全考虑**: tool call 只写摘要字段，不接收或传递 Provider 密钥；后端 schema 已禁止额外敏感字段。

### 8. 外部资料与用途

- Context7 `/vercel/next.js`: 确认 Server Action 可使用 `'use server'`、普通工具模块导入、`revalidatePath` 后 `redirect` 的官方模式。
- GitHub `search_code`: 搜索 Next.js Server Action 开源用法，结论是常见实践为 action 调用共享 helper 后统一 redirect/revalidate，本次没有引入第三方代码。
