# 项目上下文摘要（架构优雅化 A1/A3/A2/A4）

生成时间：2026-06-27 21:30:35 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/agent_runs/revise_scope.py`：把 `file.revise` 范围解析、最小改动契约与 drift warning 从 `runtime.py` 外移为纯函数模块；本轮沿用“同名私有 helper + runtime import”的模式。
- `apps/api/app/domains/agent_runs/_text.py`：承载 runtime 与 revise scope 共享的无状态文本/集合原语；本轮 intent 继续复用 `_optional_string`、`_string_arg_list`、`_ordered_unique`。
- `apps/api/app/domains/agent_runs/role_catalog.py`：集中解析 agent role name / mention / alias；本轮 `_role_hints` 外移后仍通过 `get_agent_role()` 与 `resolve_agent_role_alias()` 保持同一目录事实源。
- `apps/api/app/domains/agent_runs/trace.py`：A2 中新抽出的轻量 trace 类型，供 runtime、service、review report 共用，避免 `review_report.py` 反向 import runtime。
- `apps/api/app/domains/agent_runs/tooling.py`：A4 中新增的工具/权限/子代理执行脚手架模块，runtime 只保留 facade 与事件接口。

## 2. 项目约定

- 命名约定：Python 模块使用 snake_case；runtime 内部 helper 继续保持下划线前缀，避免扩大公开接口。
- 文件组织：`agent_runs/runtime.py` 保持 facade + tool 注册；纯函数簇放回同 domain 的薄模块。
- 导入顺序：使用 ruff/isort 规则自动整理；`SUPPORTED_INTENTS as SUPPORTED_INTENTS` 是兼容 re-export 写法。
- 代码风格：零行为变更，搬函数不改分支顺序、错误文案、返回结构或调用签名。

## 3. 可复用组件清单

- `app.domains.agent_runs._text`：复用字符串列表与去重工具。
- `app.domains.agent_runs.role_catalog`：复用 agent role 解析与 alias 解析。
- `app.domains.ide.orchestrator.AgentOrchestrationError`：保留 runtime 原捕获的异常类型，避免错误路径行为漂移。

## 4. 测试策略

- 测试框架：pytest + ruff。
- 参考文件：`apps/api/tests/test_agent_runs.py`、`apps/api/tests/test_ide_agent_orchestrator.py`。
- 覆盖方式：保留 legacy `ide.orchestrator` 既有测试语义，同时新增 live Agent Runtime intent/bookrun summary 直接断言。

## 5. 依赖和集成点

- `AgentRuntime.run_user_message()` 继续调用 `_message_text`、`_message_args`、`_detect_intent`、`_role_hints`、`_role_mentions`。
- `AgentRuntime._run_bookrun_generation()` 继续调用 bookrun 计划、预算、风险摘要 helper。
- `AgentRuntime._file_review()` 继续通过 `_build_multi_agent_review_report_with_executor()` 获得 review report 与 tool traces；executor 以 Protocol 形式传入，避免新模块依赖 runtime 具体类。
- `AgentRuntime` 继续持有 `_tool_registry`、`_permission_gate`、`_subagents` 实例；具体类定义下沉到 `tooling.py`。
- `legacy.orchestrator` 仍由 `runtime.py` adapter 调用；本轮未改 legacy 文件。

## 6. 技术选型理由

- 选择纯模块拆分而非抽象类/新接口：A1/A3 都是无状态纯函数簇，薄模块能最大化 locality，同时保持调用面不变。
- 保留 re-export：避免已有调用方私下从 `agent_runs.runtime` 读取 `SUPPORTED_INTENTS` 时破坏兼容。

## 7. 关键风险点

- Import 环风险：`intent.py` 依赖 `ide.orchestrator.AgentOrchestrationError`；A2 把 trace 类型抽到 `trace.py`、executor 以 Protocol 表达；A4 的 `tooling.py` 依赖 role catalog 与 `AgentRun`，不依赖 runtime；已用 `uv run python -c "import app.main"` 验证无环。
- 测试语义风险：`test_ide_agent_orchestrator.py` 仍覆盖 legacy orchestrator，未改 import；live runtime 覆盖追加在 `test_agent_runs.py`。
- 行为漂移风险：新增模块函数从 `runtime.py` 原样移动，focused tests 与 import smoke 均通过。
