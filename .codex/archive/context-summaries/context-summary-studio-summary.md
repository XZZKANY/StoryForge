## 项目上下文摘要（Studio 批准回写与失败恢复摘要）

生成时间：2026-05-20 19:20:00

### 1. 相似实现分析
- `apps/api/app/domains/studio/schemas.py`: Studio 响应模型使用 Pydantic `BaseModel`，类名以 `Studio...Read` 结尾，字段保持 snake_case。
- `apps/api/app/domains/studio/service.py`: Studio 读取函数以 `read_studio_...` 命名，先查持久化事实，不触发生成、修复或写回动作。
- `apps/api/app/domains/studio/router.py`: 路由统一挂载在 `/api/studio`，使用 `Annotated[..., Query(gt=0)]` 和 `response_model`，NotFoundError 转 404。
- `apps/web/app/studio/page.tsx`: 页面使用服务端 `fetch` 直接读取 Studio 端点，状态联合类型包含 `idle/ready/error`，中文展示可重试错误摘要。

### 2. 项目约定
- 命名约定：Python 使用 snake_case，Pydantic 模型使用 PascalCase；TypeScript 类型使用 PascalCase，字段沿用 API snake_case。
- 文件组织：schema、service、router 分层清晰，页面本地定义最小 API 类型与类型守卫。
- 导入顺序：`__future__`、标准库、第三方库、项目内模块。
- 代码风格：中文 docstring 描述意图，不写修改说明式注释。

### 3. 可复用组件清单
- `ScenePacket`、`JudgeIssue`、`RepairPatch`、`JobRun` 模型用于只读摘要。
- `NotFoundError` 用于路由层转换可重试 404。
- 现有 `read_studio_scene_packet`、`read_studio_repair_patches` 提供查询和错误处理模式。

### 4. 测试策略
- 测试框架：pytest + FastAPI TestClient + SQLite 内存库。
- 参考文件：`apps/api/tests/test_studio_book_list_api.py` 已覆盖 Studio 各只读端点。
- 覆盖要求：成功读取、不可用摘要、参数错误或缺失路径。

### 5. 依赖和集成点
- 外部依赖：FastAPI `Annotated` + `Query`；已通过 Context7 查询确认现代写法。
- 内部依赖：Studio service 读取 books/continuity/judge/jobs 模型，router 暴露 GET API，页面 Repair 后读取摘要。
- 配置来源：前端沿用 `STORYFORGE_API_BASE_URL` 与本地端点常量。

### 6. 技术选型理由
- 继续采用只读摘要模型，避免真实按钮执行流和章节写回。
- 新增响应模型而非复用 dict，可保持 OpenAPI 和测试断言稳定。
- GitHub 开源代码搜索工具在当前会话未提供，记录为工具缺失；本任务以仓库内既有实现和 Context7 官方文档为依据。

### 7. 关键风险点
- 并行 worker 可能修改同一文件，编辑时仅做小范围追加和替换，不回滚其他差异。
- `job_run_id` 的 checkpoint 字段来源可能不统一，按现有 `model_runs.service` 中的 `thread_id/current_node/approval_status` 规则提取，并保留完整失败摘要。
- 审批摘要不能产生真实副作用，仅返回可批准资格、目标章节、回写状态和不可批准原因。
