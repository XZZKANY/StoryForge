## 项目上下文摘要（文档收敛）

生成时间：2026-06-04 13:53:41 +08:00

### 1. 相似实现分析

- **实现1**: `current-phase.md`
  - 模式：当前阶段事实源，集中记录 Phase 9 当前状态、已完成能力、未完成门禁和禁止宣称范围。
  - 可复用：`当前阶段`、`仍未完成的验收项`、`禁止宣称范围`、`证据源` 结构。
  - 需注意：它应是当前状态的主入口，其他文档只摘要或引用，避免复制完整门禁细节后再次漂移。
- **实现2**: `PROJECT_SUMMARY.md`
  - 模式：项目总览，以表格表达验证状态、技术栈、页面边界和不能承诺能力。
  - 可复用：验证状态表格、不能承诺能力清单、发布前验证入口。
  - 需注意：总览可以同步关键状态，但不应取代 `current-phase.md` 作为最新阶段判定来源。
- **实现3**: `TODO.md`
  - 模式：当前执行入口，记录事实边界、下一步优先级、本地验证入口和事实来源。
  - 可复用：`下一步优先级` 的任务排序和常用本地门禁命令。
  - 需注意：TODO 应聚焦后续动作，不应承载完整项目说明或历史计划。
- **实现4**: `.dev_plan.md`
  - 模式：历史计划、阶段任务和 Definition of Done 记录。
  - 可复用：Phase 9A/9B/9C 任务拆解、完成判定和远端门禁要求。
  - 需注意：它包含历史计划语境，必须标明当前状态以 `current-phase.md` 为准，避免把计划原文误读为最新状态。
- **实现5**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：用 pytest 守卫活文档事实，防止 README、TODO、PROJECT_SUMMARY、运维手册和远端 E2E 清单重新漂移。
  - 可复用：文件路径常量、中文 docstring、plain assert、禁止旧路径和旧验证口径的负向断言。
  - 需注意：本轮应扩展此测试，不新增平行测试入口。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 snake_case；Markdown 文件名沿用现有根目录命名；`.codex` 上下文摘要使用 `context-summary-任务名.md`。
- **文件组织**: 根目录活文档负责项目入口与状态；`docs/operations/` 负责运维手册；`docs/superpowers/plans/` 保存历史计划；`.codex/` 保存审计、上下文、验证报告和运行证据。
- **导入顺序**: Python 测试保留 `from __future__ import annotations`、标准库导入、路径常量、测试函数的现有顺序。
- **代码风格**: 测试使用 plain assert；文档使用简体中文、ATX 标题、列表和 Markdown 表格；不引入新格式或新脚本。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: Phase 9 文档事实源守卫，作为本轮主要自动验收。
- `current-phase.md`: 当前阶段主事实源，承载最新状态、未完成门禁和禁止宣称范围。
- `README.md`: 面向使用者的能力边界摘要和本地运行入口。
- `TODO.md`: 当前执行入口和下一步优先级。
- `PROJECT_SUMMARY.md`: 项目总览与验证状态表。
- `.dev_plan.md`: 历史阶段计划、DoD 和当前远端门禁状态记录。
- `docs/operations/README.md`: 运维文档同步规则参考。

### 4. 测试策略

- **测试框架**: API 侧使用 pytest，代码风格检查使用 ruff。
- **测试模式**: 扩展 `apps/api/tests/test_phase9_fact_sources.py`，先新增事实源职责断言并观察红灯，再更新文档让测试变绿。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 覆盖 current-phase 的职责矩阵、README/TODO/PROJECT_SUMMARY 对 current-phase 的引用边界、`.dev_plan.md` 的历史计划边界、远端 E2E 未完成和真实 3-5 万字长程未完成的保守表述。

### 5. 依赖和集成点

- **外部依赖**: CommonMark 语法参考来自 Context7 `/commonmark/commonmark-spec`；开源文档分层参考来自 GitHub search_code 搜索结果，仅用于职责分层，不复制内容。
- **内部依赖**: `test_phase9_fact_sources.py` 读取根目录文档与运维文档；`scripts/run-e2e.mjs` 和 `package.json` 定义本地验证入口。
- **集成方式**: 文档职责通过文字矩阵和 pytest 断言集成，不新增运行时代码。
- **配置来源**: 本任务不读取 `.env`，不使用真实 provider 配置，不触发远端 E2E。

### 6. 技术选型理由

- **为什么用这个方案**: 仓库已经有事实源测试和 `.codex` 审计体系，直接复用能减少维护面，并让职责边界可自动验证。
- **优势**: 小范围修改、可回归验证、不会影响业务运行时；后续状态变化有明确更新顺序。
- **劣势和风险**: 多文档仍需人工同步摘要；若后续只改 README 不改 `current-phase.md`，仍可能产生短暂漂移，因此需要测试守卫和运维维护规则共同约束。

### 7. 关键风险点

- **并发问题**: 当前工作区已有多处未提交改动，必须只修改本轮目标文件，不回滚用户或历史改动。
- **边界条件**: 真实 10 章 smoke 已通过最终验收，但不能外推为真实 3-5 万字长程完成；远端 CI 子集通过不能外推为远端 E2E 总门禁通过。
- **性能瓶颈**: 无运行时性能影响；验证只运行窄范围 pytest、ruff、py_compile 和文本扫描。
- **安全考虑**: 不读取 `.env`，不写 provider token、API key、Authorization 值或私有 provider 地址；敏感扫描作为收口验证。
