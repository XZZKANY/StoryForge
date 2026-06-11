## 项目上下文摘要（真实 LLM 补章性能优化）

生成时间：2026-06-06 01:57:35 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：真实长程 smoke 采用同步章节循环，逐章执行生成、落库、Judge/Repair、进度汇总。
  - 可复用：`_generate_chapter`、`_record_model_run`、`_record_scene_packet`、`_judge_and_repair_loop`、`_record_summary_judge`。
  - 需注意：`run_phase9b_real_llm_smoke` 与 `resume_phase9b_real_llm_smoke` 都在每章生成后立即进入 Judge/Repair；这是用户观察到章节间 80-160 秒间隔的主要代码边界。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：单章闭环为 `compile -> generate -> static quality -> judge -> repair -> approve`，外部依赖通过 `NovelLoopPorts` 注入。
  - 可复用：`check_static_quality` 端口、`judge_scene` 端口、`repair_scene` 端口、`_has_high_severity` 高危门禁。
  - 需注意：无静态问题时仍会调用 `judge_scene`；静态中低风险问题会先 repair 再 judge。
- **实现3**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：BookLoop 顺序调用 `run_chapter(chapter_index)`，按 checkpoint、预算、provider 降级阈值暂停。
  - 可复用：`BookLoopRequest` 的预算字段、`progress_callback`、`_chapter_progress` 审计结构。
  - 需注意：直接并发章节会影响 current_chapter_index、checkpoint 顺序和续写上下文，短期风险高。
- **实现4**: `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - 模式：使用本地 `HTTPServer` 模拟 OpenAI 兼容 provider，通过请求次数断言生成和 Judge 调用边界。
  - 可复用：`_Phase9BChatHandler`、`_local_provider_base_url`、环境变量注入与恢复模式。
  - 需注意：现有 10 章测试断言生成请求 10 次、Judge 请求 10 次；优化后需要明确快速路径的请求次数契约。

### 2. 项目约定

- **命名约定**: Python 函数、变量使用 snake_case；pytest 用 `test_` 前缀。
- **文件组织**: workflow 抽象位于 `apps/workflow/storyforge_workflow`；真实 smoke 与 API 数据库集成位于 `apps/api/app/domains/book_runs`。
- **导入顺序**: 标准库、第三方、项目内部依次排列，文件已使用 `from __future__ import annotations`。
- **代码风格**: 类型标注明确；注释和文档字符串使用简体中文；测试偏向直接断言行为。

### 3. 可复用组件清单

- `apps/api/app/domains/judge/service.py`: `deterministic_judge_fallback`、`semantic_judge_with_status`、一致性检测器。
- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: `_quality_score`、`_record_summary_judge`、`_maybe_repair`、`_CATEGORY_DIMENSION`。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`: 静态质量门禁与端口化单章闭环。
- `apps/workflow/storyforge_workflow/skills/runner.py`: 技能运行审计记录，不保存完整正文或提示词。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: API 层使用 SQLAlchemy session fixture 与本地 fake provider；workflow 层使用端口函数和调用列表断言。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/workflow/tests/test_novel_loop_single_chapter.py`、`apps/workflow/tests/test_book_loop_three_chapters.py`。
- **覆盖要求**: 低风险章节应跳过语义 Judge 并保留通过审计；命中确定性问题章节仍应进入完整 Judge/Repair；现有生成、断点续跑和导出测试保持通过。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 `/chat/completions`，通过 `STORYFORGE_LLM_*` 环境变量配置。
- **内部依赖**: BookRun、Chapter、Scene、ScenePacket、JudgeIssue、RepairPatch、ModelRun。
- **集成方式**: phase9b 真实 smoke 直接调用 API 域服务和 Judge 服务；workflow 抽象通过端口注入。
- **配置来源**: `.codex/run-real-llm-long-direct.py` 传入 timeout、budget、resume 目录；phase9b 模块读取环境变量。

### 6. 技术选型理由

- **为什么先优化 Judge 快速路径**: 章节生成并发会破坏续写上下文顺序、checkpoint 和预算语义；Judge 快速路径只改变低风险章节的评审入口，影响面更小。
- **优势**: 对无确定性问题章节减少一次真实长文本 Judge 网络调用；保留确定性、本地一致性和通过审计。
- **劣势和风险**: 语义 Judge 可能发现确定性规则覆盖不到的隐性叙事问题；必须保留环境开关和问题章节深查路径。

### 7. 关键风险点

- **并发问题**: 章节并发会影响前情 recap 和数据库进度顺序，本轮不实施。
- **边界条件**: 语义 Judge 调用失败时不能误标为通过；确定性检测命中问题时不能跳过深查。
- **性能瓶颈**: 当前每章至少一次生成网络调用和一次 Judge 网络调用；有问题章节最多 3 轮 Judge/Repair。
- **安全考虑**: 不输出私有 provider URL 或 API key；不降低质量门禁阈值。

