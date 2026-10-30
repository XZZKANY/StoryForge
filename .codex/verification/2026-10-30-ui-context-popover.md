## 2026-10-30 对话头「上下文」改成按钮下方的小浮窗

- 改动：作者嫌点「上下文」后在对话头和消息之间撑开一整条横带难看（左边标题、右边按钮隔得老远）。改成按钮右下方、右对齐的小浮窗（22rem 宽，与会话下拉同一套边框 / 阴影 / 圆角），盖在对话上、不挤消息；再点按钮、点外面或按 Esc 收起。开合状态从 `ChatWindowView` 挪进 `ContextPanelToggle`；内容三块之间加分隔线，每块标题下另起一行放灰色说明（原先说明和标题挤一行，窄框里会把「长期规矩」挤成两行）。内容与行为（读长期规矩、技能列表、这一轮读了、新建技能模板菜单）不变。
- 验证：
  - `pnpm verify`（corepack 的 pnpm 9.15.4 临时 shim）EXIT=0：lint（0 error，2 条 warning 在 `tests/independent-claim-history.test.ts`，原有）、前端类型检查、project-core 14 passed、引擎 14013 passed / 2 skipped、前端 250 文件 2523 passed、行间续写 / 浏览器冒烟 / Agent 对话三个浏览器回归通过。
  - `tests/context-panel-view.test.tsx` 第一条改为：浮窗不在对话 DOM 里（挂 body 的浮层）、`aria-controls` 指向浮窗、再点 / 外部 pointerdown / Esc 三种方式都收起。变异：把浮窗的 `onDismiss` 换成空函数，这条红（1 failed / 14 passed），已按字节还原。
  - 截图：浏览器回归同一套 fetch 替身 + 假文件系统，长期规矩与技能换成固定数据，1400×759 深色，浮窗落在 x=968 y=76、352×345，挂在按钮下方右对齐。脚本与截图在 `output/context-popover/`（不入库）。
- 未覆盖：没在真宿主 / 装机版里点过；浅色主题没截（主题存应用设置，脚本没切过去，用的是和会话下拉同一套 token）；「这一轮读了」有内容时的样子只在单测里验了，没截图。
