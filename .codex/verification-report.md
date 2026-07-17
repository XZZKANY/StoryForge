# 验证报告 · 世界线观测镜刀2：前端接线（保存即重扫 + ObsPanel 接真）

时间：2026-07-17
分支：`feat/observatory-frontend-20260717`
前置：刀1 信号出口已合并（PR #147，observatory.scan IDE 命令 + observations.json 派生缓存）。

## 问题

`ObsPanel.tsx` / `StatusBar` 的观测外壳与 availability 三态早已建好，但 `App.tsx` 数据源
硬编码空数组、availability 恒为 unavailable（「观测未接线」）。刀1 的信号出口就绪后，
本刀把数据接进来并补上「点击行定位原文」的既有承诺文案。

## 变更

### 纯逻辑（新增 `src/lib/observations.ts`）

- `mapObservatoryPayload(raw, resolvedIds)`：后端 observatory payload → ObsPanel
  Observation[]（防御性解析：缺 id / severity 未归一化的条目跳过；checkers 同滤）；
  已处理态按稳定 id 跨扫描保留。
- `resolveAnchorLine(content, anchor)`：行号界内直用 → snippet 整串匹配 → **拆词降级**
  （套话类 snippet 是命中词拼接如「不禁、五味杂陈」，非原文子串，按「、,;/空白」拆）→
  全失败返回 null（调用方明示锚点失效，不静默落空）。

### 重扫触发（新增 `src/components/app/useObservatory.ts`）

- 打开项目即首扫；`FS_MUTATION_EVENT`（TauriFileSystem 各写操作 finally 广播）后 1200ms
  防抖重扫——确定性纯函数无 LLM，保存即刷新零成本。
- availability 诚实语义：首扫 loading / 首扫失败 error；已有数据后刷新失败**保持 available**
  （旧观测仍真实，不藏）；切项目清空观测与已处理记忆并使在途响应过期（scanSeq 守卫，
  同 F26 会话切换纪律）。

### 接线与定位

- `App.tsx`：useObservatory 替换硬编码空态；`locateObservation` 拼项目内绝对路径（沿用项目
  串分隔符风格保证与页签路径可比）、非当前文件先 openFile、广播 `LOCATE_IN_EDITOR_EVENT`。
- `Editor.tsx`：监听定位事件——目标文件已就绪立即 `setPosition`+`revealLineInCenter`（monaco
  stub 无此 API，均 typeof 守卫）；未就绪挂起，`loadedFilePath` 到位后消费；锚点失效走
  suggestionStatus 提示条。
- `ObsPanel.tsx`：Observation 加结构化 `anchor` 字段（location 仍是显示串，渲染零改动）；
  行主体带 anchor 且有 onLocate 时可点击。
- `AppShell.tsx`：补传 availability 给 ObsPanel/StatusBar（此前漏传导致恒 unavailable）+
  透传 onLocate。

## 验证

- vitest 全量 `48 files / 259 passed`（新增 13 例）：
  - `observations.test.ts`（7）：映射/非法条目跳过/resolved 保留/checker 过滤/行号/snippet/
    拆词降级/失效 null；
  - `observatory-rescan.test.tsx`（5）：打开项目即首扫、fs-mutation 防抖合并、首扫失败 error
    /刷新失败保持 available、resolved 跨扫描保留、切项目清空；
  - `obs-locate.test.tsx`（1）：带 anchor 行点击回调、无 anchor 行不可点。
- typecheck 绿；`pnpm lint` 0 errors（仅 Editor.tsx 既有 exhaustive-deps warning）+
  prettier 绿。
- react-hooks 新规则收编：hook 状态合一（observations/checkers/availability 单 state 原子
  更新）消 set-state-in-effect 级联；runScan 闭包捕获 activeProject 消渲染期写 ref。

## 红线审计

- 前端不写任何项目文件：重扫走后端 IDE 命令（只写派生缓存）；本刀纯读+UI。
- 观测是参考信号：ObsPanel 文案与 availability 三态不夸大（未接线/加载中/失败/空态分明）。
- 暂存全部使用显式路径（10 文件 + 本报告）。

## 未验证项

- 真机观感（底部面板升起、定位跳转手感、状态栏芯片）照旧归 E2E-1；happy-dom 测不到
  Monaco 真实 reveal 行为。
- 观测镜右栏视图（实体卡/伏笔卡/提案卡/检查器）是刀3（PR-C）。
