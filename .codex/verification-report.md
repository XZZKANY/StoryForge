# 验证报告 · UI/UX 审计编辑器反馈打磨（diff 字体 · issue 自清 · pin ✕）

时间：2026-07-24
分支：`feat/uiux-editor-feedback-20260724`

审计「编辑器与改稿反馈」主题里三条打磨（E14 分支画布 / E16 Ctrl+K 取消 / E15 结果 toast 化另拆交互刀）。

## 变更（全前端）

- **E17 Ctrl+K 行间 diff 绿新行用拉丁等宽、与红旧行 CJK 正文错位 → 跟随编辑器字体**：
  `renderDiff` 读 `editor.getOption(fontInfo).fontFamily`（编辑器实际解析出的 CJK 2:1 栈）传入 `buildDiffZoneDom`，
  内联设到 `.sf-inline-diff-zone`，覆盖 CSS 的 `var(--font-mono)`；绿新行与红旧行同字体栈，比对「改了哪个字」不再错位。
- **E18 审稿 issue 标记改掉问题文字后仍残留（直到重审 / 切文件）→ 内容变化去抖自清**：
  留存当前 issue 到 `reviewIssuesRef`，编辑器 `onDidChangeModelContent` 去抖 400ms 重跑 `applyIssueDecorations`——
  `locateEvidence` 失配（问题文字已改）的 issue 被跳过即消失，命中的重锚；切文件清留存避免误标进新文件。
- **E21 Composer 常驻 pin 的「✕」只 hover 才现、标签本体不可点，与摘要面板不一致 → 常显**：
  取消固定「✕」从 `hidden group-hover/pin:inline-flex` 改常显 `inline-flex`（焦点/键盘也可达），不必精确悬停。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 273 passed（零回归）
npm --prefix apps/desktop/frontend run build       # 构建成功
npx eslint <3 touched>                             # 0 error（仅既有 Editor.tsx handleExport warning）
npx prettier --check <touched incl. index.css>     # 通过
```

真机 Ctrl+K diff 字体 / 改字后标记消退 / pin ✕ 观感归 E2E-1 未验。
