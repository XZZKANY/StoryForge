## 项目上下文摘要（memory_extract 写入桥）

生成时间：2026-06-02 18:45:00

### 1. 相似实现分析

- **Novel Skill Registry**: `apps/workflow/storyforge_workflow/skills/definitions.py`
  - 模式：不可变 dataclass + `MappingProxyType` 静态注册表。
  - 可复用：`MEMORY_EXTRACT_SKILL` 已声明 `input_refs=("chapter_id", "draft_ref", "approved_scene_id")`、`output_refs=("memory_atom_ids",)`。
  - 需注意：当前描述明确“未注入 adapter 时按现有默认返回空列表”。
- **NovelLoop 端口与 runner**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`、`apps/workflow/storyforge_workflow/skills/runner.py`
  - 模式：workflow 只依赖端口，不直接依赖 API 数据库；`NovelSkillRunner` 只记录引用化审计字段。
  - 可复用：`NovelLoopPorts.extract_memory` 可注入生产写入函数；默认 `_skip_memory_extraction` 返回空列表。
  - 需注意：runner 不保存完整正文或 Provider 凭据，只保存 `memory_atom_ids` 和浅层引用。
- **Workflow tools registry**: `apps/workflow/storyforge_workflow/tools/registry.py`、`apps/workflow/tests/test_creative_tool_registry.py`
  - 模式：工具/技能 registry 都暴露 schema、能力、证据字段和 API/Workflow 映射，测试要求不可变快照和缺失项中文错误。
  - 可复用：保持静态契约，不把动态执行逻辑塞进 registry。
  - 需注意：本任务不新增工具注册表条目，只补 memory_extract 写入桥。
- **Story Memory service**: `apps/api/app/domains/story_memory/service.py`
  - 模式：服务函数首参为 `Session`，先校验 Book/Chapter 归属，再构造 `MemoryAtom` 并调用 `create_memory_atom` 写入。
  - 可复用：`create_memory_atom`、`list_memory_atoms`、`get_active_memory_atoms`。
  - 需注意：`apply_arbitration_decision` 面向 AgentProposal 仲裁，不适合作为章节抽取直写入口。
- **BookRun 章节生成后处理**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`、`apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：每章 `NovelLoopResult` 被折叠为 `completed_chapters` 和 `checkpoint`，通过 progress sink 回填 API。
  - 可复用：章节结果里的 `skill_runs` 已能审计 memory_extract 的状态和输出引用。
  - 需注意：本 worker 不触碰 BookRun volume 写集，只提供 Story Memory 服务入口。

### 2. 项目约定

- **命名约定**：Python 使用 `snake_case` 函数与变量名；领域模型/契约使用 `PascalCase`。
- **文件组织**：API 领域代码位于 `apps/api/app/domains/<domain>/`，测试位于 `apps/api/tests/`；workflow 编排位于 `apps/workflow/storyforge_workflow/`。
- **导入顺序**：`from __future__ import annotations` 后标准库、第三方、项目内模块。
- **代码风格**：中文 docstring 描述意图和约束；服务错误使用领域异常类；测试函数中文 docstring。

### 3. 可复用组件清单

- `apps/api/app/domains/story_memory/service.py:create_memory_atom`：唯一持久化 MemoryAtomRecord 的现有入口。
- `apps/api/app/domains/story_memory/service.py:list_memory_atoms`：验证写入结果和过滤查询。
- `apps/api/app/domains/story_memory/schemas.py:MemoryAtom`：章节有效区间、来源引用、实体类型和事实类型的契约。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:NovelLoopPorts.extract_memory`：生产 adapter 注入点。
- `apps/workflow/storyforge_workflow/skills/runner.py:NovelSkillRunner.run_memory_extract`：记录 `memory_updated` 或 `memory_extract_skipped` 的审计入口。

### 4. 测试策略

- **测试框架**：Pytest。
- **测试模式**：API 服务层测试使用内存 SQLite `session` fixture；workflow 测试使用端口注入和捕获 sink。
- **参考文件**：`apps/api/tests/test_story_memory_persistence.py`、`apps/api/tests/test_story_memory_contract.py`、`apps/workflow/tests/test_book_run_adapter.py`。
- **覆盖要求**：先写 RED 测试，覆盖章节摘要、角色状态、世界观事实、伏笔引用写入；断言 source_ref 可审计且不泄漏 Provider 凭据。

### 5. 依赖和集成点

- **外部依赖**：Pydantic v2 `BaseModel.model_validate` 官方文档确认可用作 dict 到契约对象的验证方式；本次不新增依赖。
- **内部依赖**：`Book`、`Chapter`、`MemoryAtom`、`create_memory_atom`。
- **集成方式**：API 侧新增窄服务入口，workflow 生产 adapter 后续可通过 `NovelLoopPorts.extract_memory` 注入调用。
- **配置来源**：不读取 Provider 配置，不接触 API Key 或环境变量。

### 6. 技术选型理由

- **为什么用这个方案**：Story Memory 已有持久化结构，新增服务入口比新增表或 workflow 直连数据库更小、更符合边界。
- **优势**：复用现有校验、审计字段和章节有效区间；避免跨 worker 写集冲突。
- **劣势和风险**：抽取 payload 的上游正式 schema 尚未固定，本次仅提供白名单映射；未来生产 adapter 仍需接入真实抽取器。

### 7. 关键风险点

- **并发问题**：逐条写入会产生多次 commit；当前单章条目较少可接受，后续可做批量事务优化。
- **边界条件**：无效 Book/Chapter 需沿用 `StoryMemoryInputError`；空字段应跳过而非写入空事实。
- **性能瓶颈**：单章 O(n) 映射和插入，n 为抽取条目数。
- **安全考虑**：只读取白名单字段，忽略 `provider_api_key`、`api_key`、`authorization`、`credential`、`password`、`secret`、`token` 等敏感键；`source_ref` 仅包含章节、批准场景和条目序号。
