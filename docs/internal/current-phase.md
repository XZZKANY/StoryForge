# StoryForge 当前阶段事实源

更新时间：2026-09-05（本地工作树核对，非发版声明）

## 事实源职责矩阵

| 文件 | 职责 |
| --- | --- |
| `docs/internal/current-phase.md` | 当前阶段唯一事实源：能力、证据、未验收边界。 |
| `docs/internal/TODO.md` | 当前下一步执行入口，不复制历史流水账。 |
| `docs/internal/PROJECT_SUMMARY.md` | 项目总览和验证状态摘要。 |
| `README.md` | 面向使用者的入口摘要。 |
| `docs/internal/dev-plan.md` | 历史计划和阶段 DoD，不证明最新状态。 |

逐次验证命令和结果见 [验证报告](../../.codex/verification-report.md)。7 月及以前经过见 [阶段历史](current-phase-history-2026-07-26.md)。

## 当前阶段

StoryForge 是面向长篇小说作者的 Desktop IDE-first AI writing workbench，产品方向为 Cursor for Fiction。`apps/desktop` 是唯一主体验；`apps/api` 负责运行时、业务判断及证据；manuscript truth 是本地项目文件。`apps/web` 已退场，`apps/workflow` 已于 2026-07-26 退役，不恢复旧入口。

当前处于作者辅助 IDE 能力迭代与验收补齐阶段，最新工作树已通过本地核心总门禁，尚不能给出“发布就绪”的结论。保留既定写作优先方向，以真实写作摩擦决定功能需求。本轮没有读取仓库外连载资产，不把 7 月章节数当作当前写作进度。

## 已实现的能力与证据

| 能力 | 当前代码依据 | 证据边界 |
| --- | --- | --- |
| 项目全文搜索 | `apps/desktop/frontend/src/App.tsx` 接入 `useProjectSearch` | 已接入；本轮未重做 GUI 验收。 |
| 工作区现场恢复 | `App.tsx` 接入 `useSessionRestore` | 已接入项目、页签与光标恢复；不代表所有面板状态均持久化。 |
| 对话式 Agent | `agent_runs/loop_runtime.py`、`loop/sdk_adapters.py`、`app/platform/ai_sdk` | 自由文本工具循环，ToolSpec 派生能力；固定 intent 仍是独立入口。 |
| 写章及受控润色 | `agent_runs/intent.py` 包含 `chapter.write`、`chapter.polish` | 已实现，不等于小说质量通过。 |
| 结构化拆书 | `useProjectCommands.ts`、`ide/book_breakdown.py` | Desktop 调用已接入；报告加载按项目归属，切换/关闭项目和旧响应回流回归通过。 |
| 文件边界与资源限制 | `agent_runs/fs_safety.py`、`fs_tools.py`、`fs/project_knowledge.py` | 修复已提交为 `fd7a7fa6`；定向测试及冻结 exe 实际搜索通过，Linux 已补齐普通符号链接验证，Windows junction 通过。 |
| BookRun 历史兼容 | `tools/catalog.py` 已移除 `bookrun.*` 注册，`intent.py` 已移除 `bookrun.start` | 后台兼容仍存在，不再列为桌面 Agent 可启动的当前能力。 |

默认 `ask` 档逐次确认；`auto` / `full` 只免点击，不免除 guarded writeback、漂移拒写、项目边界、写前快照与版本记录。后端仅产出 proposed patch，不直接修改手稿。一次对话的单补丁限制仍存在。

不再在活文档手写工具、intent 或视图总数；实际清单以注册代码和派生 schema 为准。

## 当前验证状态

以下来自 2026-09-05 的本地实跑，不代表远端 CI 或已发布安装包。总门禁运行时包含未提交修复，随后本轮代码按确认分批提交；其他原有未提交工作仍保留。`pnpm.cmd verify` 全部通过；Linux 补验使用 `5eea3765` 的已提交源码及冻结依赖，文件工具定向和 packaged 验证保留同日上一项任务的结果。

| 验证项 | 结果 | 边界 |
| --- | --- | --- |
| API 全量 pytest | 1581 passed / 7 skipped | 已修复 13 项既有失败；包含新增的 4 项当前文档事实源测试。 |
| Desktop frontend | 90 files / 582 passed | lint、类型检查通过；包含 3 项新增拆书报告状态回归。 |
| project-core / Shared | 7 passed / 契约类型检查通过 | 已纳入本地核心总门禁。 |
| 文件工具定向与源码门禁 | 63 passed / 3 skipped | 普通符号链接创建受权限限制；Windows junction 真链接通过。 |
| Linux 文件工具补验 | 56 passed / 1 skipped | 无网络容器运行原有 6 份测试；三个文件边界符号链接用例及 Project Knowledge 越界链接用例均通过，仅跳过 Windows junction。 |
| 共享扫描调用方 | 244 passed / 1 skipped | 一致性、canon、知识、拆书等集合。 |
| 工具失败反馈与跨章 | 16 passed | 预算错误反馈模型；章序遍历失败不被吞掉。 |
| API 全量 Ruff | 通过 | `uv run ruff check .`。 |
| OpenAPI 漂移 | 无漂移 | 文件工具修复没有改变 API 契约。 |
| 冻结 sidecar | 重建及 packaged smoke 通过 | 实际 exe 经本地模拟 provider 完成普通搜索并拒绝高回溯正则；非真实 LLM 或 GUI 验收。 |
| `pnpm.cmd verify` | 通过 | 本地核心门禁全部通过，含 daily sidecar 冒烟与 OpenAPI 刷新及漂移检查。 |
| 当前 GUI / 真实 LLM / 远端 CI | 本轮未验证 | 不继承旧版本通过结论。 |

## 历史质量与 GUI 证据

- 真实 LLM 1/3/10 章 smoke 有历史记录，10 章 smoke 已通过人工通读；一次 30 章真实长程运行链路可达并导出制品，但人工通读退回重跑。证据：`.codex/real-llm-30ch-mimo25pro-20260611-192356`。
- 30 章曾出现测试痕迹残留、模板化、称谓混乱和 17/18 章时间线冲突；recap 膨胀、reasoning token 泄漏等工程修复不能证明质量问题消失。Q9 16 章历史通过也不替代新长程验收。
- 历史记录报告 2026-07-07 G.1、2026-07-12 A6/A7 的真实 Tauri 桌面端到端及“安全可日更”验收通过。本轮未重跑，不能扩展为当前版本全部权限档位和 GUI 链路验收完成。
- 远端 E2E run `26944063055` 仅为历史证据，本轮没有查询最新远端状态。

## 仍未完成的验收项

1. Windows 原生符号链接仍受用户权限限制；通用链接规则已在 Linux 实际验证，Windows junction 已通过。拟发布版本可在具备权限的 Windows 环境补跑原生符号链接；resolve 校验不是抵抗恶意本地并发路径替换的 OS 沙箱。
2. 对拟发布版本执行 GUI 保存、diff 确认及权限档位验收，不能仅依赖 headless 工具循环。
3. 用固定写作任务比较时间、改稿保留率、返工和人工偏好。质量实验室 PRD 的 benchmark 和晋级门槛仍需收敛；没有新的真实长程质量通过结论。

## 禁止宣称范围

- 不能宣称真实 3-5 万字长程质量验收通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能把历史 GUI 通过、单 provider headless 证据或本地模拟 provider 探针当作当前全部真机写回链路已验收。
- 不能把本地未提交修复描述成已经合并或已经发布。
