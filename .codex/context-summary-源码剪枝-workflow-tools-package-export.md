## 项目上下文摘要（源码剪枝 workflow-tools-package-export）

生成时间：2026-06-05 11:05:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/tools/registry.py`
  - 模式：CreativeToolRegistry 的唯一事实源，定义工具 schema、能力、证据字段和页面/API/Workflow 引用。
  - 可复用：必须保留 `DEFAULT_CREATIVE_TOOL_REGISTRY`、`CreativeToolSpec`、`list_creative_tools` 等真实实现。
  - 需注意：API runtime_tools 通过文件路径直接加载该文件。
- **实现2**: `apps/workflow/storyforge_workflow/tools/__init__.py`
  - 模式：仅从 `tools.registry` 重新导出同一批符号。
  - 可复用：无当前仓库调用方；属于重复公共出口。
  - 需注意：保留包目录语义即可，不应继续转导出 registry。
- **实现3**: `apps/api/app/domains/runtime_tools/service.py`
  - 模式：用 `importlib.util.spec_from_file_location` 按路径加载 `workflow/storyforge_workflow/tools/registry.py`，避免触发 workflow 包顶层导入。
  - 可复用：验证 API runtime-tools 不依赖 `storyforge_workflow.tools` 包级出口。
  - 需注意：本批不改变 API 读取 runtime tools 的行为。
- **实现4**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：Workflow 剪枝护栏通过 pathlib 读取文件文本，防止已下线入口回归。
  - 可复用：新增 tools 包级转导出防回归断言。
  - 需注意：测试说明使用简体中文。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，中文 docstring 描述意图。
- **文件组织**: Workflow registry 保留在 `storyforge_workflow/tools/registry.py`；包级初始化文件只承担包标记或轻说明。
- **导入顺序**: Python 标准库导入在前，项目内导入在后；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/tools/registry.py`: CreativeToolRegistry 事实源。
- `apps/workflow/tests/test_creative_tool_registry.py`: 验证 registry 行为不变。
- `apps/workflow/tests/test_source_pruning.py`: 本批新增剪枝护栏。
- `apps/api/app/domains/runtime_tools/service.py`: API 从 registry.py 派生 runtime tools 的集成点。

### 4. 测试策略

- **测试框架**: Workflow 使用 pytest；API 使用 pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_creative_tool_registry.py`、`apps/api/tests/test_runtime_tools.py`、`apps/api/tests/test_model_runs.py`。
- **覆盖要求**: `tools/__init__.py` 不再转导出 registry 符号；`tools/registry.py` 行为和 API runtime-tools 输出不变。

### 5. 依赖和集成点

- **外部依赖**: Python importlib、pytest、ruff。
- **内部依赖**: API runtime_tools 按文件路径加载 `registry.py`；Workflow registry 测试直接导入 `storyforge_workflow.tools.registry`。
- **集成方式**: 移除重复包级出口，不修改 registry 本体。
- **配置来源**: `apps/workflow/pyproject.toml` 指定 pytest testpaths 与 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from storyforge_workflow.tools import ...` 调用，包级转导出只增加重复公共入口。
- **优势**: registry 事实源更单一，降低未来维护和源码扫描噪声。
- **劣势和风险**: 外部未记录调用包级 `storyforge_workflow.tools` 的代码会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除 `tools/registry.py`，不修改工具清单、schema、API 路径或 page_refs。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、Provider 配置、API Key 或安全中间件。
