# 项目上下文摘要（CreativeToolRegistry API/Web 可见性）

生成时间：2026-05-25 02:35:00 +08:00

## 1. 相似实现分析

- **实现1**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/tools/registry.py:1-372`
  - 模式：冻结 dataclass + 静态默认注册表 + 查询函数。
  - 可复用：`list_creative_tools()`、`CreativeToolSpec`、`CreativeToolReferences`。
  - 约束：API/Web 不应复制工具条目，必须从这里读取。
- **实现2**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/router.py:1-46`
  - 模式：`APIRouter(prefix=..., tags=[...])` + Pydantic `response_model` + service 层。
  - 可复用：domain 分层与 `main.py` 集中 `include_router`。
  - 约束：业务错误转 HTTPException，本任务只读静态注册表无需数据库。
- **实现3**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/runs/page.tsx:1-220`
  - 模式：Next App Router async Server Component + 页面局部类型守卫 + `readJson`。
  - 可复用：`readJson`、`ready/error` 状态、中文 fallback 文案。
  - 约束：页面不得手写 runtime tools 清单，只能 map API 返回。- **实现4**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase4-contract.spec.ts:1-62`
  - 模式：`node:test` 读取 OpenAPI、API 测试源码和 Web 源码做契约证据校验。
  - 可复用：`assertOperation`、`assertSourceEvidence`、本地文件证据风格。
  - 约束：本阶段需增强为真实 API/TestClient 与 registry 的一致性校验。

## 2. 项目约定

- **命名约定**：Python 模块和函数使用 `snake_case`，Pydantic 类使用 `PascalCase`；TypeScript 类型使用 `PascalCase`，函数和常量使用 `camelCase`。
- **文件组织**：API 采用 `app/domains/<domain>/schemas.py`、`service.py`、`router.py`；Web 页面在 `apps/web/app/<route>/page.tsx` 内保持页面局部读取逻辑；共享 API 访问在 `apps/web/lib/api-client.ts`。
- **导入顺序**：Python 保持 `from __future__ import annotations` 开头，标准库、第三方、项目内导入分组；TypeScript 先导入依赖，再声明类型。
- **代码风格**：用户可见文案、注释、测试描述全部使用简体中文；Next Server Component 使用 async 函数与 `readJson` 的 `ready/error` 状态。## 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/tools/registry.py`：唯一 runtime tools 事实源。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/conftest.py`：本地 TestClient 与内存 SQLite 夹具。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/lib/api-client.ts`：统一 API URL、API Key 和 `cache: "no-store"`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/tests/phase1-navigation.test.tsx`：Web 静态契约与编码损坏检查。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`：OpenAPI 刷新、node:test、API pytest、workflow pytest 编排。

## 4. 测试策略

- **API 测试**：pytest + FastAPI TestClient，新增 `apps/api/tests/test_runtime_tools.py`，先红灯校验 `/api/runtime-tools`。
- **Web 测试**：`pnpm --filter @storyforge/web test` 运行 `node:test` 转译 TSX，校验 Runs 页面通过 API client 读取工具摘要。
- **e2e 测试**：`pnpm e2e tests/e2e/phase4-contract.spec.ts`，刷新 OpenAPI 后执行 Node 契约，并保留 API/workflow 本地验证。## 5. 依赖和集成点

- **外部依赖**：FastAPI、Pydantic、Next.js、TypeScript、node:test；Context7 已查询 FastAPI response model、Next App Router Server Component fetch、Pydantic nested model 文档。
- **内部依赖**：API runtime_tools service 读取 `apps/workflow` 的 `list_creative_tools()`；Web `/runs` 读取 API `/api/runtime-tools`；e2e 同时读取 registry 与 API 响应。
- **配置来源**：Web API Base URL/API Key 来自 `apps/web/lib/api-client.ts`；API TestClient 使用 `local-dev-key`。
- **工具说明**：本会话没有可调用的 `github.search_code`，已记录并以项目内实现与 Context7 官方文档替代。

## 6. 技术选型理由

- 选择新增 API domain，而不是让 Web 直接读 workflow 文件：符合现有 Web 通过 API client 读取后端事实的边界。
- 选择 API service 桥接 workflow import：保持 registry 唯一事实源，避免复制清单；桥接集中封装，后续可替换为正式包依赖。
- 选择 `/runs` 展示摘要：该页面已有 runtime/model run 语义，改动范围比拆 Studio 更窄。## 7. 关键风险点

- **路径桥接风险**：API 当前未声明 workflow 包依赖，需把 `sys.path` 桥接限制在 runtime_tools service 内。
- **序列化风险**：registry 使用 `MappingProxyType` 和 tuple 冻结，需要递归转换为 JSON 兼容 dict/list。
- **重复清单风险**：Web 测试必须禁止 `DEFAULT_CREATIVE_TOOL_REGISTRY`、静态 `runtimeToolList = [` 等清单复制痕迹。
- **契约陈旧风险**：e2e 必须刷新 OpenAPI，再校验 `/api/runtime-tools`。

## 8. 上下文充分性检查

- 能定义接口契约：是，`GET /api/runtime-tools -> RuntimeToolRead[]`。
- 理解技术选型理由：是，registry 为事实源，API 是跨运行边界读入口，Web 只读 API。
- 识别主要风险点：是，路径桥接、冻结对象序列化、Web 重复清单、OpenAPI 陈旧。
- 知道如何验证实现：是，API pytest、Web node:test、e2e phase4、workflow registry 测试。
