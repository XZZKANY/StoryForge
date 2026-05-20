# 项目上下文摘要（Phase 6 Studio 创作闭环收口）

生成时间：2026-05-19 19:39:49 +08:00

## 1. 相似实现分析

- **实现1**：`apps/api/app/domains/studio/service.py`
  - 模式：Studio 域以只读 service 函数读取既有事实，不触发跨页面执行流。
  - 可复用：`read_studio_judge_review()`、`StudioJudgeReviewNotFoundError`、`_studio_judge_issue()`。
  - 需注意：缺失数据统一由路由层转换为 404，供 Web 展示可重试错误摘要。
- **实现2**：`apps/api/app/domains/studio/router.py`
  - 模式：`APIRouter(prefix="/api/studio")` + `response_model` + `Query(gt=0)`。
  - 可复用：`SessionDependency` 与异常转 `HTTPException(status_code=404)` 的写法。
  - 需注意：本轮新增端点必须保持 Studio 命名空间，不能改动 Repair 写入路由。
- **实现3**：`apps/web/app/studio/page.tsx`
  - 模式：async Server Component 按作品列表、章节目标、Scene Packet、Judge 评审顺序 `fetch(..., { cache: "no-store" })`。
  - 可复用：状态 union、类型守卫、可重试错误摘要、中文区块展示。
  - 需注意：只追加 Repair 单一数据源，不新增全量 API client 或状态管理平台。

## 2. 项目约定

- **命名约定**：Python 使用 snake_case，Pydantic 类使用 PascalCase；TypeScript 类型使用 PascalCase，常量和函数使用 camelCase。
- **文件组织**：API 领域按 `schemas.py`、`service.py`、`router.py` 分层；Web 页面按 route 放在 `apps/web/app/<route>/page.tsx`。
- **导入顺序**：Python 先标准库、第三方、项目内模块；TypeScript 先组件再 lib。
- **代码风格**：所有可读文本、注释和文档使用简体中文；接口保持最小只读契约。
## 3. 可复用组件清单

- `apps/api/app/domains/judge/models.py`：`JudgeIssue` 与 `RepairPatch` 是 Repair 摘要的事实来源。
- `apps/api/app/domains/repair/schemas.py`：`RepairPatchRead` 已定义 target span、replacement、reason、requires_rejudge 语义。
- `apps/web/lib/phase6-data-sources.ts`：`phase6DataSources.studio` 是 Studio 数据源状态事实源。
- `apps/web/tests/phase1-navigation.test.tsx`：中文契约测试保护 Web 页面和 registry 文本边界。

## 4. 测试策略

- **API 测试框架**：pytest + FastAPI TestClient + SQLAlchemy 内存 SQLite。
- **参考文件**：`apps/api/tests/test_studio_book_list_api.py`。
- **Web 测试框架**：Node `node:test` 源码契约测试 + TypeScript `tsc --noEmit`。
- **覆盖要求**：Repair 成功态、缺失补丁 404、Web 真实读取边界、格式错误文案和可重试错误摘要。

## 5. 依赖和集成点

- **外部依赖**：FastAPI、SQLAlchemy、Pydantic、Next.js Server Component。
- **内部依赖**：Studio service 只读 `ScenePacket`、`JudgeIssue`、`RepairPatch`，不调用 `create_repair_patch()`。
- **集成方式**：新增 `GET /api/studio/repair-patches?scene_packet_id=<int>`，Web 在 Judge 评审 ready 后顺序读取。
- **配置来源**：Web 使用 `STORYFORGE_API_BASE_URL`，默认 `http://127.0.0.1:8000`。

## 6. 技术选型理由

- **为什么用这个方案**：当前 Phase 索引明确只推进 Studio 单页面单数据源；Repair 已有写入路由，本轮只读摘要能闭合展示链路且不制造副作用。
- **优势**：复用既有模型和页面模式，变更面小，可本地复现。
- **劣势和风险**：仍未完成批准回写和失败恢复；RepairPatch 缺失时只能展示可重试错误摘要。

## 7. 关键风险点

- **并发问题**：本轮只读已提交补丁，不新增写事务。
- **边界条件**：Scene Packet 不存在、RepairPatch 不存在、API 返回格式不符。
- **性能瓶颈**：当前只按单个 `scene_packet_id` 读取补丁摘要，未引入批量查询。
- **范围控制**：未修改 Retrieval/Runs/Artifacts/Evaluations 页面或后端领域。