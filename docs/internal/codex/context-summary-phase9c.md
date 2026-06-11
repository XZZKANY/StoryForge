## 项目上下文摘要（Phase 9C Story Memory 自动注入与抽取）

生成时间：2026-05-27 11:27:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/story_memory/service.py`
  - 模式：MemoryAtom 是契约对象，`MemoryAtomRecord` 是数据库真相源，服务层负责创建、查询和仲裁写入。
  - 可复用：`create_memory_atom()`、`get_active_memory_atoms()`、`list_memory_atoms()`。
  - 需注意：现有有效区间使用章节序号语义，Scene Packet 应传入 `Chapter.ordinal` 而不是数据库主键。
- **实现2**: `apps/api/app/domains/scene_packets/context_pipeline.py`
  - 模式：服务层只定位实体，context pipeline 组装 packet、证据链接、检索命中和 compiled context。
  - 可复用：`assemble_scene_context()`、`retrieval_evidence_links()`。
  - 需注意：memory_context 应在 packet 组装中加入，同时进入 compiled context 的 memory 注入块。
- **实现3**: `apps/api/app/domains/scene_packets/retrieval_bridge.py`
  - 模式：`build_context_blocks()` 把场景目标、资产、连续性、检索片段转为 `ContextBlock`，再由 `compile_context()` 统一排序和裁剪。
  - 可复用：`ContextBlock(kind="memory_atom", injection_position="memory")`。
  - 需注意：Story Memory 自动召回不能绕过预算系统，应转为 ContextBlock 参与裁剪。
- **实现4**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：单章通过 `approve_scene()` 后返回 `NovelLoopResult`，目前只保留 model/judge/approve 引用。
  - 可复用：在 approve 后注入 `extract_memory` 端口，测试可用纯函数验证。
  - 需注意：9C-1b 只要求章节结束后新增至少 1 条章节来源 memory，不应引入远程 LLM。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case，Pydantic schema 使用 PascalCase，测试函数以 `test_` 开头，中文 docstring 描述业务意图。
- **文件组织**: API domain 继续在 `story_memory`、`scene_packets`、`context_compiler` 内扩展；workflow 记忆抽取放在 `orchestrators/novel_loop.py` 端口中。
- **导入顺序**: `from __future__ import annotations` 后标准库、第三方、本地模块，由 ruff 校验。
- **代码风格**: 使用服务层函数和纯函数测试，不新增外部依赖。

### 3. 可复用组件清单

- `MemoryAtomRecord`: 长效记忆持久化表。
- `get_active_memory_atoms()`: 按章节有效区间读取记忆。
- `ContextBlock`: 统一进入上下文预算和裁剪系统。
- `ScenePacket.packet`: 可追加 `memory_context` 字段作为 9C 输出契约。
- `NovelLoopPorts`: 可扩展 `extract_memory` 端口，保持测试可注入。

### 4. 测试策略

- **测试框架**: API 使用 pytest；workflow 使用 pytest。
- **测试模式**: 先写失败测试：`tests/test_context_compiler_memory_injection.py` 和 `apps/workflow/tests/test_novel_loop_single_chapter.py`。
- **覆盖要求**: POV、location、前章尾状态/连续性和活跃角色均能召回；approve 后能写入带 `source_chapter_id` 和 `confidence` 的 memory。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 2.0、Pydantic、FastAPI。
- **内部依赖**: Book/Chapter/Scene、Asset、ContinuityRecord、MemoryAtomRecord、ScenePacket、ContextCompiler。
- **集成方式**: Scene Packet 自动召回 memory 后写入 `packet["memory_context"]`，并通过 `ContextBlock` 进入 `packet["上下文注入"]`。
- **配置来源**: 无新增环境变量，9C-1 不依赖真实 LLM。

### 6. 技术选型理由

- **为什么用这个方案**: 复用已有 Story Memory 真相源和 Context Compiler 预算系统，避免新增平行记忆注入管道。
- **优势**: 可本地 deterministic 验证；与现有 Scene Packet/CompiledContext 审计字段一致。
- **劣势和风险**: 召回相关性先基于实体名、地点、POV 和前章约束关键词，后续 9C 可接 embedding/semantic retrieval 增强。

### 7. 关键风险点

- **并发问题**: NovelLoop approve 后 memory 写入需要由外部 session/adapter 保证事务边界。
- **边界条件**: 无相关 memory 时 `memory_context` 应为空列表，不影响 Scene Packet。
- **性能瓶颈**: 当前按作品列出 active atoms 后本地过滤；短篇可接受，长篇后续需要索引或向量召回。
- **安全考虑**: 不新增密钥或认证路径。
