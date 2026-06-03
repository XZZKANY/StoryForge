## 项目上下文摘要（story-memory-guard）

生成时间：2026-06-02 21:18:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/story_memory/service.py`
  - 模式：领域 service 暴露纯函数和数据库会话函数，返回 Pydantic 契约对象。
  - 可复用：`get_active_memory_atoms(session, book_id, chapter_id, ...)` 已按 `valid_from_chapter/valid_to_chapter` 过滤有效事实。
  - 需注意：该文件已有其他代理未提交改动，本任务新增 `guard.py` 降低覆盖风险。
- **实现2**: `apps/workflow/storyforge_workflow/quality/prose_static_check.py`
  - 模式：静态质量检查返回 `dimension/severity/snippet/message/suggestion/revision_strategy` 字段。
  - 可复用：端口字段结构和高严重度表达。
  - 需注意：API 域不反向依赖 workflow 包，只复用契约形状。
- **实现3**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：`NovelLoopPorts.check_static_quality` 接受 dict 或对象，`severity` 为 `high/高` 或 `revision_strategy=regenerate` 时阻断为 `awaiting_review`。
  - 可复用：issue dict 必须兼容 `_issue_to_dict` 与 `_has_high_severity`。
  - 需注意：本切片不改 workflow adapter，仅提供可注入端口的只读函数。
- **实现4**: `apps/api/tests/test_story_memory_contract.py`
  - 模式：Story Memory 契约测试使用中文 docstring、真实 ORM session、plain assert。
  - 可复用：`MemoryAtom` 直接构造、`create_memory_atom` 持久化、按行为断言返回契约。
  - 需注意：该文件已有其他代理新增 memory_extract 测试，本任务只追加 guard 测试。

### 2. 项目约定

- **命名约定**: Python 函数、测试使用 `snake_case`；领域模块按 `app/domains/<domain>/` 组织。
- **文件组织**: 只读领域逻辑放在 `apps/api/app/domains/story_memory/guard.py`，避免扩大 `service.py` 的并行冲突面。
- **导入顺序**: `__future__`、标准库、第三方、项目内模块。
- **代码风格**: 中文 docstring/注释；小函数拆分；测试使用真实 session，不 mock 数据库服务。

### 3. 可复用组件清单

- `apps/api/app/domains/story_memory/service.py:get_active_memory_atoms`: 读取指定章节有效 MemoryAtom。
- `apps/api/app/domains/story_memory/service.py:create_memory_atom`: 测试中写入 MemoryAtom。
- `apps/api/app/domains/story_memory/schemas.py:MemoryAtom`: 长期事实契约。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:_has_high_severity`: 验证 high severity 与 regenerate 的阻断语义。
- `apps/workflow/storyforge_workflow/quality/prose_static_check.py:StaticProseIssue.as_report_item`: issue dict 字段参考。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: API 域合同测试和持久化测试。
- **参考文件**: `apps/api/tests/test_story_memory_contract.py`、`apps/api/tests/test_story_memory_persistence.py`、`apps/workflow/tests/test_novel_loop_single_chapter.py`。
- **覆盖要求**: active 高置信事实违反输出 high issue；未违反无 issue；过期事实不触发。
- **RED 结果**: `uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q` 在生产代码未实现时失败，错误为 `ModuleNotFoundError: No module named 'app.domains.story_memory.guard'`。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy session、Pydantic v2 BaseModel 既有依赖。
- **内部依赖**: `story_memory.guard` 只依赖 `get_active_memory_atoms` 与 `MemoryAtom`。
- **集成方式**: 后续由 NovelLoop `check_static_quality` 端口注入，不在本切片修改 adapter。
- **配置来源**: 无新增配置、无环境变量读取。

### 6. 技术选型理由

- **为什么用这个方案**: 新增 `guard.py` 可保持只读职责独立，避免覆盖 `service.py` 中其他代理的未提交改动。
- **优势**: 小范围、可测试、输出直接兼容 NovelLoop 静态质量端口。
- **劣势和风险**: 保守文本匹配无法覆盖复杂语义矛盾，后续需要在接入 adapter 后补更多回归样例。

### 7. 关键风险点

- **并发问题**: 工作树已有大量并行改动；本任务避免回滚、格式化或修改禁止写集。
- **边界条件**: 低置信事实、非目标 fact_type、未命中实体名、过期事实不触发。
- **性能瓶颈**: 当前为 active atoms 线性扫描；最小切片可接受。
- **安全考虑**: 不读取 `.env`、API Key 或凭据；测试数据不包含真实凭据。

### 8. 外部资料与工具记录

- **Context7**: 查询 `/pydantic/pydantic`，确认 Pydantic v2 `BaseModel` 与 `model_dump` 用法；本任务未新增 schema，保持 dict 输出。
- **GitHub search_code**: 查询 `"dimension" "severity" "snippet" "suggestion" language:Python`，参考静态分析/审查模型常见字段化输出；最终以仓库内 NovelLoop/prose_static_check 契约为准。
- **desktop-commander**: 当前工具列表不可用，已记录并使用 PowerShell 与 `rg` 替代本地文件检索。
