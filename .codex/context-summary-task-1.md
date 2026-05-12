## 项目上下文摘要（Task 1：工程骨架与本地验证基线）

生成时间：2026-05-12 17:03:13 +08:00

### 1. 相似实现分析

- **实现1**：D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md:87-152
  - 模式：计划先定义文件清单、验证命令和提交边界，再实施工程骨架。
  - 可复用：根 package.json 脚本键、pnpm-workspace.yaml 工作区、docker-compose.yml 服务清单、verify-local.ps1 检查项。
  - 需注意：本地验证失败必须记录环境缺口，不得伪造通过或强行提交。
- **实现2**：D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md:109-120
  - 模式：系统采用“B 为核，C 为壳”，分为用户体验层、创作智能内核、平台骨架层。
  - 可复用：工程目录按 apps/web、apps/api、apps/workflow、packages/shared 映射三层边界。
  - 需注意：平台骨架只承载本地依赖和验证入口，不提前实现业务闭环。
- **实现3**：D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md:469-486
  - 模式：技术基线为 Next.js + React、FastAPI、Python + LangGraph、PostgreSQL + pgvector、Redis、S3 兼容存储。
  - 可复用：apps/web/package.json、apps/api/pyproject.toml、apps/workflow/pyproject.toml 和 docker-compose.yml 的依赖选择。
  - 需注意：pgvector 是检索加速器，PostgreSQL 是业务真相源。

### 2. 项目约定

- **命名约定**：目录使用小写短横线或语义目录；包名使用 @storyforge/*；Python 项目名使用小写短横线。
- **文件组织**：根目录放工作区和本地编排；apps/* 放应用；packages/* 放共享包；过程文件写入项目本地 .codex/。
- **导入顺序**：本任务尚未新增源代码导入；后续按各语言默认工具链约定执行。
- **代码风格**：JSON/YAML/TOML 使用 2 空格或标准 TOML 风格；PowerShell 函数使用 Verb-Noun 形式，用户可见输出使用简体中文。

### 3. 可复用组件清单

- docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md：Task 1 文件清单、验证命令和提交要求。
- docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md：架构分层和技术选型事实源。
- Context7 /pnpm/pnpm：确认根 pnpm-workspace.yaml 可通过 packages glob 纳入 apps/* 与 packages/*。
- Context7 /pgvector/pgvector：确认 pgvector/pgvector:<tag> Docker 镜像和 CREATE EXTENSION vector 启用方式。
- Context7 /fastapi/fastapi：确认 fastapi[standard] 标准依赖和 Uvicorn ASGI 服务端关系。

### 4. 测试策略

- **测试框架**：当前仓库尚无测试框架文件，Task 1 建立本地验证基线。
- **测试模式**：以 scripts/verify-local.ps1 作为冒烟验证，补充 PowerShell 路径检查和 git status。
- **参考文件**：计划文件第116-141行给出 verify-local.ps1 与 pnpm verify 的验证路径。
- **覆盖要求**：覆盖 Node、pnpm、Python、Docker、PostgreSQL 容器、Redis 容器、计划文件和骨架文件存在性。

### 5. 依赖和集成点

- **外部依赖**：Node.js、pnpm、Python、Docker、PostgreSQL pgvector 镜像、Redis、MinIO。
- **内部依赖**：根 package.json 调用 scripts/verify-local.ps1；apps/web 依赖 @storyforge/shared；Python 子项目保留独立 pyproject.toml。
- **集成方式**：pnpm workspace 通过 apps/* 与 packages/* 发现包；docker compose 通过固定容器名供验证脚本检查。
- **配置来源**：.env.example、docker-compose.yml、pnpm-workspace.yaml、各子项目包配置。

### 6. 技术选型理由

- **为什么用这个方案**：与规格中的 Next.js、FastAPI、LangGraph、PostgreSQL + pgvector、Redis、S3 兼容存储基线一致。
- **优势**：目录边界明确，后续任务可独立填充前端、API、工作流和共享模型。
- **劣势和风险**：当前只建立骨架，真实单元测试和业务 OpenAPI 生成需后续任务补齐。

### 7. 关键风险点

- **并发问题**：本任务只写指定目录，未回滚或覆盖他人目录；历史 .codex 文件保留，仅更新任务相关文件。
- **边界条件**：若 Docker 未启动或容器未运行，验证脚本应失败并输出明确缺口。
- **性能瓶颈**：骨架文件无运行负载；依赖安装和容器启动的耗时属于本地环境成本。
- **安全考虑**：.env.example 仅为本地开发示例值，真实密钥不得提交。