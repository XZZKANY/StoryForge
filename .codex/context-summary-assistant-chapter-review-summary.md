## 项目上下文摘要（Assistant 章节审阅摘要）

生成时间：2026-06-02 17:40:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-chapter-review-actions.ts`
  - 模式：Server Action 读取 `FormData`，调用 Studio API 后用 `URLSearchParams` redirect 回首页。
  - 可复用：`fetchJson`、`firstRepairPatchId`、`readPositiveInt`。
  - 需注意：当前只回传 `repair_patch_id` 和失败错误，没有摘要字段。
- **实现2**: `apps/web/components/home/AssistantConversation.tsx`
  - 模式：从 `searchParams` 读取短状态参数，由 `chapterReviewMessageFor` 转为 Assistant 消息。
  - 可复用：`firstParam`、`readPositiveInt`、`artifactExportMessageFor` 的摘要拼接节奏。
  - 需注意：消息必须来自真实参数，不能伪造工具完成状态。
- **实现3**: `apps/web/components/home/assistant-book-run-actions.ts`
  - 模式：局部 `buildResultUrl` 通过短 query 参数回传 action 执行结果。
  - 可复用：局部 URL 构建函数思路。
  - 需注意：本任务不扩大为跨 action 共享抽象。
- **实现4**: `apps/web/tests/assistant-chapter-review-actions.test.ts`
  - 模式：`node:test` + `assert.rejects` 捕获 redirect 抛错并断言 URL。
  - 可复用：依赖注入 `apiFetch`、`revalidatePath`、`redirect`。
  - 需注意：新增测试应先失败，覆盖摘要和敏感正文不进入 URL。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase 函数与局部变量，类型使用 PascalCase。
- **文件组织**: 首页 Assistant 相关能力集中在 `apps/web/components/home/`，测试在 `apps/web/tests/`。
- **导入顺序**: Node 内置模块优先，项目相对导入随后；组件文件先导入依赖再导入类型。
- **代码风格**: 2 空格缩进，中文 UI 文案，Server Action 顶部保留 `'use server'`。

### 3. 可复用组件清单

- `apps/web/components/home/assistant-chapter-review-actions.ts`: Studio API 串联与 redirect 入口。
- `apps/web/components/home/AssistantConversation.tsx`: Assistant 消息映射入口。
- `apps/web/components/home/assistant-book-run-actions.ts`: 局部构建结果 URL 模式。
- `apps/web/components/home/assistant-artifact-export-actions.ts`: 短状态 query 回流模式。

### 4. 测试策略

- **测试框架**: `node:test`、`node:assert/strict`。
- **测试模式**: action 测试断言 redirect URL；home-page 测试用源码字符串守住契约。
- **参考文件**: `apps/web/tests/assistant-chapter-review-actions.test.ts`、`apps/web/tests/home-page.test.tsx`。
- **覆盖要求**: ready 摘要、failed 摘要、URL 长度约束、敏感正文不进入 URL。

### 5. 依赖和集成点

- **外部依赖**: Next.js `redirect`、`revalidatePath`；使用方式经 Context7 `/vercel/next.js` 文档确认。
- **内部依赖**: `apiFetch` 与 Studio API endpoint 常量。
- **集成方式**: action 通过 query 参数把短摘要传给首页，Conversation 解析后渲染消息。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 与现有 Assistant 状态回流一致，不触碰 Provider、BookRun Python 或导出 action。
- **优势**: 改动小、可测试、不会引入持久化或新接口。
- **劣势和风险**: URL query 只能承载短摘要；字段命名需容忍 Studio API 返回差异。

### 7. 关键风险点

- **并发问题**: 无共享状态，风险低。
- **边界条件**: Studio API 返回数组或对象、字段缺失、摘要过长、正文类字段误入。
- **性能瓶颈**: 摘要提取线性扫描少量对象，风险低。
- **安全考虑**: 不读取 `content`、`body`、`diff`、`patch`、`full_text` 等正文或补丁全文字段写入 URL。
