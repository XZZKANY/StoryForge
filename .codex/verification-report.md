# 验证报告 · 修 App.tsx exhaustive-deps 警告（主链 #163 遗留）

时间：2026-07-24
分支：`chore/app-shell-dep-warnings-20260724`

主链修复 PR #163 在 `App.tsx` 的 `showEditor` / `locateAnchor` 里用 `shell.showCenter()`，
deps 写 `[shell.showCenter]`，ESLint `react-hooks/exhaustive-deps` 报「missing dependency: 'shell'」
两处 warning（当时用 `eslint >/dev/null` 检查退出码、吞了 warning 输出而漏掉；不阻塞门禁但属清洁度债）。

## 变更

- `const { showCenter } = shell;` 单独取出稳定 useCallback；`showEditor` / `locateAnchor` 改用
  `showCenter()`，deps 改 `[showCenter, ...]`。纯重构，行为不变（`showCenter` 是 useShellState 的
  稳定 useCallback）。

## 验证

```bash
npx eslint apps/desktop/frontend/src/App.tsx   # 0 problems（两 shell warning 清零）
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 269 passed
npx prettier --check apps/desktop/frontend/src/App.tsx   # 全过
```

`Editor.tsx:539` 的 `handleExport` exhaustive-deps warning 为既有（非本波），不动。
