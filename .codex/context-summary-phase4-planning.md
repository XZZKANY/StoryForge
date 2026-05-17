# 项目上下文摘要（Phase 4 计划编制）

生成时间：2026-05-17 00:00:00 +08:00

## 1. 规划依据

- 主规格：`docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md`
- 已有工程计划：
  - `docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md`
  - `docs/superpowers/plans/2026-05-15-storyforge-phase2-engineering-plan.md`
- 已完成现状：
  - Phase 1：资产、连续性、Scene Packet、Judge/Repair、导出与闭环验收
  - Phase 2：系列级记忆、世界观中心、批量精修、风格包复用、质量看板
  - Phase 3：工作区、协作审批、商业化控制、事件流分析、Provider Gateway

## 2. 规格中仍未系统化落地的重点

- 检索索引仍停留在“手工传入 retrieval_snippets”的轻量阶段，尚未形成 `pgvector`/Embedding 刷新/重排的完整链路。
- Prompt Packs、模型运行日志、用户意图约束、参考资料库等辅助资产尚未成为独立可维护领域。
- LangGraph 工作流当前以本地可恢复示例为主，尚未与 Job Center、Provider Gateway、事件流、审计日志形成完整持久化运行时。
- Object Storage 只在设计上存在，导出物、上传资料、快照和辅助产物尚未进入统一制品中心。
- 自动评测、基准集、实验记录和指标看板尚未成为正式产品能力。

## 3. 可复用实现与边界

- `apps/api/app/domains/jobs/*`：可复用任务状态、进度和错误记录模式。
- `apps/api/app/domains/events/*`：可复用事件写入、倒序读取与工作区归属。
- `apps/api/app/domains/provider_gateway/*`：可复用模型能力解析和工作区覆盖逻辑。
- `apps/api/app/domains/scene_packets/*`：可复用固定槽位组包模式，后续只增强检索来源，不推翻当前结构。
- `apps/workflow/storyforge_workflow/*`：可复用 LangGraph 状态、节点、interrupt 和 checkpoint 组织方式。
- `apps/web/tests/phase1-navigation.test.tsx` 与 `tests/e2e/*.spec.ts`：可复用前端中文契约和阶段级 OpenAPI/源码证据验收模式。

## 4. 计划编制约定

- 继续采用模块化单体 + 独立 workflow runtime 的演进方式，不提前拆微服务。
- 新增领域仍遵循 `models.py / schemas.py / service.py / router.py / tests` 分层。
- 文档、测试标题、错误说明和操作日志统一使用简体中文。
- 计划文件必须给出任务拆分、文件边界、验证命令和风险控制，不写模糊“后续再说”项。

## 5. 建议的下一阶段主轴

Phase 4 建议聚焦“把创作内核从本地可验证样机升级为真实生产链路”：

1. 检索索引与 Embedding 刷新。
2. Scene Packet 检索升级与重排。
3. Prompt Packs 与模型运行日志。
4. 持久化 Workflow Runtime 与 Job Center 联通。
5. 制品中心（对象存储）与上传资料。
6. 评测资产、自动评测与实验面板。

## 6. 风险点

- 若检索索引设计过重，容易过早进入“向量库即真相源”的错误方向。
- 若工作流运行时直接绑定前端会话状态，会破坏当前服务边界。
- 若评测系统缺少基准集和回放输入，只会产生不可复现的分数。
- 若对象存储能力与导出、上传、快照共用不清晰，会导致制品谱系不可追踪。

## 7. 充分性检查

- 能说明后续阶段要补什么：是。
- 能指出哪些能力已有底座可复用：是。
- 能给出合理的任务顺序：是。
- 知道验证方式应延续 pytest、compileall、Node 契约和阶段 e2e：是。
