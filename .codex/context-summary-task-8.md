## 项目上下文摘要（Task 8 批准回写和导出链路）

生成时间：2026-05-13 10:25:00

### 1. 相似实现分析

- `apps/api/app/domains/assets/service.py`: 资产首版创建与版本更新均在服务层完成；`update_asset` 会复制最新版本并内部 `commit`，因此 Task 8 事务回写只能复用 `Asset` 模型语义，不能调用该函数。
- `apps/api/app/domains/continuity/service.py`: `approve_chapter` 校验 `Chapter` 后批量创建 `ContinuityRecord`，路由层只将领域异常转换为 HTTP 状态码。
- `apps/api/app/domains/scene_packets/service.py`: 读取 `Asset`、`EvidenceLink`、`ContinuityRecord` 并组装结构化响应，证据链接通过 `source_ref` 与 `rationale` 保持可追溯。
- `apps/api/app/domains/repair/service.py`: 修复服务校验问题单与正文 span 后写入 `RepairPatch`，并通过状态表达需要重评。
- `apps/api/tests/test_scene_packet.py`、`apps/api/tests/test_judge_repair.py`: 测试使用 SQLite 内存库、`Base.metadata.create_all`、`TestClient` 覆盖 `get_session`，断言持久化副作用。
### 2. 项目约定

- 命名约定：Python 模块、函数、变量使用 `snake_case`；Pydantic 类和 ORM 类使用 `PascalCase`。
- 文件组织：领域代码放在 `apps/api/app/domains/<domain>/`，保持 `service.py`、`router.py`、必要 `__init__.py` 分层。
- 导入顺序：`from __future__ import annotations` 后依次为标准库、第三方库、项目内模块。
- 代码风格：服务层抛出领域异常并管理数据库写入；路由层依赖 `get_session` 并转换为 `HTTPException`；所有用户可见文本使用简体中文。

### 3. 可复用组件清单

- `app.db.session.get_session`: FastAPI 数据库依赖。
- `app.db.base.Base`: 测试中创建全部 ORM 表。
- `Book`、`Chapter`、`Scene`: 批准回写与导出的核心实体，章节正文位于 `Scene.content`。
- `Asset`、`EvidenceLink`: 用于最终章节版本、差异摘要和证据链接。
- `ContinuityRecord`: 用于批准后连续性事实回写。
### 4. 测试策略

- 测试框架：Pytest + FastAPI TestClient + SQLAlchemy SQLite 内存库。
- 批准回写测试：直接调用 `approve_chapter_writeback`，验证 `Scene.content`、`Chapter.status`、最终章节版本资产、差异资产、源资产状态、`EvidenceLink` 和 `ContinuityRecord`。
- 导出测试：通过 API 调用 Markdown 与 EPUB 路由，验证 Markdown 包含书名、章节标题和批准正文，EPUB 可由 `zipfile` 打开并包含 XHTML 正文。

### 5. 依赖和集成点

- 外部依赖：FastAPI、Pydantic、SQLAlchemy 已存在；EPUB 仅使用标准库 `zipfile`、`io`、`html`。
- 内部依赖：`exports.router` 需要在 `app.main` 注册；`lineage_service` 写入 books、assets、continuity 三个领域模型。
- 官方文档：Context7 查询 FastAPI 原始响应 `Response`/`PlainTextResponse` 与 SQLAlchemy Session 事务模式；本会话无 `github.search_code` 工具，已记录限制并以项目内实现模式替代。

### 6. 技术选型理由

- 批准回写采用单一服务函数和一次 `commit`，中途异常统一 `rollback`，满足事务性要求。
- 最终正文写入 `Scene.content`，章节状态写入 `approved`；版本和差异以 `Asset` 记录，因为现有 `Chapter` 没有正文版本字段。
- EPUB 采用最小 OCF/OPS zip 结构，满足 Phase 1 验证且避免新增重型依赖。

### 7. 关键风险点

- 事务风险：不能调用内部 `commit` 的 `assets.service.update_asset`。
- 边界条件：作品、章节、场景不存在或归属不匹配时应抛领域异常。
- 导出风险：无已批准正文时应由服务层抛异常，路由层转 404。
- 范围风险：多代理环境下只能精确暂存 Task 8 文件，不能纳入 `.superpowers/`、`docs/superpowers/specs/` 或历史草稿。
