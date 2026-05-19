# Phase 5 上下文与长效记忆架构

## 目标

本架构第一轮不推倒现有模块化单体，只补齐长篇创作最容易撞墙的底座：上下文编译、结构化长效记忆、时间线演化、Agent 提案仲裁、LangGraph 引用型状态。

## 竞品/生态择优选择

| 来源 | 采纳做法 | StoryForge 落地点 |
| --- | --- | --- |
| Sudowrite Story Bible / Chapter Continuity | 字段依赖、章节连续性、超预算排除顺序 | `ContextCompiler` 按优先级和预算裁剪上下文 |
| Novelcrafter Codex | 自动提及、Progressions、系列共享 | `MemoryAtom`、`Progression`、章节有效区间 |
| NovelAI Lorebook | Insertion Order、Token Budget、Reserved Tokens、Context Viewer | `injection_position`、`ContextBudgetReport`、`DroppedContextBlock` |
| SillyTavern World Info / Data Bank | score threshold、chunk、注入位置、prompt itemization | `score_threshold`、检索证据块、调试摘要 |
| LangGraph Persistence | checkpoint、thread、store 分层 | `WorkflowStateReference` 只保存引用和 revision |

## 模块边界

```text
apps/api
├─ context_compiler  # 上下文编译和预算解释
├─ story_memory      # 结构化事实、时间线、Progression、仲裁契约
├─ scene_packets     # 后续消费 compiled_context_id
└─ retrieval         # 后续提供真实 evidence chunk

apps/workflow
└─ 只保存 WorkflowStateReference，不保存全文、全量角色卡或全量世界观
```

## 第一轮明确不做

- 不新增数据库迁移。
- 不接真实外部模型。
- 不改前端工作台。
- 不替换现有 Scene Packet，只为后续集成提供契约。

## 核心数据流

```text
Scene / User Intent
  ↓
Retrieval / Memory / Timeline 候选块
  ↓
Context Compiler
  ├─ score threshold 过滤
  ├─ required 块强制保留
  ├─ token budget 裁剪
  ├─ injection position 排序
  └─ dropped reason 留痕
  ↓
CompiledContext
  ↓
Scene Packet / ModelRun / WorkflowStateReference
```

## Agent 写入规则

所有 Agent 必须输出 `AgentProposal`。只有仲裁器产出 `auto_merge` 后，后续实现才允许写入 API 真相源。遇到 immutable fact、时间线冲突、高风险事实冲突时必须进入人工确认。

## 验证要求

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
python -m compileall app tests
python -m pytest tests/test_context_compiler.py tests/test_story_memory_contract.py -q
```
