## 项目上下文摘要（Phase9 E2E Alembic 预检）

生成时间：2026-06-04 06:12:00 +08:00

### 1. 相似实现分析

- **实现1**: `.github/workflows/e2e.yml`
  - 模式：远端 E2E workflow，在安装 API/Workflow 依赖后执行数据库迁移，再运行 `pnpm e2e`。
  - 可复用：`working-directory: apps/api` 与 `run: uv run alembic upgrade head` 的步骤结构。
  - 需注意：当前在线迁移前没有轻量 Alembic 预检。
- **实现2**: `.github/workflows/ci.yml`
  - 模式：CI workflow 先安装 Node/API/Workflow 依赖，再运行核心门禁。
  - 可复用：步骤命名和依赖安装顺序。
  - 需注意：本轮只改 E2E workflow，不扩大 CI scope。
- **实现3**: `apps/api/tests/test_alembic_heads.py`
  - 模式：迁移门禁测试，覆盖单 head 与离线 SQL smoke。
  - 可复用：远端 E2E 可直接运行 `uv run pytest tests/test_alembic_heads.py -q`。
  - 需注意：该测试是在线数据库迁移前的快速失败门禁，不替代真实 E2E。
- **实现4**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：用文本契约测试锁定文档事实源。
  - 可复用：本轮可用类似方式读取 workflow 文本，断言关键片段和顺序。
- **实现5**: GitHub Actions 官方文档
  - 模式：workflow step 支持 `run` 命令和 `working-directory`。
  - 可复用：新增步骤采用标准 step 语法。

### 2. 项目约定

- **命名约定**: workflow 步骤名使用简体中文；pytest 测试函数使用 `test_*`。
- **文件组织**: GitHub Actions 配置在 `.github/workflows/`；API 契约测试在 `apps/api/tests/`。
- **导入顺序**: Python 测试只需 `from __future__ import annotations` 和标准库导入。
- **代码风格**: 文档和测试说明使用简体中文；断言使用普通 `assert`。

### 3. 可复用组件清单

- `tests/test_alembic_heads.py`: 远端 E2E 迁移预检命令。
- `.github/workflows/e2e.yml`: 远端 E2E workflow。
- `apps/api/tests/test_phase9_fact_sources.py`: 文本契约测试风格。

### 4. 测试策略

- **测试框架**: pytest。
- **红灯测试**: 新增 workflow 契约测试，断言 `.github/workflows/e2e.yml` 包含 `执行 Alembic 迁移预检`、`working-directory: apps/api`、`uv run pytest tests/test_alembic_heads.py -q`，且该步骤位于 `执行数据库迁移` 前。
- **绿灯测试**: 修改 workflow 后契约测试通过，并运行 `tests/test_alembic_heads.py`。
- **相关验证**: ruff、敏感扫描、目标 diff/尾随空白检查。

### 5. 依赖和集成点

- **外部依赖**: GitHub Actions 标准 step 语法。
- **官方文档结论**: step 可用 `run` 执行命令，`working-directory` 可指定命令目录。
- **内部依赖**: E2E workflow 已在此前安装 API 依赖，因此可直接执行 API pytest。
- **配置来源**: 不读取 `.env`；workflow 使用测试环境变量。

### 6. 技术选型理由

- **为什么接入 E2E workflow**: 远端失败发生在 E2E 的数据库迁移步骤，预检应贴近失败面。
- **优势**: 在在线迁移前快速暴露多 head 或离线 SQL 生成问题，失败更早且日志更聚焦。
- **劣势和风险**: 预检不能替代在线 Postgres 迁移，也不能证明远端 E2E 已通过。

### 7. 关键风险点

- **顺序风险**: 预检必须在 `执行数据库迁移` 前运行。
- **成本风险**: 预检应只运行 `tests/test_alembic_heads.py`，避免拖慢 E2E。
- **远端边界**: workflow 修改不等于远端 run 成功，仍需推送后重新运行。
- **敏感信息**: 不写入 provider 私有端点或凭据。

### 8. 上下文充分性检查

- 能定义接口契约：是，workflow 必须有指定步骤、命令、工作目录和顺序。
- 理解技术选型：是，复用现有迁移 smoke，不新增脚本。
- 识别主要风险：是，预检不是远端 E2E 完成证据。
- 知道如何验证：是，红绿 pytest、迁移 smoke、ruff、敏感扫描和空白检查。
