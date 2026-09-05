# StoryForge 项目总结

更新时间：2026-09-05

## 项目定位

StoryForge 是 Desktop IDE-first AI writing workbench，服务长篇小说作者的本地写作、对话审稿、修订、diff 确认及版本追踪。`apps/desktop` 是唯一主体验；`apps/web` 与独立 `apps/workflow` 已退役。BookRun 保留后台历史兼容，不是桌面自动整书主线。

技术主线为 Tauri / React / Monaco 桌面端与 FastAPI / SQLAlchemy API sidecar。正文真相在本地项目文件；API 保留会话、运行记录与证据；OpenAPI 和派生 Agent 帧 schema 承接契约。

## 当前能力

全文搜索、现场恢复、对话 Agent、写章、受控润色、结构化拆书已有代码接线。文件工具保护已提交为 `fd7a7fa6`，通过定向验证及 Linux 符号链接补验；不构成完整质量或发布验收。

## 验证摘要

2026-09-05 修复已登记门禁失败后实跑：`pnpm.cmd verify` 全部通过；API 全量 **1581 passed / 7 skipped**，前端 **90 files / 582 passed**，project-core **7 passed**；lint、类型检查、API 全量 Ruff、daily sidecar 冒烟及 OpenAPI 漂移检查通过。同日文件工具任务的冻结 sidecar 重建、冒烟及实际搜索/正则超时探针通过。随后基于已提交源码的 Linux 补验 **56 passed / 1 skipped**：普通符号链接三项及 Project Knowledge 越界链接均通过，仅跳过 Windows 专属 junction；后者已在本机通过。Windows 原生符号链接仍受权限限制。总门禁运行时包含本地未提交修复，本轮代码随后已提交；结果不代表远端 CI 或已发布安装包。

历史 10 章 smoke 已通过人工通读；30 章真实长程运行已完成，但人工通读结论为“退回重跑”。历史 G.1/A6/A7 GUI 验收不代表当前工作树全部权限档位的真机链路已验收。本轮未调用真实 LLM，未核对最新远端 CI。

## 当前不能承诺

- 不能宣称真实 3-5 万字长程质量验收通过。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能把本地核心门禁通过等同于完整发布验收或已发布。

## 后续入口

当前阶段事实以 `docs/internal/current-phase.md` 为准；PROJECT_SUMMARY 只保留项目总览和摘要。下一步见 [TODO.md](TODO.md)，命令和结果见 [验证报告](../../.codex/verification-report.md)，旧总结见 [总结历史](PROJECT_SUMMARY-history-2026-06-21.md)。
