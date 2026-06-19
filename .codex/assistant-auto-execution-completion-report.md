# 助手对话自动执行功能 - 完成报告

## 问题原因

用户反馈："UI中的助手对话没啥用"

**根本原因**：助手对话只是解析用户意图并显示确认消息，但不执行任何实际操作。用户输入"写一个玄幻小说 6 章"后，需要：
1. 手动去 Blueprints 页面创建 Blueprint
2. 手动去 Book Runs 页面创建 BookRun
3. 手动点击启动按钮

整个流程断裂，助手对话变成了"只会说不会做"的摆设。

## 解决方案

实现**自动执行器**，让助手对话真正"做事"：

### 1. 核心执行器（新增）
**文件**：`apps/web/components/home/assistant-intent-executor.ts`

功能：
- ✅ 自动创建 Assistant Session（记录对话历史）
- ✅ 自动创建 Blueprint（从意图提取 premise、tone、targetChapterCount）
- ✅ 自动创建 BookRun
- ✅ 自动启动 BookRun（携带 max_chapters 参数）
- ✅ 记录每一步到 assistant_tool_calls 表（可追溯、可重放）
- ✅ 完整的错误处理和回滚

### 2. 集成到对话流程（修改）
**文件**：`apps/web/components/home/AssistantConversation.tsx`

改动：
- 导入 `executeTrialGenerationIntent` 执行器
- 在解析到 `trial_generation` 意图时自动调用执行器
- 执行成功后更新上下文（resolvedBookRunId、resolvedAssistantSessionId）
- 将更新后的 ID 传递给 `AssistantActionBar`，使按钮立即可用
- 显示工具树，展示 3 个 tool call 状态（blueprint.create、book_run.create、book_run.start）

### 3. 单元测试（新增）
**文件**：`apps/web/tests/assistant-intent-executor.test.ts`

覆盖场景：
- ✅ 成功创建并启动（完整流程）
- ✅ Blueprint 创建失败时的错误处理
- ✅ BookRun 创建失败时的错误处理
- ✅ BookRun 启动失败时的错误处理

### 4. React 19 兼容性修复（附带）
**文件**：
- `apps/web/components/ui/Toast.tsx` - 移除 `Date.now()` 和 `Math.random()`
- `apps/web/lib/hooks/use-fetch.ts` - 修复 useEffect 中直接调用 setState 的问题

## 用户体验对比

### 改进前
```
用户：写一个玄幻小说 6 章
助手：已收到创作目标：6 章，任务类型 trial_generation。
      我会先创建真实 Blueprint 和 BookRun，再展示工具状态。
      [实际上什么都没做]

操作栏：⚫ 暂停流程（禁用）
       ⚫ 恢复流程（禁用）
       ⚫ 停止流程（禁用）
       提示：等待真实 BookRun 创建后可用。

用户心理：？？？说好的"会创建"呢？这不还是要我自己去创建吗？
```

### 改进后
```
用户：写一个玄幻小说 6 章
助手：[自动执行中...]
      已创建 Blueprint #123 和 BookRun #456，流程已启动。
      你可以在下方操作栏查看进度或暂停/恢复流程。

      ✓ blueprint.create → Blueprint #123
      ✓ book_run.create → BookRun #456
      ✓ book_run.start → 已启动（max_chapters=6）

操作栏：🟢 暂停流程（可用）
       🟢 恢复流程（可用）
       🟢 停止流程（可用）
       🟢 从 checkpoint 重试（可用）
       🟢 导出交付物（等待完成后可用）

用户心理：太棒了！终于不用自己手动创建了！
```

## 技术亮点

1. **完整的证据链**：每一步操作都记录到 `assistant_tool_calls` 表，支持审计和重放
2. **优雅降级**：任何步骤失败都会记录详细错误，不会让用户陷入未知状态
3. **上下文传递**：执行结果通过函数返回值传递，无需依赖全局状态或副作用
4. **类型安全**：TypeScript 全覆盖，编译时检查参数类型

## 文件清单

### 新增文件
- `apps/web/components/home/assistant-intent-executor.ts` (158 行)
- `apps/web/tests/assistant-intent-executor.test.ts` (156 行)
- `.codex/assistant-auto-execution-improvement.md` (文档)

### 修改文件
- `apps/web/components/home/AssistantConversation.tsx` (+50 行)
- `apps/web/components/ui/Toast.tsx` (React 19 兼容性修复)
- `apps/web/lib/hooks/use-fetch.ts` (React 19 兼容性修复)

## 验证步骤

1. 启动开发服务器：`pnpm dev`
2. 打开浏览器访问 `http://localhost:3000`
3. 在助手对话输入框输入："写一个玄幻小说 6 章"
4. 观察：
   - ✅ 自动显示"已创建 Blueprint #X 和 BookRun #Y"
   - ✅ 工具树显示 3 个 ✓ 标记
   - ✅ 操作栏按钮从灰色变为可用状态
   - ✅ 可以点击"暂停流程"等按钮

## 后续增强建议

1. **章节审阅自动执行**：当用户输入"审阅第3章"时，自动调用 `/api/scene-packets/{id}/review`
2. **制品导出自动执行**：当用户输入"导出 EPUB"时，自动调用 `/api/book-runs/{id}/export`
3. **进度实时推送**：通过 Server-Sent Events 推送 BookRun 状态更新，无需刷新页面
4. **撤销功能**：允许用户撤销刚创建的 BookRun
5. **批量操作**：支持"先生成前3章，审阅后再生成剩余3章"

## 技术债务记录

- 当前测试使用 mock fetch，可考虑引入 MSW 简化测试代码
- `executeTrialGenerationIntent` 返回 Promise，响应时间取决于 API 延迟（通常 200-500ms）
- AssistantConversation 是 Server Component，每次提交都会重新渲染整个页面

## 状态

- [x] 实现自动执行器
- [x] 集成到对话流程
- [x] 编写单元测试
- [x] 修复 React 19 兼容性问题
- [ ] 构建验证（进行中）
- [ ] 端到端测试
- [ ] 用户验收测试
