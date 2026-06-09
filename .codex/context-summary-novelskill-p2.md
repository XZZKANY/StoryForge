## 项目上下文摘要（Novelskill P2 记忆链重建）

生成时间：2026-06-08 05:35:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/story_memory/service.py`
  - 模式：`write_memory_extract_atoms()` 已能把 `chapter_summary`、`character_states`、`world_facts`、`foreshadow_refs` 写入 `memory_atoms`。
  - 可复用：`MemoryAtom`、`create_memory_atom()`、`get_active_memory_atoms()`、`recall_scene_memory_atoms()`。
  - 需注意：`recall_scene_memory_atoms()` 仍以关键词匹配为主，尚未接 pgvector；本轮先打通主链路与指标。
- **实现2**: `apps/api/app/domains/book_runs/prompt_assembly.py`
  - 模式：读取 Character Bible、Style Pack、Blueprint、BookContext 与 active memory atoms，产出 workflow prompt state。
  - 可复用：`_continuity_facts()`、`_atom_statement()`。
  - 需注意：当前跳过 `source_ref.startswith("character_bible:")`，导致角色规则 atom 无法进入 continuity。

- **实现3**: `apps/api/app/domains/book_runs/phase9b_parallel_ports.py`
  - 模式：P1.5 默认 `precommit_revision`，提交前批准最终 Scene、记录 ModelRun、ScenePacket、Judge，并把 extras 合并进 completed chapter progress。
  - 可复用：`chapter_extras`、`precommit_chapter()`、`_parallel_observed_metrics()`。
  - 需注意：当前没有调用 memory extraction，`memory_recall_budget_scope` 仍是 `phase9b_parallel_no_memory_retrieval`。
- **实现4**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：`NovelLoopPorts.extract_memory` 和 skill runner 已有审计路径，测试证明 `memory_atom_ids` 能进入 `NovelLoopResult`。
  - 可复用：`NovelLoopResult.memory_atom_ids`、BookLoop checkpoint/progress 中的 memory atom 字段。
  - 需注意：Phase9B 并发 runner 当前绕过 NovelLoop，因此需要在 API 胶水直接写入 memory atoms。

### 2. 项目约定

- API 服务层使用 SQLAlchemy Session `add/commit/refresh`；Context7 已查询 SQLAlchemy 2.0 ORM 文档确认该模式。
- 测试使用 pytest plain assert，中文 docstring 描述业务意图。
- integration metrics 统一保存在 `BookRun.progress["integration_metrics"]` 并由 audit exporter 投影。
- 不新增外部依赖；真实 provider 长跑仍需凭据安全确认。

### 3. 可复用组件清单

- `write_memory_extract_atoms()`: 把白名单抽取结构写入 Story Memory。
- `get_active_memory_atoms()`: 按章节 ordinal 读取有效记忆。
- `assemble_prompt_injection()`: 主 prompt 注入入口，可写入 continuity facts。
- `NovelLoopResult.memory_atom_ids`: BookLoop progress 已支持携带记忆引用。
- `_direct_memory_recall_budget_used()`: 读取 completed chapter 的 `memory_recall_chars` 汇总为指标。

### 4. 测试策略

- prompt 红灯：`character_bible:` 来源的 memory atom 必须进入 `continuity_facts`，不能被过滤。
- Phase9B 红灯：并发 runner 每章提交前应写入 memory atoms，并把 `memory_atom_ids` 写入 completed progress。
- 指标红灯：第 2 章及以后应写入 `memory_recall_chars`，`memory_recall_budget_used` 不再恒为 0，scope 不再是 `no_memory_retrieval`。
- 回归：prompt assembly、story memory、Phase9B parallel ports、exporter/wrapper 相关测试。

### 5. 依赖和集成点

- 内部依赖：Story Memory、Character Bible、BookContext、Phase9B precommit revision、audit exporter。
- 外部依赖：SQLAlchemy ORM；不新增依赖。
- 集成方式：Phase9B 提交前生成最终稿时读取 active memory 计算召回字符数，批准后写 extraction atoms，并把 atom ids 与召回字符数放进 progress。

### 6. 技术选型理由

- 先接通已有 `write_memory_extract_atoms()`，避免重复造 memory schema。
- 先用可重复的本地抽取规则覆盖真实 runner 测试；真实 LLM 抽取可后续用 provider 实现替换。
- 先解除 Character Bible atom 过滤，让已同步的角色规则进入 prompt；语义检索增强作为后续增量。

### 7. 关键风险点

- 当前召回排序仍是关键词/活跃区间基础，未完全达到 pgvector 语义检索目标。
- 自动抽取规则只能覆盖稳定结构化事实，不等价于真实 LLM 深度抽取。
- 真实 provider 未重跑；所有 P2 验证先基于本地替身和可重复测试。
