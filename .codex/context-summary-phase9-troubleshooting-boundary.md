## 项目上下文摘要（Phase9 troubleshooting 故障手册边界同步）

生成时间：2026-06-04 07:30:41 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py:41`
  - 模式：读取计划文档文本，用 pytest plain assert 锁定远端 E2E run、失败时间、Alembic 失败原因、本地修复 revision 和未完成边界。
  - 可复用：`Path.read_text(encoding="utf-8")`、逐项 `assert "... " in text` 与旧值 `not in`。
  - 需注意：测试只守护文档事实，不应启动远端 workflow 或声明远端 E2E 已完成。
- **实现2**: `apps/api/tests/test_phase9_fact_sources.py:57`
  - 模式：同时检查 README 和 current-phase，区分远端 CI 子集成功与 E2E 总门禁失败。
  - 可复用：正向断言当前 run 与修复边界，负向断言旧 run 不再作为最新状态。
  - 需注意：必须保留“等待远端 E2E 重新运行确认”的边界语言。
- **实现3**: `apps/api/tests/test_phase9_fact_sources.py:156`
  - 模式：将 `docs/operations/local-start.md` 纳入同一事实源测试入口，验证当前路径、常用本地命令、远端 E2E 失败、Alembic 预检和真实长程未完成。
  - 可复用：新增路径常量后追加一个 `test_*_records_current_phase9_*` 测试。
  - 需注意：同类运维文档应统一使用 `D:/StoryForge`，不得保留旧路径 `D:/StoryForge/1-renovel-ai-ai-rag-tavern`。

### 2. 项目约定

- **命名约定**：测试函数使用 `test_<文档>_records_current_phase9_*`，路径常量使用全大写 `*_PATH`。
- **文件组织**：阶段事实源测试集中在 `apps/api/tests/test_phase9_fact_sources.py`；活跃运维文档位于 `docs/operations/`；审计记录写入项目本地 `.codex/`。
- **导入顺序**：保留 `from __future__ import annotations`、标准库 `Path`，不新增第三方导入。
- **代码风格**：pytest 普通断言；文档为简体中文 Markdown，命令块使用 `powershell`。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 现有文档事实源契约测试入口。
- `LOCAL_START_PATH`: 相邻运维文档路径常量模式，可照此新增 `TROUBLESHOOTING_PATH`。
- `README.md`、`current-phase.md`、`TODO.md`、`PROJECT_SUMMARY.md`、`.dev_plan.md`: 当前远端 CI/E2E、Alembic 修复和真实长程边界事实来源。
- `docs/operations/local-start.md`: 当前本地路径、验证命令和远端 E2E 表述的近邻文档范式。

### 4. 测试策略

- **测试框架**：pytest，经 `uv run pytest` 执行。
- **测试模式**：文档事实源单元测试，不依赖数据库、网络或外部服务。
- **参考文件**：`apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**：正常事实包含当前更新时间、路径、远端 E2E run、失败时间、Alembic 多 head、merge revision、预检测试和本地验证命令；错误防护覆盖旧路径和远端 E2E 过度完成声明。

### 5. 依赖和集成点

- **外部依赖**：pytest；Context7 `/pytest-dev/pytest` 文档确认普通 `assert` 具备断言 introspection，适合小型文件内容测试。
- **内部依赖**：只读项目文档，不调用应用代码。
- **集成方式**：`test_phase9_fact_sources.py` 加入新的文档路径常量和事实源测试；`docs/operations/troubleshooting.md` 更新为当前故障手册。
- **配置来源**：无运行时配置；不读取 `.env`，不记录 provider token、API key、secret 或 password。

### 6. 技术选型理由

- **为什么用这个方案**：项目已有 Phase 9 文档事实源测试，用同一文件追加断言最小化维护面，并能在本地 pytest 中重复验证。
- **优势**：不新增测试框架、不触发远端状态变化、能防止故障手册再次漂移到旧路径或过度完成表述。
- **劣势和风险**：文档事实只能说明本地文件已同步，不能替代远端 E2E 重新运行；如果远端状态变化，需再次更新事实源和测试。

### 7. 关键风险点

- **并发问题**：无运行时并发；主要风险是工作树已有大量未提交改动，本轮必须只修改相关文件。
- **边界条件**：不得把本地 `20260604_0001` merge revision 写成远端 E2E 已通过；不得把 1 章/3 章 smoke 写成真实 10 章或 3-5 万字长程完成。
- **性能瓶颈**：测试只读取 Markdown 文本，开销可忽略。
- **安全考虑**：故障手册可提到 provider token 不得入库，但不得读取或输出任何真实密钥。

### 8. 充分性检查

- 能定义接口契约：是。输入为 `docs/operations/troubleshooting.md` 文本，输出为 pytest 断言通过或失败。
- 理解技术选型理由：是。复用既有事实源测试入口和 pytest plain assert。
- 识别主要风险点：是。远端 E2E 未完成、旧路径残留、真实长程过度声明、敏感信息泄露。
- 知道如何验证实现：是。先运行新增单测观察失败，再更新文档，最后运行 `uv run pytest tests/test_phase9_fact_sources.py -q`。

### 9. 外部检索记录

- Context7：查询 `/pytest-dev/pytest`，用途是确认 plain assert 的失败 introspection 适合文件内容断言。
- GitHub search_code：搜索 `read_text(encoding="utf-8")` 与 pytest 断言模式，确认开源项目中常见做法也是用普通 assert 检查文本约束。
- 工具降级：当前环境未暴露 `desktop-commander`，已使用 PowerShell、`rg`、Context7 和 GitHub search_code 替代并记录。
