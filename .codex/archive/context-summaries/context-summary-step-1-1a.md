## 项目上下文摘要（Step 1-1a 基础 CI workflow）

生成时间：2026-05-26 15:25:00

### 1. 相似实现分析

- **实现1**: `package.json`
  - 模式：根脚本聚合各工作区验证入口。
  - 可复用：`test:web`、`test:api`、`test:workflow`、`openapi`。
  - 需注意：`openapi` 当前调用 PowerShell 脚本，Linux CI 兼容属于后续 Step 1-1c。
- **实现2**: `scripts/run-e2e.mjs`
  - 模式：先刷新 OpenAPI 契约，再执行 `git diff --exit-code` 做漂移检测。
  - 可复用：契约漂移检测思路与 `packages/shared/src/contracts/storyforge.openapi.json` 路径。
  - 需注意：该脚本覆盖 E2E 与多组 pytest，属于后续 Step 1-1b 的 integration workflow 范围。
- **实现3**: `scripts/verify-local.ps1`
  - 模式：集中检查 Node、pnpm、Python、Docker 和关键文件存在性。
  - 可复用：CI 需要覆盖 Node、pnpm、Python 与关键测试入口。
  - 需注意：本地 Docker 容器健康检查不属于 Step 1-1a 的基础 CI 范围。
- **实现4**: `apps/api/pyproject.toml` 与 `apps/workflow/pyproject.toml`
  - 模式：Python 子项目各自声明 pytest 配置和 `uv.lock`。
  - 可复用：CI 在子目录执行 `uv sync --frozen` 与 `uv run pytest`。
  - 需注意：Python 版本要求为 3.11+。

### 2. 项目约定

- **命名约定**: npm 脚本与 CI job 使用 kebab-case；Python 测试使用 pytest 默认发现规则。
- **文件组织**: Node workspace 由 `pnpm-workspace.yaml` 管理，Python 服务独立位于 `apps/api` 和 `apps/workflow`。
- **导入顺序**: 本任务新增 YAML，不涉及源码导入。
- **代码风格**: JSON/YAML 使用两空格缩进；说明性文本使用简体中文。

### 3. 可复用组件清单

- `package.json`: 根验证入口与包管理器版本 `pnpm@9.15.4`。
- `apps/web/package.json`: `test` 与 `lint` 脚本。
- `packages/shared/package.json`: `test` 脚本执行 TypeScript 类型检查。
- `scripts/generate-openapi.ps1`: 当前 OpenAPI 生成入口。
- `scripts/run-e2e.mjs`: 契约刷新与漂移检测模式参考。

### 4. 测试策略

- **测试框架**: Node `node:test`、TypeScript `tsc --noEmit`、Python `pytest`。
- **测试模式**: Web 与 shared 走 pnpm workspace；API 与 workflow 分别在子目录走 uv/pytest。
- **参考文件**: `apps/web/tests/studio.test.tsx`、`tests/e2e/phase2-contract.spec.ts`、`apps/api/pyproject.toml`。
- **覆盖要求**: 本步骤验证 workflow 结构、触发条件、六个 job 与关键命令；远程 Actions 页面状态需推送后验证。

### 5. 依赖和集成点

- **外部依赖**: `actions/checkout`、`pnpm/action-setup`、`actions/setup-node`、`actions/setup-python`、`astral-sh/setup-uv`。
- **内部依赖**: `pnpm-lock.yaml`、`uv.lock`、`packages/shared/src/contracts/storyforge.openapi.json`。
- **集成方式**: GitHub Actions 读取 `.github/workflows/ci.yml`，并调用现有脚本。
- **配置来源**: 根 `package.json`、子项目 `pyproject.toml` 与 lockfile。

### 6. 技术选型理由

- **为什么用这个方案**: Step 1-1a 要求基础 CI，而仓库已有本地验证命令，复用脚本可降低漂移。
- **优势**: 六个 job 独立并行，失败定位清晰；Python 与 Node lockfile 均被纳入安装流程。
- **劣势和风险**: `contract-check` 暂用 Windows runner 兼容现有 PowerShell 脚本，后续 Step 1-1c 必须迁移为跨平台 Node 脚本。

### 7. 关键风险点

- **并发问题**: 六个 job 独立，不共享可变状态。
- **边界条件**: 当前工作树若已有 OpenAPI drift，`contract-check` 会正确失败。
- **性能瓶颈**: 每个 job 独立安装依赖，后续可引入缓存优化。
- **安全考虑**: 本步骤不引入凭据和部署动作，仅使用只读 checkout 与测试命令。
