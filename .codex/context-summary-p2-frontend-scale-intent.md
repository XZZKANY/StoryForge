## 项目上下文摘要（P2 前端规模意图与 Blueprint 元数据）

生成时间：2026-06-03 01:26:21 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-intent.ts`
  - 模式：确定性解析用户自然语言，不调用 LLM。
  - 可复用：`parseAssistantIntent()`、`parseTargetWordCount()`、`parseCountBeforeUnit()`、`parseBatchChapterCount()`。
  - 需注意：`3-5 万字` 当前按上限写入 `targetWordCount=50000`，范围语义未单独保存。
- **实现2**: `apps/web/app/blueprints/api.tsx`
  - 模式：`createBlueprintRequest()` 将 AssistantIntent 转换为 Blueprint API payload。
  - 可复用：`target_word_count`、`target_chapter_count`、`metadata.batch_chapter_count`、`metadata.volume_count`。
  - 需注意：Server Action 只有收到 `formData.intent` 才会调用 `parseAssistantIntent()`。
- **实现3**: `apps/web/app/blueprints/BlueprintWorkspacePanel.tsx`
  - 模式：页面容器读取 URL searchParams，并把操作参数放入 Server Action hidden input。
  - 可复用：`blueprint_action`、`book_id`、`blueprint_id` hidden input 传参模式。
  - 需注意：本轮发现 URL 中的 `intent` 未透传到创建 Blueprint 表单，导致 UI 创建入口丢失规模元数据。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase；API payload 与 metadata 使用后端 snake_case。
- **文件组织**: 意图解析在 `components/home`，Blueprint Server Action 与请求 helper 在 `app/blueprints/api.tsx`，页面容器在 `BlueprintWorkspacePanel.tsx`。
- **导入顺序**: 未新增导入。
- **代码风格**: React Server Component 使用 searchParams 读值，表单继续使用 hidden input 传给 Server Action。

### 3. 可复用组件清单

- `parseAssistantIntent()`: 解析章节数、目标字数、分卷数、批次数。
- `createBlueprintRequest()`: 生成非固定三章 Blueprint 请求。
- `createBlueprintWorkflowAction()`: 从 `FormData.intent` 解析 AssistantIntent 并创建 Blueprint。
- `BlueprintWorkspacePanel`: URL intent 到 Server Action 的 UI 传递点。

### 4. 测试策略

- **测试框架**: `node:test` + `assert`。
- **测试模式**: 源码契约测试 + helper payload 测试 + Server Action 依赖注入测试。
- **参考文件**: `apps/web/tests/assistant-intent.test.ts`、`apps/web/tests/blueprints.test.tsx`。
- **覆盖要求**: 10 章、3-5 万字、2 卷、前 3 章批次；Blueprint payload 带 volume/batch metadata；UI 创建表单必须透传 intent。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: HomeComposer 把 intent 写入 URL；BlueprintWorkspacePanel 读取 URL；createBlueprintWorkflowAction 读取 FormData。
- **集成方式**: URL `intent` → hidden input `name="intent"` → Server Action `parseAssistantIntent()` → Blueprint API payload。
- **配置来源**: 无凭据、无 `.env` 读取。

### 6. 技术选型理由

- **为什么用这个方案**: 最小修复真实断点，让 UI 创建入口复用已存在的 Server Action intent 解析，不新增状态容器。
- **优势**: 改动小、可测试、与现有表单动作一致。
- **劣势和风险**: `3-5 万字` 仍只保留上限，后续如需精确范围需扩展 intent 类型和后端 schema。

### 7. 关键风险点

- **边界条件**: intent 中包含特殊字符时由 React hidden input 自动转义，Server Action 读取原值。
- **性能瓶颈**: 无额外 I/O。
- **安全考虑**: 不处理 API Key，不新增本地存储。

