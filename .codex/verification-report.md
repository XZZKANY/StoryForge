# 验证报告 · UI/UX 审计版本记录列表预览对比（N-version）

时间：2026-07-24
分支：`feat/uiux-version-preview-20260724`

审计「导航 · 观测 · 设置」主题里的 P3 功能项：版本记录「列表」模式只能盲恢复、恢复前看不到差异。

## 变更（全前端）

- **N-version 列表模式恢复前可「对比当前」**：
  - `VersionHistory` 新增 `getCurrentContent?: () => string` prop（`Editor` 透传 `editorRef.current.getValue()` 实时正文）；
  - 每个版本项加「对比当前」toggle：读该快照 → `buildPatchHunks(当前正文, 此版)` → 出 `+X / -Y` 概要 + 逐 hunk
    「第 N 行附近」红旧/绿新块（max-h 滚动、mono），再点收起；
  - 复用已有 `buildPatchHunks`（BranchCanvas 也用），diff 方向 before=当前→after=此版（即恢复会怎样改），
    无差异显式「与当前无差异」；恢复按钮不变，只是不再盲选。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 274 passed（editor.test 加 2 条源文本护栏：对比入口 + buildPatchHunks 对比）
npx eslint <2 touched>                             # 0 problems
npx prettier --check <2 touched>                   # 通过
```

预览是交互 + 异步 readVersion，SSR 测不到明细 → 用源文本护栏锁入口；真机对比/恢复观感归 E2E-1 未验。
