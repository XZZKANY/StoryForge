# 验证报告 · UI/UX 审计运行状态机（R7-R12）

时间：2026-07-24
分支：`feat/uiux-runstate-20260724`

承 UI/UX 审计其余 P3/P2 收尾波，本刀收口「运行状态机：暂停 / 停止 / 等待」主题 6 条（1 组近重复合并）。

## 变更（全前端，后端零改）

- **R8 暂停死胡同 →「暂停」有恢复出口**：新增 `AgentRunStatus` 加 `'paused'` 态。
  `pause_run` 控制回执从落 `'waiting'` 改落 `'paused'`（`useAgentRunControls.ts` + `useAgentStreamEvent.ts` 两处派发点同步）；
  `RunActionBar` 暂停态渲染「恢复」主 CTA（`run-resume` → `onResumeRun`）并保留「停止」。
- **R9 作者停止被当失败 → 中性收尾**：新增 `'stopped'` 态；`stop_run` 从落 `'failed'` 改落 `'stopped'`
  （两处派发点），`runStatusText` 出「已由你停止本轮。」（不再套用「遇到问题…详情在回复里」的失败措辞、也不给重试）。
  `permission_denied` 仍是真失败，保持 `'failed'`。
- **R7 + R11 三层同义进度信号 → 状态条互斥**：`ChatWindowView` 计算 `actionBarVisible`（running/waiting/paused），
  RunActionBar 可见时隐藏 `LightweightStatus`（RunActionBar 已自带状态文案）；`completed` 的「本轮已完成。」不再长驻
  （完成已在回复里），只 `failed`/`stopped` 保留轻状态条收尾。
- **R10 跨章检查不置忙 / 可并发**：`useChatSubmission.runCrossChapterConsistency` 起手 `setAgentBusy(true)`、
  `finally` 复位，禁用 composer 并让既有 `agentBusy` 守卫真正拦住并发再提交。
- **R12 流式期禁编辑 → 可预写**：Composer textarea `disabled` 去掉 `|| busy`（保持可编辑边等边预写），
  Enter 守卫加 `if (disabled || busy) return`（流式期 Enter 不发送、底排仍是暂停键）。

类型 union 从 4 处内联字面量收敛到 `types.ts` 的 `AgentRunStatus`（`useAgentRunControls` / `useRunAuthorAgent` 签名引用）。

## 验证

```bash
npm --prefix apps/desktop/frontend run typecheck   # PASS（union 传播零报错）
npm --prefix apps/desktop/frontend run test        # 52 files / 271 passed（+2 新：暂停恢复 / 停止中性文案）
npx eslint <10 touched files>                      # 0 problems（含 warning）
npx prettier --check <touched>                     # 通过（ChatWindowView 已 --write）
```

真机桌面观感（点暂停出恢复键、点停止中性收尾、流式期预写、跨章置忙）归 E2E-1 未验。
