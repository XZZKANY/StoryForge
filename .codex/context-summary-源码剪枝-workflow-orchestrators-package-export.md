## 项目上下文摘要（源码剪枝 workflow-orchestrators-package-export）

生成时间：2026-06-05 11:22:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：BookRun adapter 的具体实现模块，定义 `BookRunAdapterRequest`、`BookRunAdapterPorts`、progress sink 和运行函数。
  - 可复用：必须保留具体模块和全部行为。
  - 需注意：测试当前直接从该模块导入。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/__init__.py`
  - 模式：仅重新导出 `book_run_adapter.py` 中的 BookRun adapter 符号。
  - 可复用：无当前仓库调用方；属于重复公共出口。
  - 需注意：保留包目录语义即可，不应继续转导出具体 adapter。
- **实现3**: `apps/workflow/tests/test_book_run_adapter.py`
  - 模式：直接导入 `storyforge_workflow.orchestrators.book_run_adapter`，验证 adapter 运行、progress 回填、技能状态映射等行为。
  - 可复用：本批定向验证核心测试。
  - 需注意：本批不能改变 adapter 行为。
- **实现4**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：通过 pathlib 读取文件文本，防止已下线或重复出口回归。
  - 可复用：新增 orchestrators 包级转导出护栏。
  - 需注意：说明使用简体中文。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: Workflow 编排器具体模块位于 `storyforge_workflow/orchestrators/`；包级初始化文件不承担重复公共出口。
- **导入顺序**: 标准库导入在前，项目内导入在后；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: BookRun adapter 事实源。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: BookLoop 事实源。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`: NovelLoop 事实源。
- `apps/workflow/tests/test_book_run_adapter.py`: adapter 定向测试。
- `apps/workflow/tests/test_book_run_dispatch_payload.py`: dispatch payload 定向测试。
- `apps/workflow/tests/test_source_pruning.py`: 本批剪枝护栏。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_book_run_adapter.py`、`tests/test_book_run_dispatch_payload.py`、`tests/test_book_loop_three_chapters.py`、`tests/test_novel_loop_single_chapter.py`。
- **覆盖要求**: `orchestrators/__init__.py` 不再转导出 BookRun adapter 符号；具体编排器行为不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff。
- **内部依赖**: 测试和实现直接导入 `orchestrators.book_run_adapter`、`book_loop`、`novel_loop`。
- **集成方式**: 移除重复包级出口，不修改具体模块。
- **配置来源**: `apps/workflow/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from storyforge_workflow.orchestrators import ...` 调用，包级转导出只增加重复入口。
- **优势**: 具体模块成为唯一入口，降低维护面。
- **劣势和风险**: 外部未记录包级导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除或修改 `book_run_adapter.py`、`book_loop.py`、`novel_loop.py`。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改 API、Provider、认证或外部请求逻辑。
