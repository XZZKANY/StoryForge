## 项目上下文摘要（Novelskill P1 并发依赖调度）

生成时间：2026-06-08 01:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：串行路径在每章 approved 后立即写入 completed/checkpoint，再启动下一章。
  - 可复用：`_chapter_progress()`、`_checkpoint_entry()`、`_with_integration_metrics()`、预算和 provider 降级暂停逻辑。
  - 需注意：并发路径 `_fill_chapter_window()` 当前一次性提交窗口，导致后续章节启动时看不到前序已提交上下文。
- **实现2**: `apps/workflow/tests/test_book_loop_three_chapters.py`
  - 模式：用 `Event`、`Lock`、`Barrier` 验证并发启动、按序提交、快速取消和一致性屏障。
  - 可复用：并发行为测试风格、progress_callback 观察提交顺序。
  - 需注意：现有并发测试要求“可预取”，P1 需要新增依赖模式，不能破坏默认无依赖预取测试。
- **实现3**: `apps/api/app/domains/book_runs/phase9b_parallel_ports.py`
  - 模式：API 侧每章独立 session，通过 workflow `run_book_loop()` 执行真实 Phase9B 小规模并发。
  - 可复用：`run_book_loop_with_thread_sessions()`、BookContext cache 观测、SQLAlchemy 查询计数、arc 屏障接线。
  - 需注意：真实 `_generate_chapter()` 在章节启动时调用 `assemble_prompt_injection()`，只有前序章已经 approved 并追加 BookContext 后才会拿到正确前文。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；pytest 测试使用 `test_...`，并发测试辅助对象用局部函数和事件。
- **文件组织**: workflow 调度契约放在 `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`；API 桥接默认策略放在 `phase9b_parallel_ports.py`。
- **导入顺序**: 标准库、第三方、项目模块分组；ruff I/F/W/B/SIM 门禁必须通过。
- **代码风格**: 简短中文注释说明调度约束，不新增依赖。

### 3. 可复用组件清单

- `BookLoopRequest`: 可新增布尔策略字段表达“章节生成必须等待前序提交”。
- `run_book_loop()`: 继续作为唯一 BookLoop 入口，避免新增平行调度器。
- `run_book_loop_with_thread_sessions()`: API 侧可透传 P1 策略给 workflow。
- `BookContext.append_chapter()` / `assemble_prompt_injection()`: Phase9B 真实前文依赖的事实源和读取点。

### 4. 测试策略

- **测试框架**: pytest。
- **红灯测试**: workflow 新增测试，启用依赖模式后第 2 章启动时必须已经收到第 1 章 progress callback；否则说明缺前文风险仍存在。
- **API 测试**: Phase9B 胶水层应默认启用依赖模式，替身测试验证第 2 章生成前第 1 章已提交。
- **回归范围**: workflow BookLoop 并发测试、API Phase9B parallel ports 测试、P0 相关 wrapper 测试。

### 5. 依赖和集成点

- **外部依赖**: Python `concurrent.futures.ThreadPoolExecutor`，已查 Context7 Python 文档确认 `shutdown(cancel_futures=True)` 与 `wait(FIRST_COMPLETED)` 行为。
- **内部依赖**: BookLoop 并发窗口、NovelLoopPorts.compile_context/generate_scene、Phase9B `_generate_chapter()` 的 BookContext 读取。
- **集成方式**: 新增可选策略字段，默认保持既有预取行为；Phase9B 真实 runner 显式启用依赖模式。
- **配置来源**: 本轮不新增环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: P1 的直接风险是后续章启动过早，导致 prompt 缺前序章正文；在现有单章端口没有“两段式校正”的情况下，先增加前序提交门禁是最小可验证修复。
- **优势**: 不新增调度器、不改 NovelLoop 端口、不影响默认并发预取测试；Phase9B 真实 runner 得到正确前文。
- **劣势和风险**: 对强相邻依赖场景会降低章节级并发利用率；真正两段式草稿/校正仍需后续设计。

### 7. 关键风险点

- **并发问题**: 如果依赖模式仍使用窗口预填，会再次出现缺前文；测试必须观测启动时机。
- **边界条件**: awaiting_review、预算暂停、provider 降级和 consistency barrier 仍需沿用既有提交逻辑。
- **性能瓶颈**: 依赖模式可能把章节生成串行化，但 judge/generate 内部和后续非相邻依赖并发可后续优化。
- **安全考虑**: 不重跑真实 provider，不记录凭据。
