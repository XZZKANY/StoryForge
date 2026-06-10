# 侧边栏主题颜色修复验证报告

生成时间：2026-06-10 11:44:04 +08:00

## 1. 需求字段完整性

- **目标**：彻底修复白天/黑夜模式下左侧统一侧边栏与右侧主内容区的文字颜色、激活态和 hover 态不一致问题，并借鉴 Gemini 的中性黑白灰主题。
- **范围**：`UnifiedSidebar` 及其站点导航子组件、全局主题 token、右侧 `Chrome` 主内容背景、相关源码契约测试。
- **交付物**：主题样式代码、导航契约测试、上下文摘要、操作日志、本验证报告。
- **审查要点**：移除硬编码棕色/褐色导航样式；普通文字使用 `text-muted-foreground`；标题和激活文字使用 `text-foreground`；active/hover 背景跟随主题变量；左右字体族和基础字重一致。

## 2. 交付物映射

- `apps/web/app/globals.css`：将全局主题改为 Gemini 式中性灰，并移除全局链接颜色和粗字重污染。
- `apps/web/components/site-nav/UnifiedSidebar.tsx`：侧栏容器、主导航、账号区统一使用 `bg-background`、`bg-panel`、`text-foreground`、`text-muted-foreground`、`bg-muted/*`。
- `apps/web/components/site-nav/CollapsibleNavItem.tsx`：同步修复“创作工作台”的 active/hover 状态。
- `apps/web/components/site-nav/StudioProjectsList.tsx`：项目子导航使用语义文字和灰阶 hover。
- `apps/web/components/site-nav/RecentItemsList.tsx`：最近记录列表移除硬编码暖色，改为语义文字 token。
- `apps/web/components/site-nav/ThemeToggle.tsx`：主题切换按钮改为侧栏内图标按钮，去掉浮动 stone 风格。
- `apps/web/components/site-nav/Chrome.tsx`：右侧主内容区改用 `bg-background`，与侧栏同源。
- `apps/web/tests/phase1-navigation.test.tsx`、`apps/web/tests/home-page.test.tsx`：更新导航主题契约和背景契约。

## 3. 上下文与资料来源

- 项目内相似实现：已分析 `UnifiedSidebar`、`CollapsibleNavItem`、`RecentItemsList`、`StudioProjectsList`、`ThemeToggle` 的导航拼接模式。
- 官方文档：Context7 查询 Tailwind CSS v4，确认 `@theme` 和 CSS 变量是 v4 主题 token 的标准做法。
- 开源参考：GitHub `search_code` 查询 `text-muted-foreground`、`text-foreground`、`bg-muted/*` 组合，确认语义前景色与 muted 状态层是通用实践。
- 工具限制：`shrimp-task-manager` 当前没有未完成任务，也未暴露创建任务的 `split_tasks` 工具；本轮使用 `process_thought` 记录分析与结论。

## 4. 本地验证结果

- `pnpm --filter @storyforge/web test -- phase1-navigation`：19/19 passed，退出码 0。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过，退出码 0。
- `git diff --check -- <本轮相关文件>`：无空白错误，退出码 0。
- 源码扫描：当前 `UnifiedSidebar` 链路未命中旧 `bg-nav-active`、`bg-nav-hover`、`text-accent`、硬编码十六进制暖色或全局 `a { color: var(--accent) }` / `a { font-weight: 700 }`。
- 浏览器取样 `http://localhost:3002`：浅色下侧栏与主内容背景均为 `rgb(248, 250, 253)`，普通导航文字 `rgb(95, 99, 104)` / 字重 400，激活文字 `rgb(31, 31, 31)` / 字重 500。
- 浏览器取样 `http://localhost:3002`：深色下侧栏与主内容背景均为 `rgb(19, 19, 20)`，普通导航文字 `rgb(154, 160, 166)` / 字重 400，激活文字 `rgb(232, 234, 237)` / 字重 500。
- 字体核对：浅色和深色下 body、侧栏、主内容区均使用 `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`。

## 5. 未通过验证与风险

- 组合测试 `pnpm --filter @storyforge/web test -- phase1-navigation home-page`：31/32 passed，退出码 1。
- 唯一失败项：`HomeComposer 是底部 Assistant 输入框且没有模式按钮`，断言为“Assistant 快捷动作应恢复旧版居中按钮行”。
- 根因边界：失败来自 `HomeComposer.tsx` 是否包含旧版快捷动作行，与本次侧栏文字颜色、active/hover 背景、字体权重修复无关。
- 旁路组件说明：`SiteNav.tsx` 仍有旧 `stone-*` 移动导航样式，但主布局测试和源码显示当前全站壳层使用 `Chrome -> UnifiedSidebar`，`SiteNav` 未参与本次统一侧栏链路。
- 补偿计划：本次不擅自改动 `HomeComposer` 业务输入框；若要全量首页组合测试绿灯，应另起任务处理旧快捷动作契约与现状 UI 的冲突。

## 6. 评分

- **代码质量**：92/100。改动集中在主题 token 与导航组件，未新增自研主题框架。
- **测试覆盖**：88/100。侧栏主题契约、TypeScript 和浏览器 computed style 覆盖充分；相邻首页测试仍有非本轮失败。
- **规范遵循**：90/100。完成上下文摘要、操作日志、sequential-thinking、Context7、GitHub 搜索和本地验证记录；`shrimp-task-manager` 创建任务能力受工具暴露限制。
- **需求匹配**：94/100。三项用户要求均有源码和浏览器证据覆盖。
- **架构一致**：90/100。继续复用 Tailwind v4 语义 token 与现有导航组件边界。
- **风险评估**：86/100。主要风险是工作区存在大量无关脏改动和相邻契约漂移，已隔离记录。

## 7. 结论

综合评分：91/100。

明确建议：通过本次侧边栏主题颜色修复；相邻 `HomeComposer` 快捷动作契约失败应作为独立任务处理，不阻塞本轮侧栏黑白灰一致性修复。

审查结论已留痕，时间戳：2026-06-10 11:44:04 +08:00。
