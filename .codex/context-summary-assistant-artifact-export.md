## 项目上下文摘要（Assistant 导出失败回流）

生成时间：2026-06-02 18:08:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-book-run-actions.ts`
  - 模式：Server Action 读取表单参数，调用统一 API client，失败时通过 `redirect` 回流 query 状态。
  - 可复用：`URLSearchParams` 组织结果 URL、API 非成功状态转为用户可见失败消息。
  - 需注意：失败路径不刷新首页缓存。
- **实现2**: `apps/web/components/home/AssistantConversation.tsx`
  - 模式：从首页 `searchParams` 读取状态，映射为 Assistant 消息。
  - 可复用：`firstParam`、`readPositiveInt`、`chapterReviewMessageFor` 的 failed 消息结构。
  - 需注意：不能伪造 completed 状态，只能展示真实 BookRun 状态。
- **实现3**: `apps/web/components/home/AssistantActionBar.tsx`
  - 模式：根据上游传入 ID 与状态计算按钮 `disabled` 和 `title`。
  - 可复用：已有 `disabledReason`、章节审阅和写回按钮禁用文案。
  - 需注意：导出按钮需要区分无 BookRun、未读取状态、非 completed 三类原因。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，函数和局部变量使用 camelCase。
- **文件组织**: 首页 Assistant 能力集中在 `apps/web/components/home/`，测试集中在 `apps/web/tests/`。
- **导入顺序**: 先框架/外部模块，再内部模块，类型以 `type` 导入。
- **代码风格**: TypeScript、2 空格缩进、Prettier 格式化、用户可见文案使用简体中文。

### 3. 可复用组件清单

- `apps/web/app/book-runs/api.ts`: `exportMarkdownRequest`、`exportEpubRequest`、`exportAuditReportRequest`、`readBookRun`。
- `apps/web/lib/api-client.ts`: `apiFetch` 统一 API 调用。
- `apps/web/components/home/assistant-book-run-actions.ts`: 失败 redirect 回流模式。
- `apps/web/components/home/AssistantConversation.tsx`: query 状态到消息的映射入口。
- `apps/web/components/home/AssistantActionBar.tsx`: Assistant 流程操作按钮。

### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`，由 `apps/web/scripts/phase1-contract-test.mjs` 编译运行。
- **测试模式**: Server Action 通过 mock `apiFetch`、`readBookRun`、`redirect` 做单元级验证；首页契约通过源码字符串断言保护集成点。
- **参考文件**: `apps/web/tests/assistant-artifact-export-actions.test.ts`、`apps/web/tests/home-page.test.tsx`。
- **覆盖要求**: 成功导出三类制品、非 completed 拒绝导出、导出 POST 失败回流 failed、非 completed 导出按钮禁用。

### 5. 依赖和集成点

- **外部依赖**: Next.js Server Action 的 `redirect`、`revalidatePath`。
- **内部依赖**: BookRun API helper、统一 API client、Assistant 对话与操作条组件。
- **集成方式**: Server Action redirect 到首页 query，Conversation 读取 query 并渲染消息，ActionBar 根据 BookRun 状态禁用导出入口。
- **配置来源**: Web 测试脚本来自 `apps/web/package.json` 的 `test` 命令。

### 6. 技术选型理由

- **为什么用这个方案**: 与 BookRun 控制命令和章节审阅 action 的失败回流模式一致，不新增后端契约。
- **优势**: 改动小，失败用户可见，保留 completed 成功导出顺序。
- **劣势和风险**: ActionBar 的状态依赖 Conversation 已成功读取 BookRun；读取失败时只能禁用并提示未读取状态。

### 7. 关键风险点

- **并发问题**: 导出过程中 BookRun 状态可能变化，Server Action 仍以提交时 `readBookRun` 结果为准。
- **边界条件**: 无效 BookRun ID、非 completed 状态、导出 API 非 ok、fetch 异常、响应 JSON 缺失名称。
- **性能瓶颈**: 无新增 API 请求，仍复用已有 BookRun 读取。
- **安全考虑**: 失败信息只来自接口路径和状态码或异常消息，不暴露凭据；不修改后端和 Provider。
