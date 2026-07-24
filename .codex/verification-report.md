# 验证报告 · UI/UX 审计设置页（保存态复位 · 搜索空态）

时间：2026-07-24
分支：`feat/uiux-settings-20260724`

审计「导航 · 观测 · 设置」主题里设置页的两条 P2（承 nav PR 拆分）。

## 变更（全前端）

- **N-savestate 保存反馈挤在「运行时真相源」行且永不复位 → 归位 + 自清**：
  - `ProviderRuntimeEnvNotice` 恒显 env 源「桌面注入」（不再随 saveState 变「已保存」并永久停留）；
  - `ActionRow` 加可选 `status` 槽，保存成功/失败反馈落到「应用到本机后端」操作行右侧；
  - 新增 useEffect：saveState 进 `saved` 后 2.5s 自动回 `idle`，反馈不长驻。
- **N-settingssearch 搜索只隐藏行、留空标题/空卡壳、无「无结果」 → CSS 空态联动**：
  给 `SettingGroup`/`SettingCard` 挂 `sf-settings-group`/`sf-settings-card` 类，过滤后卡片内所有行 `null` 渲染即
  `:empty` → 卡片 + 整组（含标题）CSS 隐藏；列表里没有非空卡片时露出「未找到匹配的设置」。纯 CSS
  （`:empty` + `:has`），与 RowShell 逐行过滤天然一致、覆盖全部行类型（含 ProbeRow/关于区等内部标题行），无 JS 计数。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 273 passed（+1 新：真相源恒显 + 空态结构就位）
npm --prefix apps/desktop/frontend run build       # 构建成功（:empty/:has CSS 过 PostCSS 无碍）
npx eslint SettingsView.tsx + test                 # 0 problems
npx prettier --check <touched incl. index.css>     # 通过（SettingsView 已 --write）
```

空态隐藏/横幅由 `:has`/`:empty` 在真实 WebView 生效（happy-dom 不算 CSS，测试只锁结构类 + 横幅存在）；
真机搜索过滤/保存反馈观感归 E2E-1 未验。
