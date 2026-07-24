# 验证报告 · UI/UX 审计主链修复（写 → 改 → 审 → 收 闭环漏水）

时间：2026-07-24
依据：UI/UX 审计「主链闭环」主题（1 P1 + 4 P2 + 1 P3）
分支：`feat/uiux-mainchain-20260724`

本刀 = 修最伤日更的一条主链——对话里让 agent 改稿 → 产出补丁 → 审阅 → 接受写回，
在布局 / 状态 / 反馈三处同时漏水。纯前端展示 / 交互层，无后端 / OpenAPI / schema 改动。

## 变更（对应审计条目）

- **P1 · 对话聚焦态补丁面板不可见**（AppShell / useShellState / App / useProjectCommands）：
  `chat` 布局隐藏中栏，补丁面板挂在里面看不见。useShellState 新增 `showCenter`（chat→balanced）；
  补丁到达（`onSuggestion`，在「已是当前文件」早返回**之前**）、定位观测原文（`locateAnchor`）、
  选中文件（`showEditor`）都确保中栏可见。
- **P2 · 补丁待确认时对话侧仍显示破坏性「停止」**（panels.tsx RunActionBar）：`status==='waiting'`
  且非权限 = run 已产出、等你在编辑器确认 diff；此时「停止」会误标 failed 却不清补丁。改为只给
  「在编辑器里确认修订」提示、不渲染停止键（放弃走编辑器里拒绝）；停止键仅循环进行中 / 等权限时给。
- **P2 · 预览文件时 agent 目标脱钩**（AppShell）：ChatWindow 的 `currentFile` 从固定文件改吃
  `tabs.displayedFile`（预览感知），agent 改「这段」落在屏幕上那份而非上一份固定文件。
- **P2 · 审补丁切文件补丁被静默清除**（assistant-events / useSuggestionWriteback）：新增
  `bufferPendingFileSuggestion`（只回填单槽不派发）；`resetSuggestionWriteback` 切走时把未确认补丁
  回填缓冲，切回同一文件由既有 `adoptPendingSuggestion` 重新领取，不再翻别章核对就丢补丁。
- **P2 · 待确认期间发新消息静默顶掉待确认轮**（ChatWindowView）：补丁 / 权限待确认时 agentBusy 已置
  false、输入框可用；`submitGuarded` 在 `status==='waiting'` 时提示「先处理待确认的修订」并不发送。
- **P3 · 写回快照安全网不可见**（useSuggestionWriteback）：接受成功文案点出「已留写前快照，可在
  『…』菜单的版本历史撤销」，让作者知道安全网存在与撤销去处。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS
npm --prefix apps/desktop/frontend run test        # 52 files / 269 passed
npx eslint <changed>                                # 0 errors（仅 Editor.tsx 既有 handleExport warning）
npx prettier --check <changed>                      # 全过
```

新增可证伪测试：
- RunActionBar 待确认态（waiting 无权限步）→ 「在编辑器里确认修订」、无 `run-stop`（P2）。
- `bufferPendingFileSuggestion` 回填后同一文件可重新领取（P2c）。

## 边界 / 未验证

- P3 只补了文案（安全网可见）；就近「撤销」动作按钮留后续（现走「…」菜单版本历史）。
- 真机 Tauri 下补丁自动露出、预览改稿落点、切文件补丁保留、待确认拦发送、快照撤销 —— 归 E2E-1 真机波。
- P2c 单槽缓冲 = 一次一份未确认补丁（与「一次对话最多一个待确认补丁」一致）。
