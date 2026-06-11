## 项目上下文摘要（apps-web-real-api）

生成时间：2026-06-09 14:20:00

### 1. 相似实现分析

- **实现1**: `apps/web/lib/api-client.ts`
  - 模式：统一 API client，读取 `STORYFORGE_API_BASE_URL` 和 `STORYFORGE_API_KEY`，为每次请求注入 `X-StoryForge-API-Key`。
  - 可复用：`apiFetch`、`readJson`、`ApiResult`、`ApiResponseSchema`。
  - 需注意：服务端请求固定 `cache: 'no-store'`，错误返回统一转成中文状态文案。
- **实现2**: `apps/web/app/artifacts/api.ts`
  - 模式：页面领域 API helper 通过 `readJson` 调真实后端，再把结果转换为页面 state。
  - 可复用：端点常量、validator、错误文案替换。
  - 需注意：列表缺失时保持空/错误状态，不展示伪造数据。
- **实现3**: `apps/web/app/studio/api.ts`
  - 模式：多步骤工作台按依赖顺序调用真实 API，缺少上游目标时返回 idle 状态。
  - 可复用：`getStudioTarget` 的目标派生思路、按查询参数调用后端。
  - 需注意：每个 API 都有格式校验，不能直接信任响应。

### 2. 项目约定

- **命名约定**: 前端类型使用 PascalCase，函数使用 camelCase，API helper 以 `readXxx`、`createXxxRequest`、`submitXxxAction` 命名。
- **文件组织**: Next App Router 下页面在 `apps/web/app`，跨首页组件在 `apps/web/components/home`，通用 HTTP 能力在 `apps/web/lib`。
- **导入顺序**: Node/React/Next 依赖在前，内部模块在后，类型导入保持 `type` 标记。
- **代码风格**: TypeScript 严格只读类型较多，界面文案使用简体中文，测试使用 `node:test` 与 `node:assert/strict`。

### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: 统一 API 基础地址、API Key、`fetch` 与 JSON 读取。
- `packages/shared/src/generated/api-types.ts`: OpenAPI 生成类型，包含 `WorkspaceRead`。
- `apps/web/app/artifacts/api.ts`: 真实列表读取和页面状态转换模式。
- `apps/web/app/studio/api.ts`: 串联 API 读取和缺少目标时 idle 状态模式。
- `apps/web/tests/home-page.test.tsx`: 首页源码契约测试，需要先改为真实 API 契约。

### 4. 测试策略

- **测试框架**: `node:test`、`node:assert/strict`，由 `apps/web/scripts/phase1-contract-test.mjs` 转译运行。
- **测试模式**: 源码契约测试 + 可导入运行时模块测试。
- **参考文件**: `apps/web/tests/api-client.test.ts`、`apps/web/tests/home-page.test.tsx`、`apps/web/tests/studio.test.tsx`。
- **覆盖要求**: 先让 Projects 不再依赖 localStorage 的契约测试失败，再实现真实 API 读取、创建和错误/空状态。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15 App Router、React 19、FastAPI。
- **内部依赖**: `HomePage` -> `HomeShell` -> `HomeProjectsPanel`；新增 Projects API helper 复用 `lib/api-client`。
- **后端接口**: `/api/workspaces` 支持 GET 列表和 POST 创建，响应模型是 `WorkspaceRead`。
- **配置来源**: `STORYFORGE_API_BASE_URL`、`STORYFORGE_API_KEY`，默认本地 API 为 `http://127.0.0.1:8000` 和 `local-dev-key`。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有 `api-client` 和 OpenAPI 类型，Next 文档建议 App Router 服务端组件直接用 `fetch` 读取动态数据并显式控制缓存。
- **优势**: 不新增 HTTP 依赖，不绕过认证头，不在客户端暴露服务端 API Key。
- **劣势和风险**: 前端 `Projects` 当前语义更像项目列表，后端现有可列表化实体是 `workspaces`；本次记录为临时映射，未来如出现 books/projects 列表接口应替换。

### 7. 关键风险点

- **并发问题**: 创建工作区通过后端 `_next_available_slug` 处理 slug 冲突；前端不自行生成持久 ID。
- **边界条件**: API 失败时必须显示错误或空状态，不能退回本地假数据。
- **性能瓶颈**: 列表读取使用服务端 `no-store`，每次请求都会打后端；后续可按业务增加 revalidate。
- **安全考虑**: 继续通过服务端 `apiFetch` 注入 `X-StoryForge-API-Key`，客户端组件不读取密钥环境变量。

### 8. 外部资料来源

- Context7 `/vercel/next.js`: 确认 Next App Router 服务端 `fetch`、`cache: 'no-store'` 与服务端环境变量用法。
- GitHub `search_code`: 参考 Next/FastAPI 项目常见做法，将 API 基础地址和请求封装放在 `lib`，页面消费领域函数。
