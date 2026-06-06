## 项目上下文摘要（真实 LLM 断点续跑）

生成时间：2026-06-05 23:20:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：创建一次 BookRun，按章节串行生成、批准 scene、记录 ModelRun、记录 ScenePacket、执行 Judge/Repair，最终导出 Markdown 与 audit。
  - 可复用：`_generate_chapter`、`_approve_scene`、`_record_model_run`、`_record_scene_packet`、`_judge_and_repair_loop`、`_pause_by_budget`。
  - 需注意：原实现只在全量完成后写入 `BookRun.progress.completed_chapters`，中断时 SQLite 有章节正文但 BookRun 进度为空。
- **实现2**: `.codex/run-real-llm-long-direct.py`
  - 模式：创建一次性 SQLite 运行目录，调用业务 smoke，导出 `summary.json`、`book.md`、`audit_report.json`、`run-metadata.json` 等脱敏证据。
  - 可复用：`_metadata`、`_write_audit_templates`、`_sensitive_hit_count`、`_raise_for_gate_failures`。
  - 需注意：当前每次新建 SQLite，不支持从失败运行目录复制数据库续跑。
- **实现3**: `apps/api/app/domains/exports/book_markdown_exporter.py`
  - 模式：导出器要求 `BookRun.status == "completed"`，Markdown 从已批准章节/scene 读取，audit 从 `BookRun.progress.completed_chapters` 读取。
  - 可复用：`export_book_run_markdown`、`export_book_run_audit_report`。
  - 需注意：resume 完成前必须补齐所有章节的 `model_run_id`、`judge_report_id`、`approved_scene_id`。

### 2. 项目约定

- **命名约定**: Python 函数和变量使用 snake_case，测试函数以 `test_` 开头。
- **文件组织**: 业务逻辑在 `apps/api/app/domains/...`，真实长程运行包装在项目 `.codex/`。
- **导入顺序**: 标准库、第三方库、项目内模块分组导入。
- **代码风格**: 使用类型标注，中文注释解释约束和意图，测试使用 pytest。

### 3. 可复用组件清单

- `run_phase9b_real_llm_smoke`: 原始全量真实 LLM 冒烟入口。
- `apply_book_run_progress`: 统一回填 BookRun 状态、预算和 checkpoint。
- `export_book_run_markdown`: 导出 completed BookRun 正文。
- `export_book_run_audit_report`: 导出 completed BookRun 审计报告。
- `create_engine + sessionmaker`: 现有 wrapper 使用的 SQLite 会话模式。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 定向单元测试优先，使用本地 fake runner 或本地 HTTP provider，避免真实外呼。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/api/tests/test_phase9b_real_llm_long_wrapper.py`。
- **覆盖要求**: resume 不重跑已批准章节、复制失败 SQLite 到新目录、最终产物完整、旧失败目录不被污染。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy，官方文档确认 `create_engine` 与 `sessionmaker` 可绑定 SQLite 文件数据库。
- **内部依赖**: BookRun、Chapter、Scene、ModelRun、JudgeIssue、ScenePacket、Artifact。
- **集成方式**: wrapper 复制旧 SQLite，业务层根据已批准章节重建 progress 并从下一章继续。
- **配置来源**: 继续使用进程环境变量，PowerShell `-Interactive` 注入，不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 旧失败目录是审计证据，不能原地污染；复制 SQLite 后续跑可保留前 21 章成果并生成新的完整证据目录。
- **优势**: 节省真实外呼成本，失败可审计，符合现有一次性运行目录模型。
- **劣势和风险**: 若旧 SQLite 中某章缺少 model_run/judge/scene_packet，需要明确失败而不是伪造 audit。

### 7. 关键风险点

- **并发问题**: 不在原目录原地写入，避免污染失败证据。
- **边界条件**: 已批准章节数等于总章数时只导出；缺少章节计划或审计证据时报错。
- **性能瓶颈**: 只复制单个 SQLite 文件，章节生成仍串行。
- **安全考虑**: 不读取 `.env`，不落盘供应商凭据，最终产物继续敏感扫描。
