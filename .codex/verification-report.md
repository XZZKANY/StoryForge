# 验证报告 · UI/UX 审计补丁审阅面板（PA23-PA26）

时间：2026-07-24
分支：`feat/uiux-patch-review-20260724`

审计「补丁审阅面板」主题 4 条。

## 变更（全前端）

- **PA23 diff 字号写死 12 且无 CJK → 跟随编辑器**：`PatchReviewPanel` 新增 `editorFontSize` / `editorFontFamily`
  两 props（`Editor.tsx` 从已在作用域的 `editorFontSize` + `resolveEditorFontFamily(editorFontMode)` 透传）；
  diff 选项 `fontSize` 用 prop 值、补 `fontFamily`（CJK 2:1 栈修中英错位）；挂载期一次性创建，值变化由新 `updateOptions` effect 追平。
- **PA24 多块「接受块 N」不透明 → 带行号**：按钮可见文案从 `接受块 N` 改 `接受第 N 处 · 第 X 行`
  （`hunk.originalStartIndex + 1`），不再只靠 hover title 猜位置。
- **PA25 术语「修订/补丁/建议/块」四名 → 收敛「修订」**：面板标题默认 `AI 修订建议`→`AI 修订`（`assistant-suggestions.ts`）；
  `已拒绝建议补丁`→`已拒绝修订`、`已生成待确认补丁`→`已生成待确认修订`、恢复面板 `有待你确认的补丁`→`有待你确认的修订`；
  「补丁 {id}」仅留 diff 追溯 tooltip（内部字段）不动。
- **PA26 hover 底两种写法 → 统一实心**：`PatchReviewPanel` 的 `hover:bg-foreground/10`（半透明）4 处改 `hover:bg-elevated`（与 Composer 一致）。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 272 passed（+1 新：多块行号标签、无「接受块」）
npx eslint <8 touched files>                       # 0 error（仅既有 Editor.tsx:539 warning）
npx prettier --check <touched>                     # 通过（2 文件已 --write）
```

同批更新测试断言：`patch-review-panel.test.tsx`（标题→AI 修订、补 font props、加多块行号断言）、
`chat-window.test.ts`（恢复面板 pendingText → 有待你确认的修订）。真机 diff 字号/字体观感归 E2E-1。
