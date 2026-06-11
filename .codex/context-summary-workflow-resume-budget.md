## 项目上下文摘要（Workflow 恢复预算与历史 completed_chapters）

生成时间：2026-06-03 01:30:27 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_book_loop_resume.py`
  - 模式：直接构造 `BookLoopRequest` 与内联 `run_chapter`，用 `seen` 证明恢复不会重复执行历史章节。
  - 可复用：`NovelLoopResult` 测试替身、`existing_checkpoint` 输入形状。
  - 需注意：历史 checkpoint 目前也会进入 `completed_chapters`，因此历史条目必须保留可投影字段。
- **实现2**: `apps/workflow/tests/test_book_loop_three_chapters.py`
  - 模式：覆盖顺序执行、恢复跳章、token 预算暂停、provider 降级暂停。
  - 可复用：预算断言使用 `result.progress["budget"]`，章节顺序断言使用 `chapter_index` 列表。
  - 需注意：预算暂停基于累计预算判断，恢复预算必须先计入历史消耗。
- **实现3**: `apps/workflow/tests/test_book_run_adapter.py`
  - 模式：通过 `CapturingProgressSink` 验证 adapter 产生标准 progress 与 `volume_progress`。
  - 可复用：`_passing_ports`、`BookRunAdapterRequest`、`run_book_run_with_skill_runner`。
  - 需注意：adapter 只应依赖 workflow 端口，不能引入 API ORM。
- **实现4**: `apps/workflow/tests/test_book_run_dispatch_payload.py`
  - 模式：通过 dispatch payload 覆盖 API 到 workflow 的字典协议，使用 `_dispatch_payload` 工厂减少重复。
  - 可复用：`_dispatch_payload`、`run_book_run_dispatch_payload`、`CapturingProgressSink`。
  - 需注意：payload 中 `existing_checkpoint` 必须原样映射到 adapter request。
- **实现5**: `apps/workflow/tests/test_skill_audit_summary.py`
  - 模式：审计投影优先使用 recorded `skill_runs`，并保留 progress 中的 `budget` 摘要。
  - 可复用：预算摘要字段名 `tokens_used`、`elapsed_time_sec`、`estimated_cost`。
  - 需注意：恢复后的历史 completed chapters 若没有 `skill_runs`，投影会降级为 reconstructed。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀和描述性蛇形命名；测试替身使用局部函数或 `_passing_ports`。
- **文件组织**: workflow 编排位于 `apps/workflow/storyforge_workflow/orchestrators/`，测试位于 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations` 在首行，标准库、第三方、项目导入分组。
- **代码风格**: Python 3.11，ruff 行宽 120；测试直接使用 pytest 普通 `assert`。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: `BookLoopRequest`、`run_book_loop`、`BookLoopResult`。
- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: `BookRunAdapterRequest`、`CapturingProgressSink`、dispatch payload 映射与 progress sink。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`: `NovelLoopResult` 与 `NovelLoopPorts`。
- `apps/workflow/tests/test_book_run_adapter.py`: `_passing_ports` 风格的端口替身。

### 4. 测试策略

- **测试框架**: pytest，`apps/workflow/pyproject.toml` 配置 `testpaths = ["tests"]` 与 `pythonpath = ["."]`。
- **测试模式**: 单元测试直接调用 workflow 函数；用 `CapturingProgressSink` 验证 adapter 回填 payload。
- **参考文件**: `apps/workflow/tests/test_book_loop_resume.py`、`apps/workflow/tests/test_book_run_adapter.py`、`apps/workflow/tests/test_book_run_dispatch_payload.py`。
- **覆盖要求**: existing_checkpoint 恢复预算、历史 completed_chapters 的 skill_runs 保留、dispatch payload 到 adapter 的映射。
- **官方文档**: Context7 查询 `/pytest-dev/pytest`，确认 pytest 推荐普通 `assert` 与自动发现测试文件。

### 5. 依赖和集成点

- **外部依赖**: pytest；不新增依赖。
- **内部依赖**: adapter 将 dispatch payload 转为 `BookRunAdapterRequest`，再转为 `BookLoopRequest`；BookLoop 输出 progress 给 sink。
- **集成方式**: `existing_checkpoint` 同时作为恢复跳章依据、历史 `completed_chapters` 和初始预算来源。
- **配置来源**: workflow 测试由 `apps/workflow/pyproject.toml` 管理；`tests/conftest.py` 隔离 SQLite 路径。

### 6. 技术选型理由

- **为什么用这个方案**: 任务是回归补测和小范围修正，直接在已有 pytest 单元测试中补行为断言最稳定。
- **优势**: 不触碰 API/Web，不新增工具，能本地复现恢复语义。
- **劣势和风险**: 既有工作树已有他人改动，必须避免覆盖；历史 checkpoint 旧数据可能缺少预算字段，测试应明确“带预算字段时必须恢复累计”。
- **开源参考**: GitHub 搜索 `resume checkpoint budget pytest language:Python` 显示通用实践是用回归测试固定恢复状态与预算字段；精确的 `completed_chapters skill_runs` 未找到同名实现。

### 7. 关键风险点

- **并发问题**: 本任务仅纯函数测试，无并发共享状态。
- **边界条件**: 历史 checkpoint 可能缺预算字段，现有 `_int_value/_float_value` 对缺失或非正数回落 0。
- **性能瓶颈**: 恢复预算使用线性求和，章节数级别可接受。
- **安全考虑**: 不读取 `.env`，不输出密钥，不触碰 API/Web。

### 8. 充分性检查

- 能定义接口契约：是。`existing_checkpoint` 输入为章节字典列表，输出 progress 必须保留历史完成章节、checkpoint、budget。
- 理解技术选型：是。沿用现有 dataclass 和 pytest 单元测试，不引入新抽象。
- 识别风险点：是。重点是 `_checkpoint_entry` 的字段保留与历史条目语义。
- 知道如何验证：是。运行用户指定的三份 pytest 文件。
