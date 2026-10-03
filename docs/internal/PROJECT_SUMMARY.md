# StoryForge 项目总结

更新时间：2026-09-28

## 项目定位

StoryForge 是 Desktop IDE-first AI writing workbench，服务长篇小说作者的本地写作、对话审稿、修订、diff 确认及版本追踪。`apps/desktop` 是唯一主体验；`apps/web` 与独立 `apps/workflow` 已退役。BookRun 保留后台历史兼容，不是桌面自动整书主线。

技术主线为 Tauri / React / Monaco 桌面端与 FastAPI / SQLAlchemy API sidecar。正文真相在本地项目文件；API 保留会话、运行记录与证据；OpenAPI 和派生 Agent 帧 schema 承接契约。

## 当前能力

全文搜索、现场恢复、对话 Agent、写章、受控润色、结构化拆书已有代码接线。文件工具保护已提交为 `fd7a7fa6`，通过定向验证及 Linux 符号链接补验；不构成完整质量或发布验收。

本轮基础改进把修订能力与会话、采集与纯选择、工具声明与执行策略分开，并补齐结算/证据故障回归、安全诊断、统一测量与受控润色复用。改动按切片可回退，仍未提交；不追求 SDK 本身，也不承诺未来所有需求零跨层修改。入口见 [写作能力反馈地图](../architecture/authoring-feedback.md)。文风有界读取已有精确语义对照和资源改善，不能据此声称整体 Agent 更快；其链接 containment/目录遍历预算仍待独立修复。

## 验证摘要

2026-09-28 Agent 可靠性 R1–R8 已完成本地实现与规定集成：同 run 恢复、失败/截断、磁盘基线、阶段取消、压缩保真、请求证据、有限恢复与 Knowledge 回执核对完成；自动档进度不再混淆准备和已落盘；最终审计补齐非2xx错误正文挂起时不恢复的真实红绿回归。完整 verify 通过（API 2349 passed / 7 skipped、FE 149 files / 1231 passed、project-core 7），E2E 20、Rust 82 / 1 ignored、Desktop runner 30 通过；API/Desktop 当前重建、packaged、两条 browser 与两次隔离 native GUI 通过。源码及产物绑定见 current-phase 和验证报告。未提交、未发布；不是全部权限真机、真实模型或长篇质量验收。

以下 2026-09-27 为此前基础计划验收，不是本轮可靠性总验收：

2026-09-27 当前未提交工作树：核心 `pnpm.cmd verify` 通过（API 1852 passed / 7 skipped、前端 136 files / 1038 passed、project-core 7 passed、Shared 类型/Ruff/daily/drift 通过）；E2E 20 passed，Rust 56 passed / 1 ignored，冻结 sidecar 重建/冒烟通过。两条 browser smoke 通过，重建 release 两次全新隔离原生 GUI fixture 通过，实际验证拒绝/漂移不写盘、确认写盘和写前快照/版本证据。**本轮持续演进基础总计划已完成本地实现与验收**；合成补丁场景不是全部权限档位、真实模型质量或安装器验收。详见 current-phase 与验证报告。未提交、未发布。

以下为历史，不是本轮结果：

2026-09-05 修复已登记门禁失败后实跑：`pnpm.cmd verify` 全部通过；API 全量 **1581 passed / 7 skipped**，前端 **90 files / 582 passed**，project-core **7 passed**；lint、类型检查、API 全量 Ruff、daily sidecar 冒烟及 OpenAPI 漂移检查通过。同日文件工具任务的冻结 sidecar 重建、冒烟及实际搜索/正则超时探针通过。随后基于已提交源码的 Linux 补验 **56 passed / 1 skipped**：普通符号链接三项及 Project Knowledge 越界链接均通过，仅跳过 Windows 专属 junction；后者已在本机通过。Windows 原生符号链接仍受权限限制。总门禁运行时包含本地未提交修复，本轮代码随后已提交；结果不代表远端 CI 或已发布安装包。

历史 10 章 smoke 已通过人工通读；30 章真实长程运行已完成，但人工通读结论为“退回重跑”。历史 G.1/A6/A7 GUI 验收不代表当前工作树全部权限档位的真机链路已验收。本轮未调用真实 LLM，未核对最新远端 CI。

## 当前不能承诺

- 不能宣称真实 3-5 万字长程质量验收通过。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能把本地核心门禁通过等同于完整发布验收或已发布。

## 后续入口

当前阶段事实以 `docs/internal/current-phase.md` 为准；PROJECT_SUMMARY 只保留项目总览和摘要。下一步见 [TODO.md](TODO.md)，命令和结果见 [验证报告](../../.codex/verification-report.md)，旧总结见 [总结历史](../archive/internal-history-2026-09/PROJECT_SUMMARY-history-2026-06-21.md)。
