# 项目上下文摘要（novel-skill-framework）

生成时间：2026-05-31 02:20:00 +08:00

## 1. 相似实现分析

- **实现1**：D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py
  - 模式：NovelLoopRequest、NovelLoopResult 与 NovelLoopPorts 使用 frozen dataclass 和端口注入，把单章 compile_context -> generate_scene -> record_model_run -> judge_scene -> repair_scene -> approve_scene -> extract_memory 串成闭环。
  - 可复用：第一批 Novel Skill 应直接映射这些端口，而不是新增平行编排器。
  - 需注意：BookLoop 依赖 NovelLoopResult.status == "approved" 判断章节是否完成，技能化不能破坏该状态契约。
- **实现2**：D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\book_loop.py
  - 模式：整书顺序驱动每章 NovelLoop，并按 checkpoint、token/时间/章节预算、provider 连续降级暂停。
  - 可复用：技能运行记录应进入 completed_chapters、checkpoint、budget 与后续审计报告，而不是保存完整草稿到 workflow checkpoint。
  - 需注意：暂停原因、章节索引、模型运行引用、评审引用和批准场景引用必须保持可恢复。
- **实现3**：D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\runtime\runner.py
  - 模式：WorkflowRuntime 将 provider 执行、checkpoint、ModelRunSink 和 lifecycle 串联，失败时保存运行态证据。
  - 可复用：Novel Skill Runner 后续应沿用 provider 执行摘要和 ModelRun 记录边界，不直接绕过 runtime 记录。
  - 需注意：运行态只保存摘要和引用，避免大上下文进入 checkpoint。
- **实现4**：D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\persistence.py
  - 模式：summarize_value() 生成稳定摘要，避免检查点保存完整大对象。
  - 可复用：技能执行记录中的 input/output 应保存摘要、引用和预算，不保存完整 prompt、完整 Scene Packet 或完整正文。
- **实现5**：D:\StoryForge\1-renovel-ai-ai-rag-tavern\docs\architecture\phase6-workbench-contract.md
  - 模式：Studio、Retrieval、Runs、Artifacts、Evaluations 均以最小契约、单点读取和明确边界描述能力。
  - 可复用：技能框架第一阶段只做设计和映射，不宣称完整交互式 Studio 编排器。

## 2. 项目约定

- **命名约定**：Python 使用 snake_case 函数、PascalCase dataclass；Web/文档保留 StoryForge、BookRun、NovelLoop、Scene Packet 等既有领域名。
- **文件组织**：设计文档放入 docs/superpowers/specs/；执行计划放入 docs/superpowers/plans/；上下文、日志和验证放入项目本地 .codex/。
- **导入顺序**：Python 文件使用 from __future__ import annotations、标准库、第三方、项目内模块的现有顺序；本次不改代码。
- **代码风格**：现有 workflow 倾向 frozen dataclass、纯函数编排、端口注入、本地 deterministic pytest；本次设计应沿用该方向。

## 3. 可复用组件清单

- D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py：单章生成、评审、修复、批准、记忆抽取闭环。
- D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\orchestrators\book_loop.py：整书章节顺序编排、预算暂停和 checkpoint 记录。
- D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\runtime\runner.py：provider 执行与运行态记录边界。
- D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\workflow\storyforge_workflow\persistence.py：审计 checkpoint 和摘要化工具。
- D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\api\app\domains\book_runs\service.py：BookRun 创建、读取、进度更新和导出边界。
- D:\StoryForge\1-renovel-ai-ai-rag-tavern\docs\architecture\phase5-context-memory-architecture.md：上下文记忆和引用化状态边界。
- D:\StoryForge\1-renovel-ai-ai-rag-tavern\docs\architecture\workflow-modelrun-adapter-contract.md：ModelRun 与 checkpoint 分层边界。

## 4. 测试策略

- **测试框架**：Python 使用 pytest；根级使用 pnpm verify、pnpm e2e、pnpm test；文档级变更至少执行文档存在性、空内容标记、关键章节和路径检查。
- **本次范围**：只产出设计文档，不改业务代码，不运行全量测试作为代码正确性声明。
- **后续实现测试建议**：新增或扩展 apps/workflow/tests/test_novel_loop_single_chapter.py、BookRun 审计报告测试、技能注册表测试和技能执行记录测试。

## 5. 依赖和集成点

- **外部依赖**：现有 LangGraph、本地兼容 runtime、FastAPI、SQLAlchemy、Next.js；本设计不新增外部依赖。
- **内部依赖**：BookRun 依赖 Blueprint 锁定状态；NovelLoop 依赖 Scene Packet、Compiled Context、ModelRun、Judge、Repair、Approve 和 Story Memory。
- **集成方式**：第一阶段把现有 BookRun 步骤声明为技能；第二阶段再引入 Skill Registry / Skill Runner；第三阶段按题材扩展技能包。
- **配置来源**：当前能力事实以 README.md、current-phase.md、PROJECT_SUMMARY.md、docs/architecture/* 为准。

## 6. 技术选型理由

- **为什么采用技能框架**：现有 BookRun 已经是固定流程，技能化能把每一步的触发条件、输入输出、门禁、版本和审计记录显式化。
- **优势**：提高可复现性、可审计性、可替换性和题材扩展能力。
- **劣势和风险**：如果过早引入动态插件或多 Agent 并行，会破坏现有稳定闭环；因此第一阶段只做静态技能定义和映射。

## 7. 关键风险点

- **并发问题**：多技能并行可能破坏章节顺序和记忆回写顺序，第一阶段保持串行。
- **边界条件**：技能失败、评审不通过、修复超限、预算耗尽、provider 降级必须映射回现有 BookRun 状态。
- **性能瓶颈**：技能执行记录不能保存完整大对象，必须保存引用和摘要。
- **安全考虑**：本设计不新增认证、鉴权或密钥处理逻辑；provider 密钥仍按现有运行环境边界处理。

## 8. 工具约束记录

- 当前 Codex 会话未暴露 sequential-thinking、shrimp-task-manager、desktop-commander、context7、github.search_code 为可调用工具。
- 已通过 PowerShell 只读检查确认本机 MCP 配置存在且 server 可协议级列出工具；本次文档生成仍使用当前会话可用的本地文件读取作为替代。

