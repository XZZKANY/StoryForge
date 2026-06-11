# 项目上下文摘要（项目总结推送）

生成时间：2026-05-20 17:09:56 +08:00

## 1. 相似实现分析

- `README.md`：已有项目定位、架构边界、本地环境、验证策略和重要文档索引，可作为项目总结的主事实源。
- `TODO.md`：已有当前状态、任务池、最近迭代记录和发布治理阻碍，可作为阶段与待办事实源。
- `.codex/current-phase.md`：已有 Phase 5/6/7 状态区分、已实现能力、未联通契约和验证入口，可作为当前 Phase 事实源。
- `docs/architecture/phase6-workbench-contract.md`：已有工作台页面、数据源契约和未联通边界，可作为产品工作台总结事实源。
- `docs/operations/release-checklist.md`：已有发布前 Git、环境、OpenAPI、测试和文档门禁，可作为推送前验证事实源。

## 2. 项目约定

- 文档、日志、测试描述和提交信息必须使用简体中文。
- 根目录文档使用 Markdown、编号标题和简洁表格；状态描述区分“已实现 / 已有契约但未联通 / 完全不存在”。
- 代码组织采用模块化单体：`apps/api`、`apps/web`、`apps/workflow`、`packages/shared`、`docs`、`.codex`。
- 验证结论必须写入 `.codex/verification-report.md`，操作过程写入 `.codex/operations-log.md`。

## 3. 可复用组件清单

- `README.md`：复用项目定位、技术栈和常用命令。
- `TODO.md`：复用当前状态、下一版本目标、风险和任务池。
- `.codex/current-phase.md`：复用 Phase 事实入口和验证入口。
- `docs/operations/release-checklist.md`：复用发布前门禁。
- `package.json`：复用 `pnpm verify`、`pnpm test`、`pnpm e2e`、`pnpm openapi` 命令。

## 4. 测试策略

- 测试框架：以 `pnpm` 脚本、Pytest、TypeScript 编译和 `alembic` 验证为主。
- 测试模式：文档完整性检查、Git 状态检查、本地命令执行、OpenAPI 与迁移验证、API/Workflow 回归。
- 参考文件：`package.json`、`docs/operations/release-checklist.md`、`.codex/verification-report.md`。
- 覆盖要求：至少覆盖文档存在、中文内容、项目定位、当前阶段、交付物、验证方式、风险和下一步。

## 5. 依赖和集成点

- 外部依赖：Git、GitHub 远端、Docker、PostgreSQL、Redis、Node.js、Python、pnpm。
- 内部依赖：README、TODO、当前 Phase、运维文档、OpenAPI 快照、验证报告。
- 集成方式：文档引用事实源，验证流程通过本地命令复现，最终通过 Git 提交与 push 同步。
- 配置来源：`package.json`、`.env.example`、`docs/operations/*.md`。

## 6. 技术选型理由

- 选择新增根目录 `PROJECT_SUMMARY.md`：便于交接和推送版阅读，且不破坏现有 README 的主入口职责。
- 继续复用现有 `.codex` 记录：符合仓库内审计留痕习惯，便于后续恢复上下文。
- 使用现有验证脚本和文档门禁：与仓库既有发布流程一致，避免自建流程。

## 7. 关键风险点

- 工作区存在大量未提交的 Phase 5/6/发布治理变更，提交前必须确认没有误删或漏提。
- 远端分支状态需要在最终 push 前再次确认，避免在过时基线之上发布。
- 文档总结必须避免把“契约已定义”写成“全部功能已联通”。
