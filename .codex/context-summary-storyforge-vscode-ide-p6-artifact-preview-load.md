## 项目上下文摘要（StoryForge VS Code IDE P6 Artifact Preview Load）

生成时间：2026-05-28 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/ide/page.tsx`
  - 模式：读取 `searchParams`，通过 `readJson` 获取 Context Snapshot 或 Story Memory，再合并进 `IdeShell initialState`。
  - 可复用：本地类型守卫、失败返回空状态、只在目标面板和 URL 参数存在时请求。
  - 需注意：当前没有 artifact 预览查询。

- **实现2**: `apps/web/components/ide/views/ArtifactViewer.tsx`
  - 模式：接收 `ArtifactViewerPreview`，渲染预览、下载摘要、版本列表和 BookRun→ModelRun→JudgeReport→Approve trace。
  - 可复用：`ArtifactViewerPreview` 类型、trace href/data 属性。
  - 需注意：BottomPanel 当前只渲染空 `ArtifactViewer`。

- **实现3**: `apps/api/tests/test_ide_artifact_preview.py`
  - 模式：后端 `/api/ide/artifacts/{id}/preview` 一次返回 artifact、preview、download、versions、trace，并覆盖 context_href。
  - 可复用：页面 mock 响应字段应与该契约一致。
  - 需注意：只读 preview 查询不应走 CommandRegistry。

### 2. 项目约定

- **命名约定**：前端状态使用 `artifactId`、`artifactPreview`；API 路径使用 artifact id path 参数。
- **文件组织**：页面加载在 `apps/web/app/ide/page.tsx`；状态传递在 `ide-store`、`IdeShell`、`BottomPanel`；展示仍由 `ArtifactViewer` 负责。
- **导入顺序**：类型导入集中在页面和 store 顶部。
- **代码风格**：SSR 契约测试、readonly props、本地类型守卫、简体中文日志。

### 3. 可复用组件清单

- `readJson`: 统一 API 读取和响应验证。
- `ArtifactViewer`: 制品预览展示组件。
- `parseIdeUrlState` / `serializeIdeUrlState`: URL 真相源。
- `IdeShell` / `BottomPanel`: IDE shell 状态传递与底部面板宿主。
### 4. 测试策略

- **测试框架**：前端 `node:test` + `renderToStaticMarkup`。
- **测试模式**：扩展 `ide-page.test.tsx` mock fetch，断言 URL、渲染内容和 trace 链接；扩展 `ide-url-state.test.ts` 覆盖 artifact 参数。
- **参考文件**：`apps/web/tests/ide-page.test.tsx`、`apps/web/tests/ide-url-state.test.ts`、`apps/api/tests/test_ide_artifact_preview.py`。
- **覆盖要求**：Artifact #id、版本、preview 内容、BookRun/ModelRun/JudgeReport/Approve trace、context href。

### 5. 依赖和集成点

- **外部依赖**：Next.js App Router `searchParams` server component 数据读取，已通过 Context7 查询官方文档。
- **内部依赖**：`/api/ide/artifacts/{id}/preview`、`ArtifactViewerPreview`、`IdeStoreState`。
- **集成方式**：只在 `bottomPanel === 'artifacts'` 且 `artifactId` 存在时读取预览。
- **配置来源**：`STORYFORGE_API_BASE_URL` 与 `STORYFORGE_API_KEY` 由 `api-client` 处理。

### 6. 技术选型理由

- **为什么用这个方案**：与 P2 Context 和 P3 Memory 的页面加载模式一致，保持 URL 为分享和回放真相源。
- **优势**：复用现有 API 和组件，改动范围小，支持 P6 从制品反向追溯。
- **劣势和风险**：类型守卫较长，后续可在 shared OpenAPI 类型生成更稳定后收敛。

### 7. 关键风险点

- **并发问题**：无新增写入。
- **边界条件**：artifact 查询失败时保留空状态。
- **性能瓶颈**：仅目标面板按需请求一次。
- **安全考虑**：不新增安全控制；只读 REST 不涉及 CommandRegistry。