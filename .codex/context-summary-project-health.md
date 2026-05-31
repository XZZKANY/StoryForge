# StoryForge 项目健康评估上下文摘要

生成时间：2026-06-01 04:18:46 +08:00

## 1. 当前分支与提交状态

- 当前分支：codex/project-health-assessment-plan。
- 最近提交：0de0c4c 新增 StoryForge 项目健康评估计划。
- 评估基线包含 master 合并提交 944f9db 合并 BookRun workflow adapter recorded skill_runs。
- 当前 stash 不恢复、不删除；最新相关 stash 为 stash@{0}: 合并 BookRun workflow adapter 前保护任务外 .codex 脏文件。
- 本轮评估仅修改 .codex 评估文档，不修改 apps/** 业务代码。

## 2. 主链路文件定位

| 模块 | 文件 | 关键位置 | 职责 |
| --- | --- | --- | --- |
| workflow adapter | apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py | 13, 35, 61 | 接收 BookRun adapter 请求，构造 BookLoopRequest，在每章 NovelLoop 注入 NovelSkillRunner，并通过 progress sink 回填。 |
| BookLoop | apps/workflow/storyforge_workflow/orchestrators/book_loop.py | 35, 94 | 顺序驱动章节，处理 checkpoint、预算暂停、provider degradation 和 skill_runs 写入 progress。 |
| NovelLoop | apps/workflow/storyforge_workflow/orchestrators/novel_loop.py | 110, 124, 146, 154, 160, 174, 189 | 单章 compile/generate/judge/repair/approve/memory_extract 闭环；有 skill_runner 时记录真实技能运行。 |
| SkillRunner | apps/workflow/storyforge_workflow/skills/runner.py | 17, 46, 64, 89, 115, 138, 163 | 生成 NovelSkillRun 审计记录，保存引用和摘要，不保存完整提示词或正文。 |
| audit projection | apps/workflow/storyforge_workflow/skills/audit.py | 51, 61, 66, 69, 213, 232 | 把 BookLoop progress 转为 skill_chain 投影，优先 recorded_skill_run，必要时 reconstructed。 |
| API BookRun service | apps/api/app/domains/book_runs/service.py | 26, 67, 124, 150 | API 侧 BookRun 真相源，负责创建、读取、progress patch、retry/resume。 |
| exporter | apps/api/app/domains/exports/book_markdown_exporter.py | 51, 67 | 导出 audit_report.json，并注入 derive_book_run_skill_chain。 |
| Web audit | apps/web/app/book-runs/audit.tsx | 85, 150, 189, 269 | 展示 skill_chain summary、章节技能链、事件和证据来源。 |

## 3. 相似实现与关键模式分析

### 3.1 Workflow adapter 模式

- 证据：apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py:13-98。
- BookRunAdapterRequest 是 frozen dataclass，不包含 API ORM 对象。
- BookRunAdapterPorts 通过 chapter_goal、chapter_id、novel_loop_ports_factory、progress_sink 注入外部依赖。
- run_book_run_with_skill_runner 在 workflow 包内构造 BookLoopRequest，不访问 API 数据库。
- run_chapter 内部创建 NovelLoopRequest 和 NovelSkillRunner.default()，再调用 run_single_chapter_loop。
- 结果通过 progress_sink.emit 回填，适合测试、本地 service adapter 或未来 HTTP adapter。
- 风险：adapter 目前是可验证能力，但尚未接入真实生产触发路径。

### 3.2 BookLoop/NovelLoop 编排模式

- 证据：apps/workflow/storyforge_workflow/orchestrators/book_loop.py:35-91；apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:110-190。
- BookLoop 只关心章节结果状态、预算、checkpoint 和 fallback metadata。
- NovelLoop 负责单章步骤和修复循环，最终仅返回 approved 或 awaiting_review。
- skill_runner 是可选端口；未注入时保持原有 NovelLoop 行为，注入时记录 generate/judge/repair/approve/memory_extract。
- BookLoop 的 _chapter_progress 已把 result.skill_runs 写入 progress，形成 audit/export 可消费的事实源。
- 风险：LangGraph 节点运行与章节 skill_runs 仍是两条边界，不能混用。

### 3.3 Audit/export/Web 投影模式

- 证据：apps/workflow/storyforge_workflow/skills/audit.py:51-78；apps/api/app/domains/exports/book_markdown_exporter.py:51-80；apps/web/app/book-runs/audit.tsx:85-130。
- audit projection 从 progress 只读派生 skill_chain，不修改 checkpoint。
- 对 completed_chapters 和 blocked_chapter 优先读取 recorded skill_runs；无 recorded 时重建 reconstructed 事件。
- completed BookRun 会追加 export 事件，因此可出现 mixed evidence。
- exporter 将 skill_chain 写入 audit_report.json。
- Web 审计面板显示 schema、状态、事件数、完成章节和 evidence_basis。
- 风险：UI 可见性已被测试覆盖，但真实上下文的端到端人工可读性仍需周期性验真。

### 3.4 API 真相源模式

- 证据：apps/api/app/domains/book_runs/service.py:26-85。
- create_book_run 要求 blueprint locked，创建 running 状态并初始化 progress/checkpoint/budget。
- apply_book_run_progress 接收 workflow 回填的 status/current_chapter_index/progress，并从 progress 派生 checkpoint 和 budget。
- API service 不直接运行 workflow；这是当前架构边界。
- 风险：真实生产接线需要在 API 与 workflow 之间增加 adapter 调度或 HTTP 回填，不应在 API service 内直接调用长任务。

## 4. 测试与验证入口

### workflow

- apps/workflow/tests/test_book_run_adapter.py：adapter recorded skill_runs、awaiting_review、预算暂停、状态词一致性。
- apps/workflow/tests/test_book_loop_three_chapters.py：BookLoop completed、awaiting_review、resume、预算、provider degradation。
- apps/workflow/tests/test_skill_audit_summary.py：skill_chain 投影、recorded/reconstructed、不可变、最小暴露。
- apps/workflow/tests/test_novel_skill_runner.py：SkillRunner 记录、引用字段和状态。

### API

- apps/api/tests/test_book_run_recorded_skill_runs_export.py：recorded skill_runs 经 audit_report 变为 mixed evidence。
- apps/api/tests/test_book_exporter.py：Markdown/audit artifacts 和 recorded skill_chain 导出。
- apps/api/tests/test_book_runs.py：BookRun 创建、progress patch、预算、resume。

### Web

- apps/web/tests/book-run-audit.test.tsx：BookRun 审计面板章节证据链、skill_chain 优先展示、空状态。

## 5. 初步风险观察

1. R1：BookRun adapter 已有本地可验证入口，但尚未接入生产触发路径；这会限制 recorded skill_runs 的真实运行覆盖。
2. R2：LangGraph 节点运行与章节 skill_runs 需要保持边界，否则容易把节点级 telemetry 冒充章节技能实录。
3. R3：phase9b_real_llm_smoke.py 仍应视为 smoke 工具，不能作为主线架构事实源。
4. R4：技能定义中的 source_refs 行号和静态诊断信息有腐烂风险，需要 runtime 校验或去行号化。
5. R5：API pytest 存在既有 warnings，需要分类确认是否阻塞。
6. R6：历史 stash 与 .codex 工作文件存在，但本轮不恢复，避免污染评估基线。

## 6. 充分性检查

- 能定义主链路接口契约：是，API progress、BookRunAdapterPorts、BookLoopResult.progress、skill_chain projection 已定位。
- 理解关键技术选型理由：是，使用 ports/dataclass 保持 workflow 与 API 解耦，audit 只读投影保持 checkpoint 稳定。
- 识别主要风险点：是，生产接线缺口、节点/章节事件边界、smoke 工具边界、静态 source_refs 腐烂、warning 分类。
- 知道如何验证实现：是，使用 workflow/API ruff 与 pytest、Web audit contract、主链路目标测试集合。
