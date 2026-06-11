## 项目上下文摘要（Phase9 dev_plan 远端 E2E 失败边界同步）

生成时间：2026-06-04 06:36:12 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：读取 `.dev_plan.md`、README 和 current-phase，用 pytest plain assert 锁定阶段事实源。
  - 可复用：新增 `.dev_plan.md` 远端 E2E 失败边界测试。
  - 需注意：测试只能证明事实源同步，不能证明远端 E2E 通过。
- **实现2**: `.dev_plan.md`
  - 模式：记录 Phase 9 Definition of Done 和完成判定条件。
  - 可复用：在完成判定附近补充当前远端门禁状态，不改变完成标准。
  - 需注意：必须把失败状态写成“当前事实”，而非完成条件。
- **实现3**: `README.md`
  - 模式：已记录最新远端 E2E run `26915457170` 失败，以及本地 Alembic 修复与预检。
  - 可复用：对齐 `.dev_plan.md` 的 run id、失败原因和边界措辞。
  - 需注意：README 是公开摘要，`.dev_plan.md` 是计划事实源，二者不可互相复制过量细节。
- **实现4**: `current-phase.md`
  - 模式：已记录当前等待远端 `E2E` 重新运行确认，并保留远端 CI/E2E 未完成。
  - 可复用：作为 `.dev_plan.md` 状态小节的事实依据。
  - 需注意：不能把本地 `pnpm e2e` 通过外推为远端完成。

### 2. 项目约定

- **命名约定**: pytest 使用 `test_*`；本轮新增测试命名为 `test_dev_plan_records_latest_remote_e2e_failure_boundary`。
- **文件组织**: 总计划写入 `.dev_plan.md`，阶段事实源测试继续位于 `apps/api/tests/test_phase9_fact_sources.py`。
- **导入顺序**: 不新增导入。
- **代码风格**: 中文 docstring、`Path.read_text(encoding="utf-8")`、普通 `assert`。

### 3. 可复用组件清单

- `DEV_PLAN_PATH`: 既有 `.dev_plan.md` 路径常量。
- `test_phase9_fact_sources.py`: 既有事实源契约测试入口。
- `README.md` 与 `current-phase.md`: 已同步的远端 E2E 失败事实。
- `gh run list/view`: 远端 Actions 权威状态来源。

### 4. 测试策略

- **测试框架**: pytest、ruff。
- **测试模式**: 新增 `.dev_plan.md` 断言先红灯，再更新计划文档转绿。
- **参考文件**: `test_dev_plan_records_real_llm_one_chapter_smoke_evidence`。
- **覆盖要求**: `.dev_plan.md` 必须包含 `26857864662`、`26915457170`、`2026-06-03T21:55:39Z`、`Multiple head revisions`、`20260604_0001`、`tests/test_alembic_heads.py` 和远端 E2E 未完成边界。

### 5. 依赖和集成点

- **外部依赖**: GitHub CLI 查询远端 Actions 状态。
- **内部依赖**: `.dev_plan.md`、README/current-phase、事实源测试。
- **集成方式**: 文档契约测试将总计划事实源纳入本地验证。
- **配置来源**: 当前 shell 与 GitHub CLI；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: `.dev_plan.md` 是总计划完成判定来源，缺少最新远端失败事实会降低后续 completion audit 的可信度。
- **优势**: 改动窄、可自动验证、不会触发外部 LLM 或远端 workflow。
- **劣势和风险**: 只能同步事实，不能关闭远端 E2E 门禁。

### 7. 关键风险点

- **边界条件**: 远端 E2E 最新 run `26915457170` 仍失败；本地修复必须提交并在远端重新运行通过后才能关闭。
- **安全考虑**: 不读取 `.env`；不写入 provider 地址、密钥、认证头或任何可还原凭据片段。
- **事实源风险**: 后续远端 E2E 状态变化后，需要再次同步 `.dev_plan.md`、README 和 current-phase。

### 8. 外部资料来源与用途

- GitHub CLI：`gh run list --workflow E2E` 与 `gh run view 26915457170 --log-failed`，确认最新 E2E 失败 run 和失败原因。
- GitHub CLI：`gh run list --workflow CI`，确认最新 CI run `26857864662` 成功。
- Context7 `/pytest-dev/pytest`：确认 pytest plain assert 与断言 introspection 是推荐测试写法。
- GitHub search_code：检索开源文本事实源测试写法；本轮采用项目内既有 `Path.read_text` + plain assert 模式。

### 9. 充分性检查

- 能定义清晰接口契约：是，`.dev_plan.md` 必须记录最新远端门禁状态和未完成边界。
- 理解技术选型理由：是，复用现有事实源契约测试，不新增机制。
- 识别主要风险点：是，本地修复未进入远端通过状态。
- 知道如何验证：是，运行定向 pytest、ruff、py_compile、diff check、敏感扫描和新增段落尾随空白检查。
