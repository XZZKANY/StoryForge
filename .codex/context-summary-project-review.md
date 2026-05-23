# 项目上下文摘要（project-review 优化后）

生成时间：2026-05-23 00:00:00 +08:00

## 1. 本轮目标

本轮基于上一轮项目级审查的“需讨论”结论继续优化，重点处理以下风险：Web 统一 API client 复用、Artifacts 域能力描述、Runs 页面文案编码、Workflow 测试临时目录、verify 与 e2e 补偿路径。

执行约束：不开子代理；所有回复和记录使用简体中文；验证均在本地执行；不把未通过的环境门禁伪装为通过。

## 2. 相似实现与复用证据

- `apps/web/lib/api-client.ts`：统一 `apiFetch()`、`readJson()`、`buildApiUrl()`，负责 API Key 注入和 `cache: "no-store"`。
- `apps/web/app/studio/actions.tsx`：Server Action 复用 `apiFetch()` 执行写回请求。
- `apps/web/app/artifacts/page.tsx` 与 `apps/web/app/evaluations/page.tsx`：页面读取复用 `readJson()`，作为 Runs 页面读取模式参考。
- `apps/web/tests/phase1-navigation.test.tsx`：既有 node:test 静态契约测试，适合扩展编码损坏回归检测。

## 3. 官方文档与外部检索

- 已通过 context7 查询 Next.js App Router 数据读取文档：Server Component 中动态服务端读取可使用 `fetch(..., { cache: "no-store" })`。
- 本项目进一步把该模式封装在 `apiFetch()` 中，以避免页面重复维护 header、cache 和 URL 拼接。
- 本轮可用工具列表中没有 `github.search_code` 工具，因此未执行开源代码搜索；已在操作日志中记录该限制。

## 4. 当前代码状态

- `apps/web/app/retrieval/page.tsx` 已使用 `apiFetch()`，不再保留裸业务 `fetch()`。
- `apps/web/app/runs/page.tsx` 已使用 `readJson()`，并修复缺少 `job_run_id`、响应格式异常和 API 错误前缀的中文文案。
- `apps/api/app/domains/artifacts/__init__.py` 当前描述为“制品治理域：当前提供导出物列表、详情和 payload 下载摘要。”，未再声明上传资料、快照和评测报告已统一管理。
- `apps/workflow/pyproject.toml` 已移除固定 `--basetemp=.pytest-tmp`，避免 Windows 上 pytest 清理固定目录时因权限或句柄残留失败。

## 5. 测试策略

- Web 使用 `node:test` + 静态源码契约检查，并由 `pnpm.cmd run test:web` 同时执行 shared TypeScript 检查。
- API 使用 `uv run pytest`，本轮在项目内 `UV_CACHE_DIR=.cache/uv` 下 147 项通过。
- Workflow 使用 `uv run pytest`，本轮 13 项通过。
- E2E 使用 `scripts/run-e2e.mjs`，会先刷新 OpenAPI，再执行 Node 契约测试、API 验证和 Workflow 验证。

## 6. 本轮验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm.cmd run test:web` | 通过 | Web 7/7，shared 类型检查通过 |
| `UV_CACHE_DIR=.cache/uv; pnpm.cmd run test` | 通过 | Web 7/7、API 147/147、Workflow 13/13 |
| `UV_CACHE_DIR=.cache/uv; pnpm.cmd run e2e` | 通过但仍有补偿路径 | Node 契约 14/14，API 服务层补偿 7/7，Workflow 补偿 8/8 |
| `UV_CACHE_DIR=.cache/uv; pnpm.cmd openapi` | 通过 | OpenAPI 契约生成成功 |
| `git diff --check` | 通过 | 无空白错误，仅有 CRLF 提示 |
| `pnpm.cmd run verify` | 失败 | Docker 命令存在，但 PostgreSQL、Redis、MinIO 容器状态无法查询 |

## 7. 仍需讨论的风险

- `pnpm run verify` 仍未绿，原因是本地 Docker 容器状态查询失败；这仍是交付门禁风险。
- `pnpm run e2e` 虽通过，但当前环境仍无法稳定执行 FastAPI HTTP pytest，脚本转入 compileall + 服务层验收补偿路径。
- 多数工作台仍以摘要读取或最小执行为主，不能按“完整实现”标准直接通过。

## 8. 充分性检查

- 已能指出至少 3 个相似实现：`api-client.ts`、`studio/actions.tsx`、`artifacts/page.tsx`、`evaluations/page.tsx`。
- 已理解项目模式：Web 页面通过统一 API client 访问后端，静态契约测试约束页面边界与文案边界。
- 已复用既有组件：`apiFetch()`、`readJson()`、既有 `phase1-navigation.test.tsx` 测试结构。
- 已验证命名与风格：TypeScript 保持 camelCase，Python 配置保持项目既有 pyproject 结构。
- 已确认未重复造轮子：未新增 HTTP client、未新增测试框架、未新增脚本。
