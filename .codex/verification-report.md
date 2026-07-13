# 验证报告：Publish Cockpit Phase 1（收口）

时间：2026-07-13  
分支：`feat/publish-cockpit-phase1`  
任务：`.trellis/tasks/07-13-publish-cockpit-phase1/`  
文档：`docs/internal/publish-fleet/`

## 已执行

| 命令 | 结果 |
| --- | --- |
| `npm --prefix apps/desktop/frontend run typecheck` | 通过 |
| `npm --prefix apps/desktop/frontend run test -- tests/publish-model.test.ts tests/publish-sync.test.ts` | 9/9 通过 |

## 收口交付

- `publish.json` 双向同步：`storage/project-publish.ts`；`saveLibrary` 写回项目；`loadLibraryMerged` 合并较新项目字段
- Ready 扫描：`storage/ready-scan.ts`；面板「刷新 Ready」+ 命令 `Publish: 刷新 Ready 扫描`
- 命令总线：`commands.ts` + CommandPalette 全套 Publish 命令 + App `handlePublishCommand`
- 测试：`publish-sync.test.ts`（merge / bookToProjectPublish）

## 仍未验证

- 真机 Tauri 端到端（入库→指派→作业包→确认已开→止损→校准→publish.json 落盘）
- Ready 扫描在真实大目录性能
- 全量 frontend test / `pnpm lint`
- 网格月历、Kanban 拖拽（列表版已满足经营闭环）

## 红线自检

- 无 OAuth / 番茄登录 / L2–L4 / 反检测代码路径
