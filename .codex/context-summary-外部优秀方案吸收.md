## 项目上下文摘要（外部优秀方案吸收）

生成时间：2026-05-12 15:19:22 +08:00

### 1. 本次任务

用户要求“吸收推荐的外部优秀方案”。本次只修改文档和审计文件，不创建代码工程，不复制外部代码。

### 2. 已读取和复用的项目内材料

- D:/StoryForge/AGENTS.md：语言、流程、验证和审计约束。
- D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md：中文主规格，唯一事实源。
- D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.md：旧路径兼容入口。
- D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md：既有操作日志模式。
- D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/verification-report.md：既有验证报告模式。

### 3. 外部方案来源

- Sudowrite Story Bible：向导式创作链。
- Sudowrite Chapter Continuity：章节连续性显式管理。
- Novelcrafter Codex：作者可编辑资产中心。
- InkOS：长期真相文件、多 Agent、审计修复、人工审核门和快照回滚。
- autonovel：基础设定、初稿、自动修订和导出阶段门禁。
- NovelGenerator：Agent 日志、进度、流式章节、差异查看和导出体验。
- Re3、DOC、DOME、StoryWriter：长篇生成中的规划、记忆、递归修订和多 Agent 分层。
- LangGraph、FastAPI、Next.js 官方文档：可恢复工作流、模块化 API 和复杂应用前端组织。

### 4. 吸收决策

- Phase 1 必须吸收：资产真相源、章节连续性、层级大纲、Scene Packet、结构化 Judge、定向 Repair、可恢复任务。
- Phase 1 暂不吸收：完整 SaaS、插件市场、有声书、封面、营销落地页、全量微服务、过重知识图谱和复杂自治 Agent 社会。
- 外部项目只作为设计模式参考；进入实现阶段前必须再次核验许可证、维护状态、接口边界和本地验证方案。

### 5. 风险和补偿计划

- 当前仓库仍无代码工程，无法运行单元测试或构建。
- 当前会话没有 github.search_code 工具，开源项目参考来自公开网页和 GitHub 页面；后续若工具可用，应补做代码级搜索。
- 所有外部技术进入实现前必须通过 Context7 或官方文档复核，并写入新的上下文摘要。