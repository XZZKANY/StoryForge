# 验证报告 · UI/UX 审计编辑器页签拖拽重排（N-tabdrag）

时间：2026-07-24
分支：`feat/uiux-tab-reorder-20260724`

审计「导航 · 观测 · 设置」主题里的 P3 功能项：编辑器页签不支持拖拽重排。

## 变更（全前端）

- **N-tabdrag 页签拖拽重排**：
  - `editor-tabs-state.ts` 加纯函数 `reorderEditorFiles(openFiles, from, to)`（把 from 搬到 to 位置，越界/同位/未打开原样返回，纯本地数组次序不动磁盘）；
  - `useEditorWorkspaceTabs` 暴露 `reorderOpenFiles`；
  - `EditorTabs` 的文件页签 `Tab` 加 `dragId` + `onReorder`：HTML5 `draggable` + `onDragStart`（setData 路径）/ `onDragOver`（preventDefault + move）/ `onDrop`（读源路径 → onReorder），只文件页签可拖（设置 / 预览页签不挂拖拽）；
  - `AppShell` 把 `tabs.reorderOpenFiles` 透传 `onReorderFiles`。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 274 passed（+1 新：reorderEditorFiles 纯函数）
npx eslint <5 touched>                             # 0 problems
npx prettier --check <5 touched>                   # 通过
```

纯本地排序、不持久化到磁盘（openFiles 本就是会话内存态，切项目重置）。真机拖拽手感归 E2E-1 未验。
