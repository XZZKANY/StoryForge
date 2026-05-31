## 项目上下文摘要（BookRun workflow adapter）

生成时间：2026-06-01 02:40:21 +08:00

### 1. 相似实现分析

- **实现1**: D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_loop.py
  - 模式：BookLoopRequest / BookLoopResult 使用 @dataclass(frozen=True)，
un_book_loop() 接收
un_chapter: Callable[[int], NovelLoopResult] 回调。
  - 可复用：BookLoopRequest、BookLoopResult、
un_book_loop()。
  - 需注意：progress 由 completed_chapters、checkpoint、udget、locked_chapter、provider_degradation 等结构组成，adapter 不应重写这些结构。
- **实现2**: D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py
  - 模式：NovelLoopPorts 注入外部依赖，
un_single_chapter_loop() 可选接收 skill_runner，并通过 _skill_run_audit() 输出 skill_runs。
  - 可复用：NovelLoopRequest、NovelLoopPorts、
un_single_chapter_loop()。
  - 需注意：不传 skill_runner 时 skill_runs 为空；adapter 必须在每章创建 NovelSkillRunner.default()。
- **实现3**: D:\StoryForge\apps\workflow\storyforge_workflow\skills\runner.py
  - 模式：NovelSkillRunner 包装 generate/judge/repair/approve/memory_extract 端口调用，并记录引用化 NovelSkillRun。
  - 可复用：NovelSkillRunner.default() 与 NovelSkillRun.to_audit_dict()。
  - 需注意：审计记录不能保存完整正文或完整提示词，只保存引用、hash、状态和预算。
- **实现4**: D:\StoryForge\apps\api\tests\test_book_exporter.py
  - 模式：通过 SQLAlchemy session_factory 构造 Book、BookBlueprint、Chapter、Scene、BookRun 后调用 exporter。
  - 可复用：API exporter 测试的 seed 结构与断言风格。
  - 需注意：API 验收只验证 exporter 消费 progress.skill_runs，不改 API service 执行 workflow。
- **实现5**: D:\StoryForge\apps\workflow\storyforge_workflow\skills\audit.py
  - 模式：derive_skill_chain_projection() 优先消费章节 skill_runs，否则从 progress 重建事件。
  - 可复用：recorded/reconstructed 计数和 evidence_basis 语义。
  - 需注意：completed 状态仍会追加 reconstructed 的 export 事件。

### 2. 项目约定

- **命名约定**: Python 模块、函数、变量使用 snake_case；类使用 PascalCase；测试函数以 	est_ 开头。
- **文件组织**: workflow 编排器放在 pps/workflow/storyforge_workflow/orchestrators/，workflow 测试放在 pps/workflow/tests/；API 导出测试放在 pps/api/tests/。
- **导入顺序**: rom __future__ import annotations 在首行，其后标准库、第三方库、项目内导入分组。
- **代码风格**: Python 使用 pytest 函数式测试、中文 docstring 描述意图、@dataclass(frozen=True) 表达不可变请求/结果契约。

### 3. 可复用组件清单

- D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\book_loop.py: BookLoopRequest、BookLoopResult、
un_book_loop()。
- D:\StoryForge\apps\workflow\storyforge_workflow\orchestrators\novel_loop.py: NovelLoopRequest、NovelLoopPorts、
un_single_chapter_loop()。
- D:\StoryForge\apps\workflow\storyforge_workflow\skills\runner.py: NovelSkillRunner.default()。
- D:\StoryForge\apps\workflow\storyforge_workflow\skills\definitions.py: DEFAULT_NOVEL_SKILL_REGISTRY。
- D:\StoryForge\apps\api\app\domains\exports\book_markdown_exporter.py: export_book_run_audit_report()。

### 4. 测试策略

- **测试框架**: pytest，通过 uv run pytest 执行；Context7 pytest 官方文档确认可用 node id 精确运行单个测试。
- **测试模式**: workflow 使用 deterministic NovelLoopPorts；API 使用 session_factory 构造内存数据库数据。
- **参考文件**: D:\StoryForge\apps\workflow\tests\test_book_loop_three_chapters.py、D:\StoryForge\apps\workflow\tests\test_novel_loop_skill_runner_integration.py、D:\StoryForge\apps\api\tests\test_book_exporter.py。
- **覆盖要求**: 正常 completed、awaiting_review、chapter_budget 暂停、状态词一致性、API exporter recorded/reconstructed 混合证据。

### 5. 依赖和集成点

- **外部依赖**: pytest、SQLAlchemy、FastAPI TestClient、pnpm web test，均为项目已有依赖。
- **内部依赖**: adapter 依赖 workflow 编排器和技能 runner；API 测试依赖 exporter 与模型。
- **集成方式**: adapter 通过端口协议注入 chapter_goal、chapter_id、
ovel_loop_ports_factory、progress_sink，避免 workflow 直接访问 API ORM。
- **配置来源**: D:\StoryForge\apps\workflow\pyproject.toml 与 D:\StoryForge\apps\api\pyproject.toml 中的 pytest pythonpath = ["."]。

### 6. 技术选型理由

- **为什么用这个方案**: 现有 BookLoop 已处理整书状态，现有 NovelLoop 已支持 skill_runner，新增 adapter 是最小跨层拼接点。
- **优势**: 不改变 API 真相源职责，不重写审计投影，不保存敏感全文，复用现有预算、暂停和降级逻辑。
- **劣势和风险**: adapter 目前只定义 workflow 侧入口，实际 API/队列触发仍需后续生产接线；当前仓库存在既有未提交改动，验证报告需明确区分。

### 7. 关键风险点

- **并发问题**: 每章新建独立 NovelSkillRunner，避免跨章节共享 runs 状态。
- **边界条件**: 非 approved 章节应保留 blocked_chapter 中已记录的 generate/judge；预算暂停应保留已完成章节的 skill_runs。
- **性能瓶颈**: adapter 仅创建小对象并传递引用化字典，复杂度随章节数线性增长。
- **安全考虑**: 只记录 input_refs、output_refs、hash 和状态，不写完整正文或提示词。

### 8. 工具与检索记录

- desktop-commander：当前工具列表未暴露，已用 	ool_search 检索未发现对应文件工具；本轮使用 PowerShell 进行本地读取与写入，并在日志记录替代原因。
- context7：查询 /pytest-dev/pytest，用途是确认 pytest node id 精准运行和 fixture 自动发现规则。
- github.search_code：搜索 "ProgressSink" "Protocol" "emit" language:Python，用途是参考端口协议与 sink emit 的通用解耦形态。

### 9. 上下文充分性检查

- ✅ 能说出至少 3 个相似实现路径：book_loop.py、novel_loop.py、runner.py、test_book_exporter.py、audit.py。
- ✅ 理解实现模式：frozen dataclass 请求、ports 注入、回调编排、引用化审计记录。
- ✅ 知道可复用工具：
un_book_loop()、
un_single_chapter_loop()、NovelSkillRunner.default()、export_book_run_audit_report()。
- ✅ 理解命名和代码风格：snake_case、PascalCase、中文 docstring、pytest 函数测试。
- ✅ 知道测试方式：workflow deterministic ports，API session_factory seed，uv/pnpm 本地命令。
- ✅ 确认未重复造轮子：已有 BookLoop、NovelLoop、runner、audit/exporter 均复用，adapter 只做边界转换。
- ✅ 理解依赖和集成点：workflow adapter 不导入 API ORM，progress 通过 sink emit 回填。
