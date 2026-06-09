## 项目上下文摘要（Novelskill P3 数据陈旧与多 Scene）

生成时间：2026-06-08 07:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/book_context.py`
  - 模式：`BookContext.from_db()` 从 approved `Chapter` + approved `Scene` 初始化缓存，`get_book_context()` 提供 book-scoped 单例，`clear_book_context_cache()` 可清单本或全局缓存。
  - 可复用：`BookContext.from_db()`、`get_book_context()`、`clear_book_context_cache(book_id)`。
  - 需注意：当前同章多个 approved Scene 时用 `seen` 只取第一个；`_cache_version` 只由 append/invalidate 维护，没有生产级失效来源。
- **实现2**: `apps/api/app/domains/books/lineage_service.py`
  - 模式：`approve_chapter_writeback()` 将人工批准正文写入首个 scene，更新 `scene.status`、`chapter.status`，创建资产、证据和 continuity record 后 commit。
  - 可复用：该服务是人工批准章节正文的通用入口。
  - 需注意：写回后未调用 `clear_book_context_cache(book.id)`，如果之前已有 `get_book_context()` 缓存，后续 prompt 仍会读旧正文。
- **实现3**: `apps/api/app/domains/studio/service.py`
  - 模式：`_approve_scene_packet()` 和 `_approve_repair_patch()` 写回 Studio 批准结果，设置 scene/chapter 状态并记录 continuity。
  - 可复用：Studio 批准入口同样需要失效 BookContext。
  - 需注意：两个路径成功 commit 前应失效对应 book 缓存；失败/不可批准路径不能误清缓存。
- **实现4**: `apps/api/tests/test_book_context_cache.py`
  - 模式：直接构造 Book/Chapter/Scene 后验证 `BookContext.from_db()`、`compile_for_chapter()`、`clear_book_context_cache()`。
  - 可复用：新增多 Scene 拼接测试和缓存失效测试可沿用该风格。

### 2. 项目约定

- API 服务层使用 SQLAlchemy 2.0 `select()`、`order_by()`、`session.scalars()`；Context7 已在前序阶段确认该模式。
- 测试使用 pytest plain assert 和中文 docstring。
- 不新增外部依赖；只接线已有缓存工具。
- 不改变章节/场景状态语义，只修正缓存派生视图和多 Scene 聚合。

### 3. 可复用组件清单

- `BookContext.from_db()`: 初始化已批准前文缓存。
- `get_book_context()`: prompt assembly 读取缓存的主入口。
- `clear_book_context_cache(book_id)`: 精确清除单本缓存。
- `approve_chapter_writeback()`: 人工批准回写入口。
- `approve_studio_writeback()`: Studio 批准回写入口。

### 4. 测试策略

- 红灯1：同一 approved chapter 有两个 approved scene 时，`BookContext.from_db()` 的章节 content 必须按 `Scene.ordinal, Scene.id` 拼接两个正文。
- 红灯2：`approve_chapter_writeback()` 回写已批准章节正文后，旧 `get_book_context()` 实例必须失效，再次读取应得到新实例和新正文。
- 回归：`test_book_context_cache.py`、`test_approval_writeback.py`、`test_studio_book_list_api.py`、`test_prompt_assembly.py`、`test_phase9b_parallel_ports.py`。

### 5. 依赖和集成点

- 内部依赖：BookContext、Lineage writeback、Studio writeback、prompt assembly。
- 外部依赖：无新增。
- 集成方式：`BookContext.from_db()` 改为按 chapter 分组聚合 scene content；批准写回成功路径在 commit 后调用 `clear_book_context_cache(book.id)`。

### 6. 技术选型理由

- 缓存失效用已有 `clear_book_context_cache(book_id)`，避免新增事件总线或缓存版本表。
- 多 Scene 聚合在 `from_db()` 层完成，保持 `ApprovedChapter` 仍是一章一个缓存快照，调用方无需改协议。
- 只在成功 commit 后清缓存，避免失败回滚路径造成无意义缓存抖动。

### 7. 关键风险点

- 如果其他生产路径直接修改 approved Scene 而不走 Lineage/Studio/Phase9B，仍可能绕过缓存失效；后续可在统一 Scene repository 或 SQLAlchemy event 上补强。
- 多 Scene 拼接会增加上下文长度，但这是章节全文真实语义；预算裁剪已由 P0 `compile_blocks_for_chapter()` 控制。
