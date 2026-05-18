## 项目上下文摘要（编码与运维一致性三轮）

生成时间：2026-05-18 15:05:00 +08:00

### 1. 相似实现分析

- `D:/StoryForge/AGENTS.md`：明确所有代码文件必须使用 UTF-8 无 BOM，所有日志和文档使用简体中文。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/generate-openapi.ps1`：当前已按 `uv`、`python3`、`python` 顺序选择运行时，适合作为文档同步的真实依据。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`：当前 e2e 会刷新 OpenAPI、运行 Node 契约、API 补偿验收和 workflow pytest，是发布治理验证主链路。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/local-start.md` 与 `troubleshooting.md`：采用“现象/排查/处理”的运维说明结构，需要与脚本行为保持一致。

### 2. 项目约定

- 文档、日志、错误提示和测试描述必须使用简体中文。
- 文件读写必须保持 UTF-8 无 BOM，避免 PowerShell `Set-Content -Encoding UTF8` 在旧环境中写入 BOM。
- 发布治理任务优先修改 `scripts/`、`docs/operations/`、`TODO.md` 和 `.codex/`，不触碰 Phase 1-4 业务实现。

### 3. 可复用组件清单

- `package.json` 既有命令：`pnpm openapi`、`pnpm e2e`、`pnpm test`、`pnpm verify`。
- PowerShell Parser 检查方式：`[System.Management.Automation.PSParser]::Tokenize()`。
- Git 状态检查方式：`git status --short --branch`、`git diff --stat`。

### 4. 测试策略

- BOM 检查：用 Python 读取文件前三字节，确认目标文本文件不以 `EF BB BF` 开头。
- 文档检查：使用 `Select-String` 检查更新时间、运行时回退和排查步骤。
- 脚本验证：运行 `node --check scripts/run-e2e.mjs`、PowerShell Parser、`pnpm openapi` 或 `pnpm e2e`。
- 最终验证：运行 `pnpm test` 和 `git status --short --branch`；`pnpm verify` 若 Docker 不可查询，记录失败原因。

### 5. 依赖和集成点

- `TODO.md` 是当前状态、任务池和最近迭代记录入口。
- `.codex/operations-log.md` 记录每轮问题、执行、验证和遗留项。
- `.codex/verification-report.md` 记录本地验证证据、评分和结论。
- `docs/operations/README.md` 是运维文档入口，新增或更新运维流程需同步检查。

### 6. 技术选型理由

- 本轮继续使用既有脚本和轻量文档治理，不新增依赖，符合小步发布治理目标。
- 用 Python 检查/去除 BOM 是跨文本文件稳定方式，避免依赖 PowerShell 编码行为差异。
- 文档同步以脚本实际行为为准，避免 README/TODO 与运行时不一致。

### 7. 关键风险点

- 当前工作区已有大量未提交变更，所有修改必须归属到本轮问题并记录。
- Docker 服务仍不可查询，`pnpm verify` 预计失败，不能作为完整通过声明。
- 去除 BOM 必须只改编码前缀，不改正文内容；需用后续语法检查和文本检查确认。
