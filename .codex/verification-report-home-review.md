# 验证报告：首页 Claude-like 重构复审

生成时间：2026-05-28 03:24:04

## 1. 需求字段完整性

- 目标：按 `docs/superpowers/specs/2026-05-28-claude-like-storyforge-home-design.md` 检查并完善首页 Claude-like 重构。
- 范围：首页入口、首页组件拆分、全局 Chrome 壳层、首页导航与快捷动作、相关 Web 测试与本地构建验证。
- 交付物：实现文件、测试文件、本地验证记录、风险结论。
- 审查要点：规格覆盖、无 Claude 无关分类、无伪造数据、现有路由可跳转、本地测试/类型检查/构建闭环。

## 2. 根因与修复结论

前次“不通过”的主要原因是构建验证未闭环：`pnpm --filter @storyforge/web build` 在 180 秒内超时，诊断文件显示停留在 `type-checking` 阶段。独立 `pnpm --filter @storyforge/web lint` 已通过，说明不是稳定类型错误。

本次清理 `apps/web/.next` 后，以更充足的 10 分钟预算重新执行构建，冷构建成功；随后再次执行带缓存构建，也成功。因此该问题确认为验证预算/缓存状态问题，不是首页代码构建失败。

## 3. 规格覆盖检查

- `apps/web/app/page.tsx` 已改为薄入口，仅渲染 `HomeShell`。
- `apps/web/components/home/` 已拆分为 `HomeShell.tsx`、`HomeSidebar.tsx`、`HomeComposer.tsx`、`HomeQuickActions.tsx`、`HomeContextStrip.tsx`、`home-data.ts`。
- 左侧导航覆盖 spec 中的 StoryForge 真实入口。
- 顶部状态胶囊链接 `/providers`，无法读取 Provider 时显示待检查。
- 中央主标题为“今天要锻造哪段故事？”。
- 大输入框保留 `aria-label`，第一阶段默认跳转 `/blueprints`，不新增后端契约。
- 快捷动作使用真实 `next/link` 跳转既有路由。
- 最近记录与上下文摘要均使用明确空状态，未伪造成功数据。
- 首页测试覆盖无 Claude 无关分类残留。

## 4. 本地验证结果

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `pnpm --filter @storyforge/web test` | 通过 | `tests 73`，`pass 73`，`fail 0`，退出码 0 |
| `pnpm --filter @storyforge/web lint` | 通过 | `tsc --noEmit`，退出码 0 |
| `pnpm --filter @storyforge/web build` | 通过 | `Compiled successfully in 32.0s`，`Generating static pages (16/16)`，退出码 0 |

## 5. 风险与补偿计划

1. 构建耗时较长：冷构建约 142 秒，缓存构建约 97 秒。后续验证命令应给出至少 10 分钟超时预算，并尽量保留构建缓存。
2. Sentry/Next 构建警告仍存在：包括 Sentry 配置弃用、缺少 global error handler、ESLint 未检测到 Next 插件。这些不是本次首页重构引入的失败项，建议另立技术债任务处理。
3. Git 工作区仍包含多个与首页以外相关的修改和 `.codex/visual-preview/`、SQLite 文件等本地产物。提交前必须确认提交范围，避免混入临时制品。
4. `.codex/verification-report.md` 被其他进程占用，本报告写入 `.codex/verification-report-home-review.md`；`operations-log.md` 也曾出现占用，但后续写入成功。

## 6. 评分

- 代码质量：91/100
- 测试覆盖：92/100
- 规范遵循：90/100
- 需求匹配：94/100
- 架构一致：91/100
- 风险评估：90/100

综合评分：91/100

## 7. 审查建议

建议：**通过**。

通过条件说明：本地 Web 测试、类型检查与生产构建均已闭环通过；规格主体均有对应实现与测试覆盖。提交前仍需确认 Git 提交范围，排除本地临时产物。
