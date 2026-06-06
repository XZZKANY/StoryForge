## 项目上下文摘要（剩余四项性能质量修复）

生成时间：2026-06-06 18:22:51 +08:00

### 1. 相似实现分析

- **Provider 调用边界**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：`generate_text()` 组装 OpenAI 兼容 Chat Completions payload，`_post_chat_completion()` 负责 HTTP、连接复用和重试。
  - 可复用：现有 `provider_config()`、`_post_chat_completion()`、`_float_env()`、`_int_env()`。
  - 需注意：OpenAI prompt caching 字段是顶层 payload 字段；Anthropic `cache_control` 不应塞入 OpenAI 兼容请求。

- **Runtime checkpoint 持久化**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：`RuntimeCheckpointStore.save_state()` 先通过 `checkpoint_reference_state()` 引用化，再写 SQLite 最新态与快照表。
  - 可复用：现有 `_connect()` 单连接复用、`RLock`、SQLite WAL 配置、`close()` 资源释放边界。
  - 需注意：write-behind 必须在 `load_state()`、`list_*()`、`close()` 前 flush，避免恢复读到旧状态。

- **NovelLoop memory 端口**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：`NovelLoopPorts.extract_memory` 默认跳过，approve 成功后由 `NovelSkillRunner.run_memory_extract()` 记录状态。
  - 可复用：`NovelLoopRequest`、`NovelLoopPorts`、`memory_atom_ids`、`skill_runs.output_refs`。
  - 需注意：workflow 层不直接 import API ORM，真实 DB 写入应由生产 ports 工厂注入。

- **Prompt context 适配层**: `apps/workflow/storyforge_workflow/prompts/context.py`
  - 模式：`narrative_context_from_state()` 只把 state 注入键归一成 `NarrativeContext`，不读数据库。
  - 可复用：`ContinuityFact`、`_str()`、`_positive_int()`、`StyleDirective.pov`。
  - 需注意：排序和截断应在 context 边界完成，避免 prompt builder 承担业务优先级。

### 2. 项目约定

- **命名约定**: Python 函数、变量、测试使用 snake_case；测试函数以 `test_` 开头。
- **文件组织**: workflow 端口逻辑留在 `apps/workflow/storyforge_workflow`；API DB 状态逻辑留在 `apps/api/app/domains`。
- **导入顺序**: `from __future__ import annotations` 后标准库、第三方、项目内导入。
- **代码风格**: 注释、测试说明和错误说明使用简体中文；不新增外部依赖。

### 3. 可复用组件清单

- `provider_client.generate_text()`: Provider payload 组装入口。
- `RuntimeCheckpointStore.flush()`: write-behind 缓冲刷盘边界。
- `BookRunAdapterPorts.memory_extractor`: API/生产侧真实 memory 写入闭包注入点。
- `NovelSkillRunner.run_memory_extract()`: memory_extract 技能审计记录。
- `write_memory_extract_atoms()`: API 侧真实 Story Memory 写入桥。
- `_checkpoint_from_progress()`: API BookRun checkpoint 引用白名单。
- `_timeline_evidence_refs()`: Timeline 证据引用白名单。
- `narrative_context_from_state()`: continuity facts 排序截断入口。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: workflow 侧单元/集成测试，API 侧服务层定向测试。
- **参考文件**:
  - `apps/workflow/tests/test_llm_provider.py`
  - `apps/workflow/tests/test_workflow_lifecycle.py`
  - `apps/workflow/tests/test_book_run_adapter.py`
  - `apps/workflow/tests/test_prompt_builder.py`
  - `apps/api/tests/test_book_runs.py`
  - `apps/api/tests/test_story_memory_contract.py`
- **覆盖要求**: 默认兼容、开启配置后的新行为、读前/关闭前 flush、memory 引用不泄漏正文、continuity must/POV/近章优先。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 Chat Completions API、SQLite、SQLAlchemy。
- **内部依赖**:
  - workflow provider client -> OpenAI 兼容 payload。
  - RuntimeCheckpointStore -> SQLite runtime checkpoint。
  - BookRun adapter -> NovelLoop ports -> API/生产 memory writer。
  - API BookRun progress -> checkpoint/timeline 引用留存。
  - prompt context -> prompt builder。
- **配置来源**:
  - `STORYFORGE_LLM_PROMPT_CACHE_KEY`
  - `STORYFORGE_LLM_PROMPT_CACHE_RETENTION`
  - `STORYFORGE_CHECKPOINT_WRITE_BEHIND`
  - `STORYFORGE_CHECKPOINT_WRITE_BEHIND_FLUSH_INTERVAL_SECONDS`
  - `STORYFORGE_CONTINUITY_FACT_TOKEN_BUDGET`

### 6. 技术选型理由

- **Provider prompt caching**: 使用 OpenAI 兼容顶层字段，避免混入 Anthropic 专用 `cache_control`。
- **Checkpoint write-behind**: 默认关闭，开启后合并同线程最新状态，读路径和 close 强制 flush，兼顾性能与恢复一致性。
- **Memory extraction**: 通过端口注入真实写入函数，不让 workflow 依赖 API ORM；API 侧保留 memory 引用，延续跨进程调度边界。
- **Continuity facts 截断**: 在 `NarrativeContext` 生成前排序和预算控制，保持 prompt builder 纯渲染职责。

### 7. 关键风险点

- **并发问题**: 同一 thread_id 多个 job 并发写 checkpoint 仍会互相覆盖最新态，这是现有 `runtime_states.thread_id` 主键语义。
- **边界条件**: 超长单条 continuity fact 当前会被跳过；后续可接入摘要压缩策略。
- **性能瓶颈**: write-behind 缓冲可降低 `save_state()` 同步写，但进程崩溃仍可能丢最后一小段缓冲；关键读/close 已 flush。
- **安全考虑**: BookRun checkpoint/timeline 只保留 memory id、model_run id 等引用，不保存 `final_draft`、prompt 或 provider 凭据。
