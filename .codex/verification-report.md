# 验证报告 · UI/UX 审计导航/观测（删左搜索 · 重扫反馈 · 页签溢出）

时间：2026-07-24
分支：`feat/uiux-nav-20260724`

审计「导航 · 观测 · 设置」主题 P2 项中的三条（设置页两条 N-savestate/N-settingssearch 另拆一刀，见后续）。

## 变更（全前端）

- **N-search 左栏「搜索」未接线死占位、与顶栏命令面板重复 → 删左留中**：删除 `SidePanel` 的 `SearchView`（连带
  死掉的 `ViewHead`）+ 渲染分支、`ActivityBar` 的 search 图标项（连带 `Search` 图标导入）、`App.tsx` 的
  `Ctrl+Shift+F → switchView('search')` 映射；`SidePanelView` 收窄为单 `'explorer'`、`SIDE_PANEL_VIEWS` 同步。
  诚实说明：这撤掉了一个从未接线的「全文检索」许诺（文件搜索走顶栏命令面板 Ctrl+P）。顺手把活动栏 tooltip
  「故事文件」统一为「资源管理器」。
- **N-rescan 观测「重新扫描」已有数据时点击无反馈 → 独立 scanning**：`useObservatory` 加 `scanning` 布尔
  （与 availability 解耦，起手置真、finally 里只由最新一次扫描置假），`ObservatoryView` 的转圈与「扫描中…」
  改吃 `busy = scanning || loading`（此前 spinner 只绑 availability='loading'，有数据时静默重扫故毫无反应）。
- **N-taboverflow 页签行无溢出、长/多页签把徽标+…菜单挤出屏 → 横向滚动**：页签列表单独包
  `min-w-0 flex-1 overflow-x-auto` 滚动容器、页签 `flex-shrink-0` 不再被压扁；「只读派生文件」徽标 + 「…」菜单
  移到滚动容器外 `flex-shrink-0` 组（加左描边分隔）钉右端，始终可见。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS（SidePanelView 收窄传播零报错）
npm --prefix apps/desktop/frontend run test        # 52 files / 272 passed（app.test 活动栏断言同步为 文件/设置 + 断言无 search）
npx eslint <9 touched>                              # 0 problems
npx prettier --check <touched>                      # 通过（SidePanel 已 --write）
```

真机横向滚动/重扫转圈/删搜索后布局观感归 E2E-1 未验。
