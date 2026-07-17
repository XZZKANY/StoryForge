# 验证报告 · 世界线观测镜刀4：光标行实体联动

时间：2026-07-17
分支：`feat/observatory-entity-linkage-20260717`
前置：刀1-3 已合并（PR #147/#148/#149）。本刀是 v3 原型定稿的最后一块交互。

## 问题

原型定稿的「写到谁，谁亮起」缺失：编辑器光标落在提到 canon 实体的行时，
观测镜对应实体卡应亮紫描边；观测镜没开时对话头雷达图标应出现小紫点提示。

## 变更

### 事件桥 + Editor 侧（`assistant-events.ts` + `Editor.tsx`）

- 新增 `EDITOR_CURSOR_LINE_EVENT`：光标行变化去抖 180ms 后广播
  `{filePath, lineText}`（只发行文本，不做任何判定）。
- Editor 挂 `onDidChangeCursorPosition`（monaco stub 无光标 API，
  onDidChangeCursorPosition / getLineContent / getLineCount 全 typeof 守卫），
  editorReady 后注册、卸载时 dispose + 清 timer。

### 匹配纯逻辑 + 状态（`observations.ts` + `useObservatory.ts`）

- `matchEntityIdsInLine(entities, lineText)`：按实体表面形（canonical_name +
  aliases）做包含匹配；**单字符表面形跳过**（中文单字包含匹配噪声过大）；
  纯注意力提示，不是业务结论。
- `useObservatory` 增 `litEntityIds`：监听光标行事件按当前实体台账匹配，
  数组不变时保持引用（光标高频移动不触发无谓重渲染）；切项目清空；
  无项目 / 无实体台账时不挂监听。

### 呈现（`ObservatoryView.tsx` + `panels.tsx` + `AppShell.tsx`）

- 实体卡 `data-lit` + 紫描边（`border-agent/70`）；**描边优先级：blocking 红 >
  advisory 黄 > 联动紫**——联动只是注意力提示，让位于真信号。
- 对话头雷达按钮小紫点 `observatoryAttention`（AppShell 传
  `litEntityIds.length > 0`；仅对话视图下有意义，观测镜打开时卡片本身在亮）。
- 线程沿用刀3b 的 ChatWindowProps → ChatWindowView → ConversationHeader 通道。

## 验证

- vitest 全量 `51 files / 277 passed`（新增 5 例）：
  - `observations.test.ts` +1：canonical / 别名命中、单字符跳过、无关行与空行不亮；
  - `observatory-linkage.test.tsx` +4：光标行事件亮卡换行熄灭、切项目清空、
    实体卡紫描边让位冲突红（data-conflict 与 data-lit 并存断言 className）、
    雷达小紫点只在 attention 时渲染。
- typecheck 绿；`pnpm lint` 0 errors（仅 Editor.tsx 既有 exhaustive-deps warning）+
  prettier 绿。

## 红线审计

- 联动纯前端确定性零成本：不触发扫描、不写盘、不走 LLM；匹配结果只做视觉
  注意力提示，不产生任何观测 / 结论。
- 暂存全部使用显式路径（9 文件 + 本报告）。

## 未验证项

- 真机观感（光标移动亮卡的跟手感、去抖节奏、紫描边对比度）归 E2E-1 定向波；
  happy-dom 测不到 monaco 真实光标事件（Editor 侧发射逻辑未单测，靠 typeof
  守卫 + 真机验证）。
- 提案「并入 canon」前端确认写回仍是后续刀（观测镜系列至此只剩这一块）。
