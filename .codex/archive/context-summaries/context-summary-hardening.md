## 项目上下文摘要（上线前硬化）

生成时间：2026-05-21 00:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/lib/api-client.ts:1-51`
  - 模式：集中提供 `getApiBaseUrl()`、`buildApiUrl()`、`readJson<T>()`，由服务端页面读取 API。
  - 可复用：`buildApiUrl()`、`readJson<T>()`、默认 `local-dev-key`。
  - 需注意：当前 API Key 注入只在 `readJson()` 内部，POST 与裸 `fetch` 调用绕过该逻辑。
- **实现2**: `apps/web/app/retrieval/page.tsx:76-162`
  - 模式：Server Component 内部按资料源 → 刷新任务 → 搜索请求顺序读取，手写 `cache: "no-store"` 与 `X-StoryForge-API-Key`。
  - 可复用：`buildApiUrl()` 的 query 构造方式、错误摘要返回形态。
  - 需注意：手写鉴权头证明业务请求需要 API Key，但不应继续复制 header 逻辑。
- **实现3**: `apps/web/app/runs/page.tsx:40-70`
  - 模式：读取 URL query 的 `job_run_id` 后调用后端，并用类型守卫保护返回格式。
  - 可复用：`parsePositiveInt()`、`ready/error` 状态建模、`role="status"` 错误摘要。
  - 需注意：页面级读取应保持 `no-store`，避免展示陈旧运行状态。

### 2. 项目约定

- **命名约定**: TypeScript 函数与变量使用 camelCase，类型使用 PascalCase，端点常量使用描述性 camelCase。
- **文件组织**: Next.js App Router 页面位于 `apps/web/app/<route>/page.tsx`；跨页面 API 工具位于 `apps/web/lib/`；Studio 专属 API、类型和守卫拆在 `app/studio/`。
- **导入顺序**: 外部依赖优先，随后内部相对路径；类型导入使用 `import type`。
- **代码风格**: 严格 TypeScript、只读类型、Server Component async 读取、中文用户可见文本。

### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: API base URL、URL 构造、统一读取结果封装。
- `apps/web/app/studio/validators.ts`: Studio 返回体类型守卫。
- `apps/web/app/studio/types.ts`: Studio 页面状态与后端摘要类型。
- `apps/web/lib/phase6-data-sources.ts`: 工程 registry，可保留为工程事实源但不应在用户页面堆完整矩阵。

### 4. 测试策略

- **测试框架**: `apps/web/scripts/phase1-contract-test.mjs` 运行 Node 内置 `node:test`。
- **参考文件**: `apps/web/tests/phase1-navigation.test.tsx`，当前使用 `readFileSync` 做静态契约检查。
- **覆盖要求**: 先用静态契约捕获裸业务 `fetch`、缺失 `apiFetch`、文案过度承诺；再用页面级真实读取验证补强报告。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15.3.2、React 19.1.0、TypeScript 5.8.3。
- **内部依赖**: Web 页面通过 `apps/web/lib/api-client.ts` 访问 FastAPI；API 默认地址 `http://127.0.0.1:8000`；默认 API Key 为 `local-dev-key`。
- **配置来源**: `STORYFORGE_API_BASE_URL`、`STORYFORGE_API_KEY`。
- **官方文档**: Context7 查询 `/vercel/next.js`，确认 App Router Server Component 可用 `fetch(..., { cache: "no-store" })` 做动态读取。

### 6. 技术选型理由

- **为什么用 apiFetch**: 把 URL 构造、API Key、`no-store` 和 header 合并集中到一个入口，避免 GET/POST 分叉。
- **优势**: 可用静态测试审计调用方；后续 Retrieval/Runs 可渐进迁移。
- **劣势和风险**: 只靠静态测试不能证明页面真实可用，必须补页面级读取验证记录。

### 7. 关键风险点

- **并发问题**: 页面并行读取依赖前序状态，迁移时不能打乱 Studio 的作品 → Scene Packet → Judge/Repair 顺序。
- **边界条件**: 空列表、非 2xx、返回格式不符、未提供 query 参数都要保留现有错误摘要。
- **性能瓶颈**: 统一 client 不新增请求；页面仍使用 `Promise.all` 保持并行读取。
- **安全考虑**: 本轮只修复计划中明确的后端 API Key 访问一致性，不扩展认证模型。

### 8. 工具检索记录

- 文件搜索：`desktop-commander.start_search` 对 `apps/web` 执行文件名和内容搜索；文件名正则未命中，后续按用户给定路径直接读取。
- 内容搜索：确认 `phase1-navigation.test.tsx` 为主要 Web 静态契约测试。
- 开源搜索：当前会话没有 `github.search_code` 工具可用，已记录为工具缺失；用项目内相似实现和 Context7 官方文档替代。

### 9. 充分性检查

- 能定义接口契约：是，`apiFetch(path, init)` 返回 `Response`，`readJson<T>()` 继续返回 `ApiResult<T>`。
- 理解技术选型：是，复用 Next.js Server Component `fetch` 与项目现有 API client。
- 识别主要风险：是，鉴权绕过、缓存陈旧、静态测试不足和页面真实验证缺失。
- 知道如何验证：是，先运行目标 Node 测试红灯，再运行 Web test/lint、根测试、OpenAPI，并记录页面级验证。
