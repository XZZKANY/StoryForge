# 验证报告 · 发行车队连载健康 / 断更监控

时间：2026-07-15
分支：`feat/publish-serial-health-20260715`

## 问题

发行面板只管「开书」节奏（今日应开/逾期未开），完全不管「开了之后每天要更」——
而更新纪律正是 master-plan §8.4 更新连坐层与 L5 经营点名的存活能力，也是日更主循环最缺的信号。
`staleSerializingDays` 设置项自 Phase1 建档起存在但从未被任何逻辑使用（死设置）。

## 变更

1. **纯函数领域** `model/serial-health.ts`（新）：`parseOnlineTimestamp` 防御解析（秒/毫秒/数字串/日期串，垃圾归 null）、
   `extractLatestChapter`（跨候选字段名取最大时间；全无时间字段返回 null，不按列表顺序猜「最新」）、
   `classifySerialHealth`（ok/该更/断更/未知，`staleSerializingDays` 首次投入使用）、
   `buildSerialHealth`（断更降序 → 该更 → 未知 → 已更；未绑定/无 Cookie 出说明）、
   `stampBooksPublished`（发布成功本地盖章，线上无时间字段时的诚实兜底）。
2. **chapter_list 富投影**：`storage/publish-api.ts` `fetchChapterList` 增返 `items` 原始条目；`titles` 语义零变更（批量去重照旧）。
3. **hook**：`serialHealth` 从已持久化数据即时推导；`refreshSerialHealth` 线上巡检（逐本拉章节列表写回最近章时间/标题，300ms 轻节流，仅读端点）；单章/批量发布成功后 `lastPublishedAt` 盖章。
4. **UI**：今日作战新增「连载更新」区块（断更红/该更黄/已更绿/未知灰 + 线上巡检按钮）；命令面板新增「Publish: 连载健康巡检（断更）」。
5. **类型**：`OnlineSnapshot` 增可选 `latestChapterTitle/latestChapterAt`，`PublishBook` 增可选 `lastPublishedAt`（可选字段，存量 JSON 兼容）。

诚实边界：chapter_list 时间字段名未在 fanqie-api 文档固化，全部防御式解析；拿不到时间显示「未知」不编造；
无新增 Rust、无写端点调用、无代登/自动化，纯读侧 + 本地台账。

## 验证

- `npm --prefix apps/desktop/frontend run test`：44 files / 236 tests 全绿（含新增 `publish-serial-health.test.ts` 6 条：时间戳解析、跨字段取最新、断更分级、本地/线上取较新、清单过滤排序、发布盖章）。
- `npm --prefix apps/desktop/frontend run typecheck`：干净。
- `pnpm.cmd lint`：0 errors（Editor.tsx exhaustive-deps 1 warning 为存量）；prettier 全过。
- 零后端 / 契约变更，OpenAPI 不受影响。

## 未联通能力

- 真机（Tauri + 真番茄 Cookie）线上巡检与发布盖章端到端未验，归 E2E-1；单测只覆盖纯函数与投影。
- 番茄 chapter_list 实际时间字段名待真机首跑确认；解析不中会全部落「未知」，功能降级不误导。
