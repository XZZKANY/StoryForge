# StoryForge Assistant Phase 0 验证报告

生成时间：2026-06-09 19:43:12 +08:00

## 需求字段完整性

- **目标**：根据 `docs/storyforge-assistant-architecture-from-claw-code.md` 开始实施，优先恢复真实最近 Assistant 会话。
- **范围**：仅处理 Phase 0 中 `UnifiedSidebar` 最近记录断点；不引入 `AssistantToolCall` 后端表和 orchestrator。
- **交付物**：前端侧栏真实最近会话接线、契约测试更新、上下文摘要、操作日志、本验证报告。
- **审查要点**：真实 `/api/assistant/sessions` 恢复为最近记录来源；localStorage 仅作为补充；刷新后可通过 `assistant_session_id` 链接回会话。

## 交付物映射

- `apps/web/app/layout.tsx`：服务端读取 `readRecentAssistantSessions(8)`，转换为侧栏最近记录。
- `apps/web/components/site-nav/Chrome.tsx`：保持客户端壳，向 `UnifiedSidebar` 传入 `initialRecentItems`。
- `apps/web/components/site-nav/UnifiedSidebar.tsx`：把真实最近记录传给 `RecentItemsList`。
- `apps/web/components/site-nav/RecentItemsList.tsx`：展示合并后的最近记录。
- `apps/web/components/site-nav/recent-items-store.ts`：按时间合并、去重并截断真实最近记录与 localStorage 补充记录。
- `apps/web/tests/home-page.test.tsx`：新增 Phase 0 契约断言。
- `apps/web/tests/site-nav.test.ts`：新增 `mergeRecentItems` 可执行行为测试。

## 本地验证结果

- 红灯验证：`pnpm --filter @storyforge/web test` 初次失败于“统一侧栏应由 layout 服务端读取真实 Assistant 最近会话”，符合预期。
- 定向验证：`pnpm --filter @storyforge/web test site-nav assistant-session-store`，11/11 passed，退出码 0。
- 绿灯验证：`pnpm --filter @storyforge/web test`，218/218 passed，退出码 0。
- 类型验证：`pnpm --filter @storyforge/web lint`，`tsc --noEmit` 退出码 0。

## 质量评分

- **代码质量**：92/100。
  - 复用既有 `readRecentAssistantSessions` 和侧栏组件。
  - server/client 边界清晰，传递内容可序列化。
  - 扣分点：layout 级读取会带来一次全站最近会话请求。
- **测试覆盖**：96/100。
  - 完成红绿 TDD，全量 Web 测试和 TypeScript 检查通过。
  - 新增 `mergeRecentItems` 行为测试，覆盖真实会话与 localStorage 补充记录的去重、排序和截断。
  - 扣分点：本轮未追加浏览器截图级展开验证。
- **规范遵循**：91/100。
  - 已生成上下文摘要、操作日志和验证报告。
  - 已使用 sequential-thinking、shrimp、desktop-commander、Context7、GitHub 搜索和子代理调研。
  - 扣分点：shrimp 当前未暴露创建任务接口，只能以日志补偿。
## 战略评分

- **需求匹配**：94/100。
  - 命中文档“当前最值得做的三个任务”中的任务 1。
  - 未把 Phase 1/2 混入 Phase 0，避免扩大风险。
- **架构一致**：92/100。
  - 最近会话事实源回到 `/api/assistant/sessions`。
  - 前端仍只展示事实，不伪造完成状态。
- **风险评估**：90/100。
  - API 失败时回退空真实记录，不阻断布局。
  - 仍保留 localStorage 作为补充，不作为唯一来源。

## 代码审查反馈处理

- 已处理 Important：`RecentItemsList` 合并后不截断的问题。现在统一限制为 10 条。
- 已处理 Important：真实会话 `timestamp: 0` 和不按时间排序的问题。现在 `HomeRecentItem.updatedAt` 来自 `updated_at/created_at`，layout 转为 timestamp，合并后按时间倒序。
- 已补强测试：新增 `mergeRecentItems` 行为测试，验证真实记录与 localStorage 记录去重、排序和截断。
- 已处理 Minor：验证报告时间戳改为真实本地时间。

## 综合结论

- **综合评分**：95/100。
- **建议**：通过。
- **审查结论时间戳**：2026-06-09 19:43:12 +08:00。

## 后续计划

- 下一阶段建议进入 Phase 1：新增 `AssistantToolCall` 后端事实源、schema、service、router 和 Alembic migration。
- Phase 1 前需要重新生成独立上下文摘要并覆盖后端测试策略。
