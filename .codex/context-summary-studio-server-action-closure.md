## 项目上下文摘要（Studio Server Action 闭环）

生成时间：2026-05-21 03:03:09 +08:00

### 1. 相似实现分析

- **实现1**：`apps/web/app/studio/page.tsx`
  - 模式：Next.js App Router async Server Component，使用 `fetch(..., { cache: "no-store" })` 读取 Studio 摘要状态。
  - 可复用：`getStudioApiBaseUrl()`、`readStudio*()`、`isStudio*()` 类型守卫和中文错误态。
  - 需注意：页面此前只有批准执行入口说明，缺少可提交的 Server Action 表单。
- **实现2**：`apps/api/app/domains/studio/router.py` 与 `apps/api/app/domains/studio/service.py`
  - 模式：FastAPI router 调 service，schema 负责请求与响应契约。
  - 可复用：`POST /api/studio/approve` 与 `approve_studio_writeback()` 已具备真实写回能力。
  - 需注意：本轮不改后端业务规则、不新增 schema 字段。
- **实现3**：`apps/api/tests/test_studio_book_list_api.py`
  - 模式：SQLite `StaticPool` + FastAPI `TestClient`，通过种子数据验证 Studio API 行为。
  - 可复用：已有 ScenePacket/RepairPatch 批准写回测试覆盖章节、场景和 continuity 更新。
  - 需注意：Web 只需调用既有 API，API 侧以回归为主。

### 2. 项目约定

- **命名约定**：Web 类型沿用 `Studio*State`、读取函数沿用 `readStudio*`、类型守卫沿用 `isStudio*`。
- **文件组织**：Web 页面在 `apps/web/app/studio/page.tsx`，Web 契约测试在 `apps/web/tests/phase1-navigation.test.tsx`，Studio API 测试在 `apps/api/tests/test_studio_book_list_api.py`。
- **导入顺序**：Next.js 内建导入在前，项目组件和 lib 导入在后。
- **代码风格**：TypeScript 使用只读类型、状态联合类型、中文错误提示；Python 测试使用 pytest + TestClient。

### 3. 可复用组件清单

- `apps/web/app/studio/page.tsx`：`getStudioApiBaseUrl()` 与 Studio 读取/展示状态。
- `apps/api/app/domains/studio/service.py`：`approve_studio_writeback()` 负责真实批准写回。
- `apps/api/tests/test_studio_book_list_api.py`：Studio approve API 的成功与不可批准场景。
### 4. 测试策略

- **测试框架**：Web 使用 `node:test` 静态契约测试；API 使用 pytest。
- **测试模式**：Web 测试断言 Server Action、`revalidatePath("/studio")`、表单 action、隐藏字段和结果提示；API 测试回归既有 `POST /api/studio/approve` 写回行为。
- **参考文件**：`apps/web/tests/phase1-navigation.test.tsx`、`apps/api/tests/test_studio_book_list_api.py`。
- **覆盖要求**：正常批准、不可批准阻塞、中文契约无乱码。

### 5. 依赖和集成点

- **外部依赖**：Next.js `revalidatePath` 与 `redirect`。
- **内部依赖**：Web Server Action 调用 API `POST /api/studio/approve`，API 再调用 Studio service 写回章节、场景和 continuity。
- **集成方式**：`FormData` → Server Action → API JSON POST → `revalidatePath("/studio")` → redirect 查询参数展示结果。
- **配置来源**：`STORYFORGE_API_BASE_URL`，默认 `http://127.0.0.1:8000`。

### 6. 技术选型理由

- **为什么用这个方案**：用户已选择 Server Action；它能在不新增 Client Component 和微服务的前提下形成最小交互闭环。
- **优势**：复用既有后端 API，减少前端状态管理和新依赖。
- **劣势和风险**：仅覆盖批准写回，不等于完整 Studio 编排器；运行时 API 不可用时表单提交会返回错误摘要。

### 7. 关键风险点

- **边界条件**：必须只允许提交 `scene_packet_id` 或 `repair_patch_id` 中的一个。
- **用户体验**：不可批准时继续展示阻塞原因，不伪造按钮。
- **验证风险**：需同时验证 Web 契约与 API 回归，避免只测试静态字符串。
