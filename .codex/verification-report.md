# 验证报告 · 编辑器与补丁确认 UI/UX（作者文案降噪）

时间：2026-07-24  
任务：`.trellis/tasks/07-24-editor-patch-ux`

## 变更摘要

1. **`PatchReviewPanel`**：主行仅保留 title / summary / 路径 / `+n/-m` / scopeWarning。
2. **工程字段**：patch id、session、model、issueIds 经 `buildPatchReviewTraceTitle` 写入 `data-testid="patch-trace"` 的 `title`（hover 追溯）。
3. **按钮与写回**：接受 / 拒绝 / 保存旁注 / 接受块 文案与行为未改。
4. **测试**：`tests/patch-review-panel.test.tsx`；monaco stub 补 `createDiffEditor` 空实现。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test -- tests/patch-review-panel.test.tsx
# 1 file / 3 tests PASS
npm --prefix apps/desktop/frontend run test -- tests/behavior/writeback-guard.vitest.ts
# 5 tests PASS（写回红线零回归）
```

## 未验证

- 真机 Tauri 补丁面板 hover title 观感
- 全量 `pnpm verify` / e2e
- 与未提交 `chat-ux-polish` 改动的联调手测

## 说明

工作区仍含 `07-24-chat-ux-polish` 未提交改动；本任务仅动补丁面板相关路径，提交时应分开 stage。
