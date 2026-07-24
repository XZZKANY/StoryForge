# 验证报告 · UI/UX 审计可达性（键盘 / 读屏欠账）

时间：2026-07-24
依据：UI/UX 审计「可达性 · 键盘」主题
分支：`feat/uiux-a11y-20260724`

本刀 = 补键盘 / 读屏欠账。纯前端展示 / 交互层，无后端 / OpenAPI / schema 改动。
（全局 `:focus-visible` 描边已随速赢包 PR #161 落地，本刀不重复。）

## 变更（对应审计条目）

- **确认 / 提示弹窗键盘可用**（AppDialog）：打开时把焦点送进弹窗（prompt 聚焦输入框、其余聚焦
  主按钮 → 原生 Enter/Space 即确认）；`<section>` 加 Tab 焦点陷阱（在弹窗内环绕，不外逃背景）。
  Esc 关闭本已挂 window。
- **命令面板成真对话框**（CommandPalette）：inner 容器加 `role="dialog" aria-modal aria-label`；
  Esc 提到 window keydown（焦点落在列表项也能关）；Tab 焦点陷阱（收回输入框，不穿到背景编辑器）；
  方向键选中项 `scrollIntoView({block:'nearest'})`（长列表往下选不出屏）。
- **编辑器页签键盘可选可关**（EditorTabs）：外层 `role="tablist"`；页签 roving `tabIndex`（激活项 0、
  其余 -1）+ `onKeyDown`（Enter/Space 激活、←/→ 切换并激活）；补 Ctrl+W 关活动文件页签（页签聚焦时）。
- **观测面板点行定位键盘够得到**（ObsPanel）：可定位行主体从裸 `<span onClick>` 加
  `role="button" tabIndex onKeyDown`（Enter/Space 定位）+ 行级 hover 反馈；hover 才实体化的「标记已处理」
  钮补 `focus-visible:opacity-100`（键盘聚焦时可见）。
- **自定义下拉可关且被读屏识别**（panels / SidePanel / EditorTabs）：抽 `useDismissableMenu`——
  打开挂 window Esc → 关闭并把焦点还给触发钮；三处触发钮补 `aria-haspopup="menu"` / `aria-expanded`。
- **设置开关有可访问名称**（SettingsView）：ToggleRow 按钮补 `aria-label={title}`（此前读屏只报「按钮，已按下」）。
- **瞬时反馈进 live region**（ToastHost）：容器 `role="status" aria-live="polite"`，error 项 `role="alert"`
  （断言播报），报错 / 「已写回」/「等待确认」不再对读屏全程静默。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 269 passed（零回归）
npx eslint <changed>                                # 0 errors
npx prettier --check <changed>                      # 全过
```

## 边界 / 未验证

- a11y 的**结构属性**（role/aria-*/tabIndex）由 typecheck + lint + 零回归护住；**行为**
  （实际键盘焦点走向、Esc/Tab 陷阱、读屏播报、scrollIntoView）本质需真浏览器 / AT 验证 → 归 E2E-1 真机波。
- CommandPalette / AppDialog Tab 陷阱为简化实现（面板靠 ↑↓ 导航，Tab 收回主控件 / 环绕），非完整
  WAI-ARIA aria-activedescendant 方案。
- EditorTabs Ctrl+W 限页签聚焦时生效（焦点在 Monaco 内不触发，避免与全局 / Tauri 窗口关闭冲突）。
