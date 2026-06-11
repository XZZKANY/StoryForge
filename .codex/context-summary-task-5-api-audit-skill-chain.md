## 项目上下文摘要（Task 5 API 审计技能链）

生成时间：2026-05-31 19:50:47 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/exports/book_markdown_exporter.py`
  - 模式：导出函数读取 completed BookRun、构造 payload、通过 `create_artifact` 登记制品。
  - 可复用：`export_book_run_audit_report` 的既有审计报告字段和前置证据校验。
  - 需注意：追加字段不能破坏 `chapters`、`quality_summary` 等旧消费者。
- **实现2**: `apps/workflow/storyforge_workflow/skills/audit.py`
  - 模式：`derive_skill_chain_projection` 把 BookLoop progress 转成只引用化技能链投影。
  - 可复用：真实 `skill_runs` 优先、旧 progress 派生、`prompt` 与 `final_draft` 不进入投影。
  - 需注意：API 不应复制业务规则，应复用该纯函数。
- **实现3**: `apps/api/app/domains/book_runs/workflow_prompt_bridge.py`
  - 模式：按文件路径加载 workflow 纯函数，绕开 `storyforge_workflow` 顶层运行时依赖。
  - 可复用：`importlib.util.spec_from_file_location`、`lru_cache`、相邻 `apps/workflow` 定位方式。
  - 需注意：技能审计 bridge 应避免导入 workflow 顶层。
- **实现4**: `apps/api/app/domains/runtime_tools/service.py`
  - 模式：延迟加载 workflow registry，并递归转换冻结容器为 JSON 值。
  - 可复用：`_to_jsonable` 的 Mapping、Sequence、Set 转换思路。
  - 需注意：不跨域导入 runtime_tools，避免职责混杂。

### 2. 项目约定

- **命名约定**: Python 模块、函数和变量使用 `snake_case`；测试函数以 `test_` 开头。
- **文件组织**: API 域逻辑位于 `apps/api/app/domains/*`；导出能力位于 `exports`，BookRun 跨 workflow 桥接位于 `book_runs`。
- **导入顺序**: `from __future__ import annotations` 开头，标准库、第三方、项目内导入分组。
- **代码风格**: Python 3.11，ruff line-length 120，中文 docstring 说明意图和边界。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/skills/audit.py`: `derive_skill_chain_projection` 是技能链投影事实源。
- `apps/api/app/domains/artifacts/service.py`: `create_artifact` 负责登记导出制品。
- `apps/api/app/domains/book_runs/workflow_prompt_bridge.py`: API 跨边界加载 workflow 纯函数的参考模式。
- `apps/api/app/domains/runtime_tools/service.py`: JSON 化冻结容器的参考模式。

### 4. 测试策略

- **测试框架**: pytest，API 测试从 `apps/api` 通过 `uv run pytest` 执行。
- **测试模式**: 单元式数据库 fixture + FastAPI TestClient endpoint 覆盖。
- **参考文件**: `apps/api/tests/test_book_exporter.py`、`apps/workflow/tests/test_skill_audit_summary.py`。
- **覆盖要求**: 真实 `skill_runs` 优先、旧 progress 兼容派生、敏感字段不泄露、endpoint payload 保持可读。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy、FastAPI、pytest；不新增依赖。
- **内部依赖**: API 导出层依赖 `BookRun.progress`；技能链投影依赖 workflow 纯函数文件。
- **集成方式**: 新增 API bridge 按路径加载 `skills/audit.py`，导出函数调用 bridge 后把结果放入 `report["skill_chain"]`。
- **配置来源**: `apps/api/pyproject.toml` 定义 pytest 与 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: workflow 侧已有完整事实源；API 侧已有按路径加载 workflow 纯函数的模式。
- **优势**: 避免复制技能链业务规则；保持 API venv 不依赖 langgraph；新增字段对旧消费者低风险。
- **劣势和风险**: 文件路径加载需要谨慎命名模块；需要递归 JSON 化 dataclass 和冻结容器。

### 7. 关键风险点

- **并发问题**: bridge 使用 `lru_cache` 缓存模块加载，只读函数，无共享可变业务状态。
- **边界条件**: progress 缺失 `skill_runs` 时仍需派生旧事件；真实 `skill_runs` 缺少关键字段时由 workflow 事实源过滤。
- **性能瓶颈**: 导出时线性遍历章节和技能运行记录，规模与章节数相关，可接受。
- **安全考虑**: 本阶段只说明敏感正文、完整提示词和 Scene Packet 不进入审计投影，验收以不泄露字段为准。

### 8. 外部资料与工具记录

- Context7 查询 `/pydantic/pydantic`：Pydantic v2 `TypeAdapter.dump_python` 可序列化 dataclass，但本项目投影含 `MappingProxyType`，采用既有递归 JSON 化模式更贴合代码库。
- GitHub `search_code` 查询 `"skill_chain" "audit_report.json"` 无直接结果；查询 `"audit_report" "events" "summary"` 仅作为审计报告结构参考，未引入外部代码。
- 本环境没有 desktop-commander 可调用工具，已改用 PowerShell 与 `rg` 完成本地检索。
