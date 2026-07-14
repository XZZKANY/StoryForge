# 验证报告 · 番茄 API 直连 phase2（对账 + 批量发章）

时间：2026-07-14  
分支：`feat/publish-fanqie-api-phase2`

## 范围

在已落地的 API 直连 phase1（登录 webview / 读端点 / 单章发布）之上，做两块：

- **对账（reconcile）**：拉某号线上 book_list ↔ library 匹配（onlineBookId 优先，其次归一书名），写线上快照（章/字/审核态）回匹配书；暴露「线上多出」「本地标已开但线上查无」；台账已开 vs 线上本数并排展示。
- **批量发章（batch）**：复用现有单章发布流程顺序驱动——线上已发标题去重（防 -3010）、字数下限跳过（<1000）、两章间隔节流（防 -3009，`batchPublishIntervalSec` 默认 45s）、可中途停止。

## 诚实边界（关键）

- 番茄 book_list **不带可靠开书日期**，故对账**不**推算「本月已开」月账、**不**自动改配额；只写本地快照 + 暴露差异，配额仍用账号行「校准已开」手动定。未编造月份计数（守「不造假兜底」红线）。
- 批量发章**不新增 Rust 代码路径**：复用现有 `publish_fanqie_chapter` 命令，前端 `publishChapterOnce` 一次性等回执 + 顺序循环 + 节流。无代登/无打码/无反检测（L4/L3-c 未触碰）。
- 线上章节列表字段随平台版本浮动：`fetchChapterList` 尽力投影 title，拿不到即不去重（非致命），不伪造。

## 落点

- 纯函数：`model/reconcile.ts`、`model/batch-publish.ts`（+ `model/types.ts` 扩 `PublishBook.onlineBookId/onlineSnapshot`、`PublishSettings.batchPublishIntervalSec`）。
- storage：`publish-api.ts` 加 `fetchChapterList` / `publishChapterOnce`；`publish-repository.ts` normalize 补新字段 + settings 加载合并默认（旧文件缺字段回退）。
- hook：`usePublishCockpit` 加 `onlineBooksByAccount`（`onlineBooks` 改派生）、`reconcile*` / `bindOnlineBook` / `importOnlineBook` / `startBatchPublish` / `stopBatch`。
- 视图：`tabs.tsx` 账号页加「对账」按钮 + ReconcilePanel + BatchPublishPanel。

## 验证

```text
npm --prefix apps/desktop/frontend run typecheck                       # pass
npm --prefix apps/desktop/frontend run test                           # 40 files / 213 passed（含新 publish-reconcile 6 + publish-batch 2 = 9 新用例）
npx eslint apps/desktop/frontend/src/features/publish tests/publish-*  # clean
npx prettier --check <本刀新增/编辑的文件>                              # 新文件与 hook 全 clean
```

## 未验证 / 已知

- **真机 Tauri + 真实番茄 Cookie 的 reconcile/batch 端到端**：归 E2E-1 真机轨（webview fetch 发布、频控节流实测、chapter_list 字段真形状）。单元测试只覆盖纯函数计划/对账，不含 IO 编排真跑。
- **pre-existing 格式债**：publish 目录多个**本刀未改**的文件（auto-assign/quota/survival/status-machine/ui/tabs 等）在 master(`bfcca450`) 即未过 `prettier --check`；本刀不做无关格式化（守「禁止顺手重构无关代码」），仅保证新增/编辑文件自身 prettier-clean。

---

# 验证报告 · 发行 UI/UX 中低优先打磨

时间：2026-07-13

## 范围

中优先 + 低优先（不含高优先：会话健康条 / Agent 桥 / 搜索占位）

## 改动摘要

- Stats 默认一行摘要，可展开四格（`CapacitySummary`）
- 文案：Ready→可开分、spare→余量、API 开书→平台开书
- 确认已开：confirm 摘要 + flash 额度前后
- Flash：失败 8s + 可关闭；语义色 `error/success/warning` token
- 空库 `OnboardingGuide` 三步
- 数字键 1–7 切 Tab
- demo.html 同步

## 验证

```text
npm --prefix apps/desktop/frontend run typecheck  # pass
npm --prefix apps/desktop/frontend run test -- tests/publish-*.test.ts  # 22 passed
```

## 未验证

- 真机 Tauri 观感
- 浅色主题下 token 对比人工目视
