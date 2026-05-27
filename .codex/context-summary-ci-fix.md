## 项目上下文摘要（CI 失败修复）

生成时间：2026-05-28 02:53:40 +08:00

### 1. 相似实现分析

- **CI 工作流**: `.github/workflows/ci.yml`
  - 模式：每个作业独立安装依赖并运行最小命令。
  - 可复用：lint/typecheck 使用 `pnpm --filter @storyforge/web lint`、`pnpm exec eslint .`、`pnpm exec prettier --check`。
  - 需注意：API 作业先跑 `uv run pytest`，再跑 `uv run ruff check .`。
- **API 测试夹具**: `apps/api/tests/conftest.py`
  - 模式：pytest fixture 提供隔离内存数据库和本地 TestClient。
  - 可复用：`session`、`engine`、`client` fixture。
  - 需注意：测试必须本地可重复，不依赖远程 LLM 环境。
- **9A 冒烟测试**: `apps/api/tests/test_phase9a_deterministic_smoke.py`
  - 模式：直接调用服务函数并断言 BookRun 与导出制品。
  - 可复用：`Session` 注入与中文测试意图注释。
  - 需注意：导入顺序为标准库、第三方、项目内模块。
### 2. 项目约定

- **命名约定**：Python 使用 snake_case，TypeScript/React 使用 PascalCase 组件与 camelCase 函数。
- **文件组织**：`apps/api/app/domains/*` 放领域逻辑，`apps/api/tests` 放 pytest；`apps/web/app` 放 Next 页面，`packages/shared` 放契约与类型。
- **导入顺序**：Python 由 Ruff/I 规则管理，顺序为 future、标准库、第三方、项目内模块。
- **代码风格**：Web 与脚本由 Prettier 管理，API 由 Ruff 检查导入和基础规则。

### 3. 可复用组件清单

- `package.json`: 根脚本定义 `lint`、`test:api` 和本地验证入口。
- `apps/api/pyproject.toml`: pytest 与 Ruff 规则来源。
- `eslint.config.mjs`: ESLint 忽略范围和 TypeScript/React Hooks 规则。
- `apps/web/tsconfig.json`: Web 类型检查配置。

### 4. 测试策略

- **测试框架**：Web/shared 使用 TypeScript `tsc --noEmit` 与自定义 Node 测试；API 使用 pytest；Python 静态检查使用 Ruff。
- **参考文件**：`apps/api/tests/conftest.py`、`apps/api/tests/test_phase9a_deterministic_smoke.py`、`apps/api/tests/test_phase9b_real_llm_smoke.py`。
- **覆盖要求**：复现失败命令必须在本地通过，且保留输出证据。
### 5. 依赖和集成点

- **外部依赖**：pnpm 9.15.4、TypeScript 5.8.3、ESLint 10、Prettier 3.8.3、uv、pytest、Ruff。
- **内部依赖**：API 测试依赖 `app.models` 注册 ORM 模型，9B 冒烟依赖 BookRun、Blueprint、Artifact、ModelRun 等领域服务。
- **配置来源**：CI 命令来自 `.github/workflows/ci.yml`，本地脚本来自根 `package.json` 与 `apps/api/pyproject.toml`。

### 6. 技术选型理由

- **为什么用这个方案**：两个失败都来自格式/导入排序门禁，应使用项目既有格式工具自动修复，而不是手写重排大量 JSX。
- **优势**：变更范围与失败根因一一对应，低风险且可重复验证。
- **劣势和风险**：自动格式化会改动多行排版，需要通过 git diff 和原失败命令确认无行为变化。

### 7. 关键风险点

- **并发问题**：无运行时并发改动。
- **边界条件**：格式化不能改变测试语义；Ruff 排序不能删除 `app.models` 的副作用导入。
- **性能瓶颈**：无运行时性能影响。
- **安全考虑**：本次不新增认证、加密或审计逻辑，仅保持现有测试与格式门禁通过。
