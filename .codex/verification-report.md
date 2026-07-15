# 验证报告 · 壳子三栏头部行高统一 shell-row token

时间：2026-07-15
分支：`fix/shell-row-height-token-20260715`

## 问题

真机截图发现中栏页签行与右栏对话头 4px 断层（`border-b` 横线在中/右分界断开）。
git 考古：右栏对话头自建档起 `h-10`（40px），中栏页签行自壳子 redesign 起 `h-9`（36px，当时对齐顶栏），
左栏侧面板顶行 `h-10`——三栏里中栏是唯一 36px，此缝从未修过（九问修的是气泡/会话移位等别处对齐）。
根因：壳子行高是散落各组件的魔法值，无单一事实源、无护栏，对齐是 N 个硬编码值恰好相等的涌现性质。

## 变更

1. **单一事实源**：`tailwind.config.js` theme.extend.spacing 新增 `'shell-row': '2.5rem'`（40px），
   派生 `h-shell-row` / `top-shell-row`。
2. **三栏头部行统一引用 token**：
   - `shell/EditorTabs.tsx` 页签行 `h-9` → `h-shell-row`（36→40px，本次唯一视觉变化）；
   - `chat-window/panels.tsx` ConversationHeader `h-10` → `h-shell-row`，会话下拉 `top-10` → `top-shell-row`，补 `data-testid="conversation-header"`；
   - `shell/SidePanel.tsx` 顶行 `h-10` → `h-shell-row`，项目下拉 `top-10` → `top-shell-row`，补 `data-testid="side-panel-header"`。
   顶栏 Titlebar 独立横贯一行，保持 `h-9` 不入 token。
3. **可证伪指纹护栏**：新增 `tests/shell-row-height.test.ts`（4 条）——token 在 tailwind 只定义一次；
   三个头部元素（按 data-testid 抓 JSX 开标签）必须含 `h-shell-row` 且不得写死 `h-9`/`h-10`。

## 验证

- `npm --prefix apps/desktop/frontend run test`：43 files / 230 tests 全绿（含新增 4 条护栏）。
- `npm --prefix apps/desktop/frontend run typecheck`：干净。
- `pnpm.cmd lint`：0 errors（Editor.tsx exhaustive-deps 1 warning 为存量）；prettier 全过。
- 零后端 / 契约变更，OpenAPI 不受影响。

## 未联通能力

- 真机 GUI 观感（40px 对齐后的实际视觉）未验，归 E2E-1 第二轮观感波顺带 eyeball。
