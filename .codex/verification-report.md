# 验证报告 · UI/UX 审计编辑器改稿交互（分支画布 · Ctrl+K 取消 · 结果 toast 化）

时间：2026-07-24
分支：`feat/uiux-editor-interaction-20260724`

审计「编辑器与改稿反馈」主题里三条交互项（承 #173 反馈刀）。

## 变更（全前端）

- **E15 补丁接受/拒绝/旁注/导出结果长期赖在编辑器顶栏 → 统一走自动消退 toast**：
  `setSuggestionStatus` 从写顶栏状态 state 改为 `emitToast`（一次性结果几秒自散，与行间 toast 一致）；
  删掉 `suggestionStatus` state + 顶栏渲染块 + `SuggestionStatus` 类型；顶栏只留真正持续的 `isReviseLoading`；
  导出去掉重复的显式 emitToast（setSuggestionStatus 已 toast）。
- **E16 Ctrl+K 请求期间无法取消、无 Esc、无 AbortController → 可取消**：
  `reviseFileContent` 加 `signal`，`send` 建 `AbortController` 挂到 session；loading 区加「取消 (Esc)」键 +
  loading 阶段挂 document Esc → `cancelLoading`（abort 在途请求 + teardown + 提示「已取消行间修订」）；
  成功进 diff 前主动摘 loading 的 Esc 处理，避免与 renderDiff 装的重复；取消后 catch 因 sessionRef 清空而静默不报失败。
- **E14 剧情分支画布「即将接入」占位墙覆盖全编辑器、按项目持久化、无退出 → 可退出且不持久化**：
  占位面板加「返回正文」按钮（切回 files 视图）+ 文案指向「版本历史」里已实现的分支图/对比；`toggle-branch-view`
  不再把 branch 写 localStorage（重开项目不再恢复那堵墙「像编辑器坏了」）。未直接内联渲染 BranchCanvas——它依赖
  VersionHistory 内部的 buildGraph + 异步版本加载，独立渲染=重复其逻辑且高风险，且真分支图已在版本历史里可达。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 273 passed（零回归）
npm --prefix apps/desktop/frontend run build       # 构建成功
npx eslint <4 touched>                             # 0 problems
npx prettier --check <4 touched>                   # 通过
```

Ctrl+K 取消 / 分支视图退出是 view-zone / 真编辑器 DOM 交互，SSR 测不到 → 真机归 E2E-1；结果 toast 化沿用既有 ToastHost。
