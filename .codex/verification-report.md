# 验证报告 · UI/UX 审计设计 token 一致性

时间：2026-07-24
分支：`feat/uiux-tokens-20260724`

审计「设计 token 一致性」主题 6 条（速查表 grid 归文案 PR 一并做）。

## 变更（全前端）

- **T39 审稿 issue 严重度硬编码三份 → 单一事实源**：新增 `--issue-high/-medium/-low`（两主题，对齐语义色板：
  高=error / 中=warning / 低=agent-iris，退掉 token 里不存在的孤立天蓝）；`index.css` 下划线/圆点与
  `decorations.ts` overviewRuler 同取（后者 `getComputedStyle` 读当前主题三元 RGB + 深色字面量兜底），
  不再各写一份 hex。
- **T-agent-foreground 缺 token → 补齐**：新增 `--agent-foreground`（两主题近白）+ Tailwind `agent-foreground`；
  发送键 / 暂停键 / 欢迎页发送 / Ctrl+K 接受键的硬写 `text-white`·`#fff` 全改引用，与 accent-foreground 对称。
- **T-shadow 投影硬编码纯黑、弹窗层自分裂 → 两档 token**：新增 `--shadow-dropdown` / `--shadow-dialog`
  （浅色降 alpha 到 0.14/0.22，不再照搬深色纯黑）；下拉/卡片（会话/侧栏/页签溢出/ToastHost/@浮层/Ctrl+K 面板）
  统一 `--shadow-dropdown`，弹窗（AppDialog/命令面板/版本记录，此前 shadow-2xl 与 0.55 黑三套）统一 `--shadow-dialog`。
- **T-toast 两套 toast 皮 → 收敛**：`.sf-inline-toast`（Ctrl+K 胶囊 999px/panel 底）改 surface 底 + rounded-lg + 下拉档投影，
  与全站 ToastHost 卡片同视觉基。
- **T-mention @提及浮层偏离下拉配方 → 对齐**：`bg-panel`/`rounded-md`/一次性投影 改 `bg-surface`/`rounded-lg`/`--shadow-dropdown`。
- **T-control-height 架空死 token → 删除**：`--sf-control-height` 仅 2 个 css 类消费、零 TSX、70+ 处各写死高度；
  按审计「删死码」路径内联 28px 进 `.sf-toolbar-button`/`.sf-icon-button` 并删 token，去掉「有系统实则没有」的假象
  （控件高度全站走 Tailwind h-* 工具类；不做 70 处盲扫，避免无 GUI 可验的高风险 churn）。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 272 passed（零回归）
npm --prefix apps/desktop/frontend run build       # 构建成功（验证 Tailwind arbitrary shadow-var + agent-foreground 编译）
npx eslint <11 touched>                            # 0 problems
npx prettier --check <touched incl. index.css>     # 通过
```

真机明暗双主题下的投影轻重 / issue 色 / 紫底前景观感归 E2E-1 未验。
