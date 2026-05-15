## 项目上下文摘要（工程计划）

生成时间：2026-05-12 16:27:33 +08:00

### 1. 本次任务

用户要求写工程计划。本次创建 Phase 1 工程实施计划，不创建代码工程目录，不运行代码测试。

### 2. 项目内事实

- 仓库根目录存在 D:/StoryForge/AGENTS.md。
- 项目目录为 D:/StoryForge/1-renovel-ai-ai-rag-tavern。
- 当前项目已包含中文主规格和外部优秀方案吸收决策。
- 当前未发现 package.json、测试文件、TypeScript、JavaScript 或 Python 代码工程。
- 当前目录不是 git 仓库，后续实施计划把 git init 放在 Task 1 首步。

### 3. 计划依据

- 中文主规格：docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md。
- 外部方案吸收章节：资产真相源、章节连续性、层级大纲、Scene Packet、结构化 Judge、定向 Repair、可恢复任务。
- Context7 已查询过 LangGraph、FastAPI、Next.js 官方文档要点。
- 当前会话没有 github.search_code 工具，代码级开源搜索需在工具可用时补做。

### 4. 工程计划决策

- 采用模块化单体，不拆微服务。
- 前端使用 pps/web，后端 API 使用 pps/api，工作流使用 pps/workflow。
- 跨端契约使用 packages/shared 保存 OpenAPI 生成物。
- 本地验证集中在 scripts/verify-local.ps1、pnpm verify、pnpm test、pnpm e2e。
- 第一阶段只做单用户强闭环，不做协作、计费、插件市场和复杂图谱。

### 5. 风险与补偿

- 当前无代码工程，因此本次只能做文档级验证。
- 后续实施涉及新技术栈时，必须重新通过 Context7 查询官方文档。
- 后续若用户不允许初始化 git，需要记录限制并调整提交步骤。
