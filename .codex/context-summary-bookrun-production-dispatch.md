# BookRun 生产调度接线上下文摘要

生成时间：2026-06-01 04:30:30 +08:00

## 1. 目标

把已存在的 workflow BookRun adapter 从“测试可运行”推进到“生产调度可接线”：API 侧提供不执行 workflow 的 dispatch payload，workflow 侧消费该 payload 并通过 progress sink 回填，测试证明 API 创建 BookRun 后可以进入 recorded skill_runs 链路。

## 2. 现有模式证据

- API BookRun 真相源：apps/api/app/domains/book_runs/service.py:26-85 创建 BookRun 和应用 workflow progress。
- API progress endpoint：apps/api/app/domains/book_runs/router.py:56-74 已有 PATCH /api/book-runs/{id}/progress。
- Workflow adapter：apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py:61-98 已能运行 BookLoop 并回填 sink。
- BookLoop progress：apps/workflow/storyforge_workflow/orchestrators/book_loop.py:94-107 已写入 result.skill_runs。
- Chapter plan：apps/api/app/domains/blueprints/service.py:69-121 会为 locked blueprint 生成 Chapter 行。
- 既有后台任务模式：apps/api/app/domains/batch_refinery/router.py 使用 BackgroundTasks 排队，service 创建 JobRun 后后台执行；本轮不复用后台任务直接跑 workflow，只借鉴“创建请求与执行分离”的边界。

## 3. 设计约束

- API service 不直接执行 workflow。
- API dispatch 只生成稳定 JSON payload，包括 BookRunAdapterRequest 字段和章节索引/目标/id 映射。
- workflow 包不导入 API ORM 或 schema，只消费 Mapping payload。
- progress sink 仍是 Protocol；新增 callable sink 便于 HTTP、队列或本地 service adapter 包装。
- 本轮测试以本地 fake ports 和 API service 测试证明闭环，不引入真实 LLM。

## 4. 复用组件

- BookRunProgressUpdate：apps/api/app/domains/book_runs/schemas.py。
- apply_book_run_progress：apps/api/app/domains/book_runs/service.py。
- run_book_run_with_skill_runner：apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py。
- CapturingProgressSink：apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py。
- trigger_chapter_plan：apps/api/app/domains/blueprints/service.py。

## 5. 风险

- 若章节计划缺失，dispatch payload 无法提供 chapter_id；应显式阻断并提示先生成章节计划。
- 若 BookRun 非 running，重复 dispatch 可能覆盖已完成状态；应只允许 running 状态生成 dispatch。
- workflow 侧 payload 消费必须校验章节映射完整，避免运行到未知章节。
