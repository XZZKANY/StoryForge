# 项目上下文摘要（Task 6：结构化 Judge 与定向 Repair）

生成时间：2026-05-13 02:55:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/assets/router.py`
  - 模式：FastAPI `APIRouter` + Pydantic `response_model` + service 异常转 HTTPException。
  - 可复用：Judge/Repair 路由应只做协议转换，业务规则放在 service。
- `apps/api/app/domains/scene_packets/service.py`
  - 模式：校验场景/章节归属、复用模型、返回 Pydantic read schema。
  - 可复用：Judge 可引用 `ScenePacket`，Repair 可引用 `JudgeIssue`。
- `apps/api/tests/test_scene_packet.py`
  - 模式：SQLite 内存库、`app.dependency_overrides[get_session]`、中文行为测试。
  - 可复用：`test_judge_repair.py` 应构造 Book/Chapter/Scene/ScenePacket 并通过 TestClient 验证。

## 2. 既有模型

- `apps/api/app/domains/judge/models.py`
  - `JudgeIssue`: 字段包含 `scene_id`、`scene_packet_id`、`job_run_id`、`issue_type`、`severity`、`status`、`description`、`payload`。
  - `RepairPatch`: 字段包含 `judge_issue_id`、`scene_id`、`job_run_id`、`status`、`patch`、`rationale`、`version`。
- 规格字段映射：
  - Judge 输出 `category` 可映射 `issue_type`。
  - `span_start`、`span_end`、`evidence_links`、`recommended_repair_mode` 可保存在 `payload` 并由 schema 展开。
  - Repair 输出 `target_span`、`replacement_text`、`reason`、`requires_rejudge` 可保存在 `RepairPatch.patch` 并由 schema 展开。

## 3. 项目约定

- 新增 `schemas.py` 可保持 Pydantic 契约分层，虽然计划只列 router/service。
- 路由前缀建议：`/api/judge` 与 `/api/repair`。
- 注释、测试描述、日志使用简体中文；代码标识符按 Python snake_case。

## 4. 测试策略

- 测试框架：pytest + FastAPI TestClient + SQLite 内存库。
- 必测行为：
  - 输入包含设定冲突和文风漂移的章节片段。
  - Judge 输出结构化问题单，字段包含 category、severity、span_start、span_end、summary、evidence_links、recommended_repair_mode、status。
  - Repair 只返回失败 span 的补丁，不修改未命中的健康文本。
  - Repair 后状态回到 `requires_rejudge`。

## 5. 依赖和集成点

- 外部依赖：FastAPI、Pydantic、SQLAlchemy，已在 API 项目中声明。
- 内部依赖：`Scene`、`ScenePacket`、`JudgeIssue`、`RepairPatch`、`get_session`。
- `main.py` 需注册 judge 和 repair 路由；OpenAPI 需重新生成。

## 6. 风险点

- span 必须对应原文片段，Repair 不得返回整章改写。
- Judge 规则应确定性，避免依赖 LLM 或外部服务。
- RepairPatch 模型字段与规格字段不同，需要 schema 展开，防止 API 契约泄漏内部 JSON 结构。

## 7. 实施回填

- 已对比并复用以下既有模式：
  - `apps/api/app/domains/assets/router.py`：`APIRouter`、`response_model`、`HTTPException` 转换模式。
  - `apps/api/app/domains/assets/service.py`：服务层负责数据库校验、提交和刷新模型。
  - `apps/api/app/domains/scene_packets/service.py`：跨模型归属校验与结构化响应装配。
  - `apps/api/tests/test_scene_packet.py`：SQLite 内存库、`get_session` 覆盖、中文行为测试。
- 已使用 Context7 查询 FastAPI 官方文档，确认 `response_model` 用于响应验证、过滤和 OpenAPI 生成。
- 当前会话没有可调用的 `github.search_code` 工具；已记录为工具限制，未把未验证的开源代码写入实现。
- `desktop-commander.read_file` 在本环境只返回元数据，已先尝试使用，正文读取改用 PowerShell 只读后备。
- Task 6 集成点：
  - `apps/api/app/main.py` 注册 `/api/judge` 与 `/api/repair`。
  - `JudgeIssue.payload` 保存 span、证据链接、修复模式和替换建议。
  - `RepairPatch.patch` 保存 `target_span`、`replacement_text`、`requires_rejudge` 与 span。
