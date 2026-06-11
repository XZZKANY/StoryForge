## 项目上下文摘要（Phase9 远端 CI/E2E 边界）

生成时间：2026-06-04 04:53:15 +08:00

### 1. 相似实现分析

- **实现1**: `current-phase.md`
  - 模式：阶段事实源，集中列出当前完成能力、最新证据目录和仍未完成项。
  - 可复用：仍未完成项中已有“远端 GitHub Actions `CI` 与 `E2E` 通过证据”。
  - 需注意：尚未记录最新远端 CI 成功与 E2E 失败的具体边界。
- **实现2**: `README.md`
  - 模式：使用者可见能力边界摘要，当前状态、最近验证证据和发布前门禁分开描述。
  - 可复用：最近验证证据已提到 PR #4 的 `CI / Core verification` 通过。
  - 需注意：当前状态第一条容易被误读为远端总门禁完成；需要明确 Core verification 不等于 E2E 远端门禁完成。
- **实现3**: `.github/workflows/ci.yml`
  - 模式：远端 CI workflow，名称为 `CI`，job 名称为 `Core verification`，执行 `pnpm run verify:ci`。
  - 可复用：用于解释 README 中 `CI / Core verification` 的真实范围。
  - 需注意：该 workflow 不运行 `pnpm e2e`。
- **实现4**: `.github/workflows/e2e.yml`
  - 模式：远端 E2E workflow，名称为 `E2E`，schedule 或手动触发，执行数据库迁移后运行 `pnpm e2e`。
  - 可复用：用于解释总计划远端 E2E 门禁。
  - 需注意：最近远端 E2E 失败在 Alembic 多 head，不得标记远端门禁完成。
- **实现5**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：pytest 文档契约测试，读取阶段事实源并断言证据边界。
  - 可复用：本轮可继续扩展该测试文件。
  - 需注意：测试只锁定事实源文本，不替代远端 Actions 本身。

### 2. 项目约定

- **命名约定**: pytest 文件使用 `test_*.py`，阶段事实测试集中在 `test_phase9_fact_sources.py`。
- **文件组织**: 用户可见边界写入 `README.md`，当前阶段事实写入 `current-phase.md`，审计记录写入 `.codex/`。
- **导入顺序**: Python 测试保持 `from __future__ import annotations`、标准库导入、常量、测试函数。
- **代码风格**: 使用普通 `assert`；说明文本使用简体中文。

### 3. 可复用组件清单

- `README.md`: 当前状态、最近验证证据、发布前门禁。
- `current-phase.md`: 仍未完成项和禁止宣称范围。
- `.github/workflows/ci.yml`: `CI / Core verification` 范围。
- `.github/workflows/e2e.yml`: `E2E` 范围。
- `apps/api/tests/test_phase9_fact_sources.py`: 文档契约测试。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 扩展 `test_phase9_fact_sources.py`，断言 README/current-phase 明确远端 Core verification 与 E2E 总门禁边界。
- **参考文件**: `test_phase9_fact_sources.py`、`test_real_llm_smoke_gate_document.py`。
- **覆盖要求**: README 必须记录最新 CI 成功与 E2E 失败；current-phase 必须把远端 E2E 失败列为未完成证据；两者都不能把 Core verification 写成总计划远端 CI/E2E 完成。

### 5. 依赖和集成点

- **外部依赖**: GitHub CLI 查询远端 Actions 状态。
- **远端证据**:
  - `gh run list --repo XZZKANY/StoryForge --limit 10` 显示最新 `CI` master push 成功，运行 ID `26857864662`。
  - 同一列表显示最新 `E2E` schedule 失败，运行 ID `26850336742`。
  - `gh run view 26850336742 --log-failed` 显示 E2E 在 `uv run alembic upgrade head` 失败，原因是 Alembic 多 head。
- **内部依赖**: README/current-phase 文本边界。
- **配置来源**: 只读取公开 GitHub Actions 元数据和本地 workflow 文件；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 远端门禁是总计划剩余项，事实源必须区分 Core verification 成功与 E2E 失败。
- **优势**: 防止把历史 PR 或 CI 子集通过误报为总计划远端门禁完成。
- **劣势和风险**: 文档同步不能修复 E2E 失败本身；后续仍需修复 Alembic 多 head 并重新跑远端 E2E。

### 7. 关键风险点

- **远端状态漂移**: GitHub Actions 状态会随新 run 改变，本轮只记录查询时的最新证据。
- **误报风险**: `CI / Core verification` 成功不等于 `E2E` 成功。
- **真实长程边界**: 远端 CI/E2E 与真实 10 章或 3-5 万字长程是不同门禁，均未完成。
- **敏感信息**: 不读取 `.env`，不写入 provider 私有端点或凭据。

### 8. 上下文充分性检查

- 能定义接口契约：是，README/current-phase 必须记录 Core verification 与 E2E 边界。
- 理解技术选型：是，复用现有文档契约测试，不新增远端查询脚本。
- 识别主要风险：是，防止远端门禁误报。
- 知道如何验证：是，pytest 红绿、GitHub CLI 查询记录、敏感扫描和空白检查。
