## 项目上下文摘要（Studio 批准写回执行）

生成时间：2026-05-21 00:16:07 +08:00

### 1. 相似实现分析

- **Studio 只读摘要**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/studio/service.py:270-370`
  - 模式：service 先定位对象，再返回 `can_approve`、目标章节和阻塞原因。
  - 可复用：`_approval_summary_from_scene_packet`、`_approval_summary_from_repair_patch` 的对象定位与状态判定。
  - 需注意：重复批准应优先返回目标章节已回写原因。
- **章节写回服务**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/books/lineage_service.py:34-151`
  - 模式：`approve_chapter_writeback` 单事务更新 scene/chapter、版本资产、EvidenceLink、ContinuityRecord。
  - 可复用：`ChapterWritebackApproval` 与 `approve_chapter_writeback`，避免重复造轮子。
  - 需注意：调用前必须准备批准正文，ScenePacket 路径使用当前 `Scene.content`。
- **Repair 补丁生成**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/repair/service.py:17-55`
  - 模式：通过 `span_start/span_end/target_span/replacement_text` 定位并描述定向替换。
  - 可复用：RepairPatch payload 结构，用于执行时应用补丁正文。
  - 需注意：span 与当前正文不匹配时必须返回不可批准原因，不能部分写入。

### 2. 项目约定

- **命名约定**：Python 使用 snake_case 函数与字段，Pydantic schema 使用 `Studio*Read/Create` 命名；前端 TypeScript 类型使用 `Studio*` PascalCase。
- **文件组织**：API 领域按 `schemas.py`、`service.py`、`router.py` 分层；Web Studio 页面集中在 Server Component `app/studio/page.tsx`。
- **导入顺序**：标准库、第三方库、项目内模块分组；现有代码未强制字母排序，以最小局部改动为准。
- **代码风格**：中文 docstring/页面文案；FastAPI router 使用 `response_model`，service 抛领域异常，router 转 HTTPException。

### 3. 可复用组件清单

- `app.domains.books.lineage_service.approve_chapter_writeback`：真实批准写回事务。
- `app.domains.books.lineage_service.ChapterWritebackApproval`：批准正文与差异摘要输入契约。
- `app.domains.studio.service.read_studio_approval_summary`：现有只读资格摘要入口。
- `app.domains.repair.service` 的 RepairPatch payload 结构：`span_start`、`span_end`、`target_span`、`replacement_text`。

### 4. 测试策略

- **测试框架**：后端 `pytest` + FastAPI `TestClient` + sqlite 内存库；前端 `node:test` 字符串契约测试 + TypeScript `tsc --noEmit`。
- **参考文件**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_studio_book_list_api.py`、`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_approval_writeback.py`、`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**：ScenePacket 成功、RepairPatch 成功、不可批准状态、重复批准阻断、Web 执行入口契约展示。

### 5. 依赖和集成点

- **外部依赖**：FastAPI、Pydantic v2、SQLAlchemy 2.0；Context7 已确认 Pydantic v2 `model_validator(mode="after")` 使用实例方法，FastAPI POST body 使用 Pydantic 模型。
- **内部依赖**：Studio service 读取 `ScenePacket`、`RepairPatch`、`Scene`、`Chapter`、`JudgeIssue`，并调用 `approve_chapter_writeback`。
- **集成方式**：新增 `POST /api/studio/approve`；Web 只展示 POST 契约，不在 SSR 自动提交。
- **配置来源**：Web API 基址沿用 `STORYFORGE_API_BASE_URL` 与默认 `http://127.0.0.1:8000`。

### 6. 技术选型理由

- **为什么用现有写回服务**：已有 `approve_chapter_writeback` 覆盖事务、版本谱系、证据与连续性记录，直接复用能减少维护面。
- **优势**：执行路径可由现有测试经验验证；新增 Studio 层仅负责编排来源对象和响应契约。
- **劣势和风险**：ScenePacket 不携带正文，必须依赖当前 `Scene.content`；RepairPatch 必须校验 span，避免对已变化正文误写。

### 7. 关键风险点

- **并发问题**：重复批准通过章节 `approved` 状态阻断；本任务不新增锁，维持现有轻量事务模型。
- **边界条件**：缺少正文、补丁 span 不匹配、来源对象状态不可批准、目标章节已批准。
- **性能瓶颈**：按主键读取和常量级写入，无明显扫描瓶颈。
- **工具限制**：本环境没有 `github.search_code` 工具，未执行开源代码搜索；本任务为项目特定编排，已优先复用项目内成熟实现。
