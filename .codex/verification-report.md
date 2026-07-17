# 验证报告 · 世界线观测镜刀3b：右栏观测镜视图

时间：2026-07-17
分支：`feat/observatory-structured-20260717`（同分支承刀3a 结构化出口，合并为观测镜刀3 一个 PR）
前置：刀1 信号出口（PR #147）+ 刀2 前端接线（PR #148）已合并；刀3a payload v2 见上一提交验证记录。

## 问题

观测数据只有底部 Problems 式清单（刀2），原型定稿的右栏「世界线观测镜」视图
（待确认提案 / 伏笔账 / 实体卡 / 检查器四分区）没有实现；右栏也没有第二视图机制。

## 变更

### 右栏双视图机制（`useShellState` + `AppShell`）

- `rightView: 'chat' | 'observatory'`：Ctrl+4 / 对话头雷达图标 `toggleObservatory`——
  右栏隐藏（editor 布局）时先展开并直落观测镜，可见时在对话↔观测镜间往返；
  观测镜头部 Sparkles 按钮 `showChatView` 回对话。
- **两视图 CSS 互斥不卸载**（S14 纪律）：对话在途 run 状态不能因切观测镜丢失；
  AppShell 双 pane `hidden` 切换，ChatWindow 始终挂载。
- 雷达按钮线程：`ChatWindowProps.onOpenObservatory` → ChatWindowView →
  ConversationHeader（可选 prop，不传不渲染）。

### 观测镜视图（新 `components/shell/ObservatoryView.tsx`）

- 四个可折叠分区：**待确认提案**（available=False 诚实空态「暂无提案草稿」；有提案
  渲染新实体 / 新声明卡，明示「并入 / 忽略操作后续接入；canon.json 未被改动」——
  本刀只读不放假按钮）；**伏笔账**（当前章 + 三态卡：已埋设 agent 紫点 / 推进中 /
  已回收绿勾，overdue issue 亮 warning 描边，issue message 逐条列出）；**实体**
  （dossier 卡：别名 / 出场跨度 / 持有 / 生命期，related 未处理 error 观测亮红描边、
  warning 亮黄——**结论只跟后端观测走，勾选已处理即熄灭**；related 观测行与
  provenance 行可点定位）；**检查器**（7 行，ran=确定性·保存时 + 计数，
  deep_consistency 标 LLM·按需）。
- 头部 h-shell-row（纳入 PR#142 行高指纹护栏，加 `observatory-header` 断言）+
  重扫按钮（loading 转圈）+ 上次扫描时间；底部保留「不是质量判定」诚实脚注。
- 定位复用刀2 链路：App 抽出 `locateAnchor(anchor)` 通用入口（provenance 行用），
  `locateObservation` 变薄壳；AppShell 观测 4 散 props 收敛成 `observatory` 句柄。

### 纯逻辑与状态（`observations.ts` + `useObservatory.ts`）

- mapper 增 `mapEntities / mapPromises / mapProposals`（防御性：缺 id 跳过、坏类型落
  空 / null；v1 payload 无结构化段时落诚实空台账不炸）；hook 状态与返回值扩三段 +
  generatedAt，切项目随 EMPTY_STATE 整体清空。

## 验证

- vitest 全量 `50 files / 272 passed`（新增 13 例）：
  - `observations.test.ts` +2：v2 结构化映射（实体 / 伏笔 / 提案 camelCase + 防御跳过）、
    v1 payload 落诚实空台账；
  - `observatory-view.test.tsx` +7：四分区渲染与提案诚实空态、实体卡冲突描边只随
    后端 blocking 观测、已勾选处理描边熄灭、伏笔三态 overdue 标记、provenance 点行
    回锚点 + related 观测回调、提案卡渲染 + 重扫回调、非 available 态不渲染台账；
  - `shell-right-view.test.tsx` +3：右栏隐藏直落观测镜、可见时往返切换、回对话；
  - `shell-row-height.test.ts` +1：observatory-header 纳入行高指纹护栏。
- typecheck 绿；`pnpm lint` 0 errors（仅 Editor.tsx 既有 exhaustive-deps warning）+
  prettier 绿。

## 红线审计

- 前端零写盘：视图纯读 + 重扫走既有 IDE 命令（只写派生缓存）；提案区无任何写回操作。
- 前端不自算业务结论：冲突描边 / 伏笔 issue / 提案差集全部来自后端 payload，
  视图只做映射与呈现；「不是质量判定」脚注保留。
- 暂存全部使用显式路径（15 文件 + 本报告）。

## 未验证项

- 真机观感（Ctrl+4 切换手感、卡片密度、明暗双主题下的描边对比度）归 E2E-1 定向波。
- 光标行实体联动（写到谁谁亮起 + 雷达小紫点）是刀4；提案「并入 canon」前端确认
  写回是后续刀。
- happy-dom 测不到 Monaco 真实 reveal 与折叠动画。
