# StoryForge 运维文档索引

更新时间：2026-10-16

## 1. 使用方式

本目录收纳 StoryForge 本地开发、发版与故障排查文档。产品只有 Desktop IDE：界面、TS 引擎（`packages/engine`）与 Rust 宿主都在桌面应用里，宿主不起任何后端进程。Python 后端、OpenAPI 契约、Docker 编排已于 2026-10-16 删除（最后一版 `5e6f8e58`）。

所有本地验证结论必须基于可重复命令，并写入 `.codex/verification-report.md`。

## 2. 文档列表

| 文档 | 用途 | 何时阅读 |
| --- | --- | --- |
| `local-start.md` | 前置工具、安装依赖、启动桌面 IDE、模型配置、本地门禁顺序。 | 新机器、环境重建、首次接手。 |
| `troubleshooting.md` | `pnpm verify` 各道门、浏览器回归、真宿主探针、Tauri 冒烟、打包与本机数据的排障。 | 本地验证失败或行为不确定时。 |
| `release-checklist.md` | 出装机包前的版本号、门禁、构建、冒烟、安装验证与交付记录。 | 准备给作者出包前。 |

## 3. 当前门禁边界

- `pnpm verify`（8 道）：lint、前端类型检查、project-core、TS 引擎类型检查与 golden 契约、前端单测、三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话）。浏览器回归用 fetch 替身代替原生端口，不经过真宿主。
- 经过真宿主的检查：Rust 测试（`npm --prefix apps/desktop run test:rust`）、Tauri 冒烟（开发档 / 发行版 exe）、真宿主探针（`apps/desktop/frontend/scripts/verify-engine-p0-native.mjs`）、NSIS 隔离安装验证。这些不在 `pnpm verify` 里，出包前必跑。
- 没有远端 CI；以本地门禁为准。

## 4. 维护规则

- 新增运维文档后，必须在本索引中登记。
- 修改启动、发版或排障流程后，同步检查根 `README.md` 与 `CLAUDE.md` §4。
- 所有验证结论必须写入 `.codex/verification-report.md`。
