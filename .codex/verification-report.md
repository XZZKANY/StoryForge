# 验证报告 · UI/UX 审计文案术语

时间：2026-07-24
分支：`feat/uiux-copy-20260724`

审计「文案 · 术语」剩余可落地项（观测措辞「尚未启用」、Issue Scope→问题范围、暂停/固定术语等已在 #161/#165 收口，本刀补齐余下）。

## 变更（全前端）

- **C-newstart「新的开始」含义模糊且行为=打开项目 → 删冗余入口**：`handleStartNewBook` 实为 `showEditor + openProject`，
  与上方「打开项目…」同动作，紫火花图标又假意「AI 开新书」。删掉该按钮 + 全链 prop（SidePanel/AppShell/useProjectCommands），
  空态提示去掉「说一句话开新书」的空头承诺（此surface无输入）→「打开一个本地文件夹，开始你的创作。」
- **C-pause 恢复诊断黑话 → 说人话**：`resumed-result.ts`/`useAgentRunRecovery.ts`/`recovery.ts` 的
  「恢复 AgentRun」「resume_run 已返回 X」「AgentRun 尚未进入 resumed 状态」「pending call 记录无效/已就绪」
  全改中文可读措辞（恢复本轮 / 已从暂停处恢复继续 / 本轮还没能恢复继续 / 待恢复的现场…），不再透传内部标识符。
- **C-panelright 回到编辑图标语义反 → PanelLeft**：对话聚焦态「回到编辑 · Ctrl+2」图标 `PanelRight`（高亮右面板）
  改 `PanelLeft`（暗示露出左侧编辑区），icon barrel 补 `PanelLeft` 导出。
- **快捷键速查（token+copy 合并）**：`AppDialog.alert` 加 `mono?` 变体，正文用等宽字体使空格对齐两列不再错位；
  `showShortcuts` 改 padEnd 对齐 + 补活动栏承诺的 `Ctrl Shift E` + 面板名统一「资源管理器」。

已核对已完成项：观测措辞（尽未启用）、Issue Scope（问题范围）、暂停 tooltip（暂停本轮）、固定术语均此前已收口，无重复改动。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 272 passed（零回归）
npx eslint <10 touched>                            # 0 problems
npx prettier --check <touched>                     # 通过
```

同批更新 `chat-window.test.ts` 两条恢复诊断断言。真机图标/速查观感归 E2E-1。
