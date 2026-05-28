# 项目上下文摘要（StoryForge IDE SSE p95 基线）

生成时间：2026-05-28 19:00:38 +08:00

### 1. 相似实现分析

- **实现1**: pps/api/app/domains/ide/service.py::build_run_events 与 encode_sse_event
  - 模式：从 BookRun 真相源投影 progress/checkpoint/blocked/budget/provider_fallback/completed 事件，再编码为 SSE 文本。
  - 可复用：uild_run_events、encode_sse_event。
  - 需注意：当前是快照事件流，不是持续实时事件总线。
- **实现2**: pps/api/app/domains/ide/router.py::stream_run_events
  - 模式：FastAPI StreamingResponse 返回 	ext/event-stream，通过 get_book_run 读取真实 BookRun。
  - 可复用：/api/ide/runs/{book_run_id}/events 端点作为延迟测量入口。
  - 需注意：端点目前同步生成快照，TestClient p95 只能证明本地服务端路径，不等同真实浏览器/网络 e2e。
- **实现3**: pps/api/tests/test_ide_run_events.py
  - 模式：pytest + FastAPI TestClient + SQLite 内存库，先创建 BookRun，再 patch progress，再读取 SSE body。
  - 可复用：seed_locked_blueprint、client、session_factory、SSE 文本断言。
  - 需注意：已有测试验证内容正确，但不记录 p95 延迟报告。
- **实现4**: pps/web/scripts/measure-ide-build-budget.mjs
  - 模式：本地可执行脚本输出 .codex/*baseline.json，包含目标、阻断阈值和状态。
  - 可复用：报告结构、pass/warn/block 分类思路。
  - 需注意：API 侧使用 Python/pytest，不引入 Node 依赖。

### 2. 项目约定

- **命名约定**: Python 函数和变量使用 snake_case；测试函数以 	est_ 开头，中文 docstring 描述业务意图。
- **文件组织**: API 测试在 pps/api/tests/；可执行 API 辅助脚本放入 pps/api/scripts/；报告写入仓库根 .codex/。
- **导入顺序**: 标准库、第三方库、项目模块分组，遵循 ruff/isort。
- **代码风格**: Python 3.11+ 类型标注，行宽 120，中文注释/文档。

### 3. 可复用组件清单

- pps/api/tests/conftest.py: SQLite 内存库、TestClient 和依赖覆盖。
- pps/api/tests/test_book_runs.py::seed_locked_blueprint: 构造可启动 BookRun 的 locked Blueprint。
- pps/api/tests/test_ide_run_events.py: SSE 端点内容契约。
- pps/api/app/domains/book_runs/service.py::apply_book_run_progress: 写入 checkpoint 和预算进度。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient。
- **测试模式**: 先新增 	est_ide_sse_latency_budget.py，要求存在测量函数、输出 p95/阈值/事件摘要报告；红灯应因模块缺失失败。
- **覆盖要求**: 正常流程、p95 预算通过、报告 JSON 写入、事件 body 包含 progress/checkpoint/budget/completed。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 	ime.perf_counter、statistics 或自定义 percentile、json、rgparse、pathlib。
- **内部依赖**: FastAPI TestClient、pp.main.app、get_session 依赖覆盖、BookRun API。
- **集成方式**: 测试直接使用 pytest fixture；脚本 CLI 自建内存库和 TestClient，便于本地复现。
- **配置来源**: master plan §13.3：SSE 事件 e2e p95 目标 <500ms，阻断 >1.2s。

### 6. 技术选型理由

- **为什么用这个方案**: 不新增外部压测工具，使用现有 TestClient 测真实 API 路由，快速补齐本地 p95 证据。
- **优势**: 可重复、低成本、写入 .codex 报告，能覆盖后端路由和数据库依赖。
- **劣势和风险**: TestClient 不是浏览器 EventSource，也不经过真实网络代理；只能作为本地服务端 p95 基线。

### 7. 关键风险点

- **并发问题**: 该测量串行执行，避免内存 SQLite 并发污染。
- **边界条件**: 样本数过低会让 p95 不稳定；脚本应限制 samples >= 1 并在报告记录样本数。
- **性能瓶颈**: 若本地机器负载高，p95 可能波动；报告应保留每次 latency 明细。
- **安全考虑**: 仅访问本地 TestClient 和内存数据库，不读取外部凭据。
