# 助手对话自动执行改进

## 问题诊断

用户反馈："UI中的助手对话没啥用"

**核心问题**：用户在助手对话中输入创作意图（如"写一个玄幻小说 6 章"）后，助手只显示"已收到创作目标"的确认消息，但**没有自动执行**创建 Blueprint 和 BookRun 的操作。导致用户需要手动去其他地方创建，体验断裂。

## 原有流程

1. 用户输入："写一个玄幻小说 6 章"
2. `HomeComposer` 提交表单，携带 `intent` 参数
3. `AssistantConversation` 解析意图，调用 `parseAssistantIntent`
4. 显示两条消息：
   - 用户消息："写一个玄幻小说 6 章"
   - 助手确认："已收到创作目标：6 章，任务类型 trial_generation。我会先创建真实 Blueprint 和 BookRun，再展示工具状态。"
5. **实际上什么都没做** → `AssistantActionBar` 显示"等待真实 BookRun 创建后可用"

## 改进方案

### 1. 新增自动执行器

**文件**：`apps/web/components/home/assistant-intent-executor.ts`

**核心逻辑**：
```typescript
export async function executeTrialGenerationIntent(
  intent: AssistantIntent,
  existingAssistantSessionId?: number,
): Promise<IntentExecutionResult>
```

**执行步骤**：
1. 创建或复用 Assistant Session
2. 调用 `/api/blueprints` 创建 Blueprint（携带 premise、tone、targetChapterCount 等）
3. 记录 `blueprint.create` tool call
4. 调用 `/api/blueprints/{id}/book-runs` 创建 BookRun
5. 记录 `book_run.create` tool call
6. 调用 `/api/book-runs/{id}/start` 启动流程（携带 max_chapters）
7. 记录 `book_run.start` tool call
8. 追加成功消息到 Assistant Session
9. 返回 `{ status: 'ok', assistantSessionId, blueprintId, bookRunId, message }`

**错误处理**：
- 任何步骤失败都记录 tool call 状态为 `failed`
- 追加失败消息到 Assistant Session
- 返回 `{ status: 'error', message }`

### 2. 集成到对话流程

**文件**：`apps/web/components/home/AssistantConversation.tsx`

**改动**：
```typescript
// 导入执行器
import { executeTrialGenerationIntent } from './assistant-intent-executor';

// 在 buildConversationState 中增加自动执行逻辑
if (intent.taskType === 'trial_generation' && !bookRunId) {
  const executionResult = await executeTrialGenerationIntent(intent, resolvedAssistantSessionId);
  if (executionResult.status === 'ok') {
    // 更新上下文
    resolvedBookRunId = executionResult.bookRunId;
    resolvedAssistantSessionId = executionResult.assistantSessionId;
    // 显示成功消息
    messages.push({...});
    // 重新读取 tool calls 显示工具树
    toolCallNodes = mapAssistantToolCallsToAssistantToolNodes(...);
  } else {
    // 显示失败消息
    messages.push({...});
  }
} else {
  // 其他任务类型保持原有确认逻辑
  messages.push({ id: 'assistant-intent-confirmation', ... });
}
```

**返回值扩展**：
```typescript
return {
  messages,
  bookRunStatus,
  targetChapterOrdinal,
  resolvedBookRunId,      // 新增：执行后的 BookRun ID
  resolvedAssistantSessionId,  // 新增：执行后的 Session ID
};
```

**ActionBar 绑定**：
```tsx
<AssistantActionBar
  assistantSessionId={resolvedAssistantSessionId ?? assistantSessionId}
  bookRunId={resolvedBookRunId ?? bookRunId}
  ...
/>
```

### 3. 测试覆盖

**文件**：`apps/web/tests/assistant-intent-executor.test.ts`

**测试场景**：
- ✅ 成功创建 Blueprint + BookRun + 启动流程
- ✅ Blueprint 创建失败时的优雅降级
- ✅ BookRun 创建失败时的优雅降级
- ✅ BookRun 启动失败时的优雅降级

## 改进后流程

1. 用户输入："写一个玄幻小说 6 章"
2. `HomeComposer` 提交表单
3. `AssistantConversation` 解析意图，检测到 `trial_generation`
4. **自动调用 `executeTrialGenerationIntent`**：
   - 创建 Blueprint #123
   - 创建 BookRun #456
   - 启动流程（max_chapters=6）
5. 显示消息：
   - 用户消息："写一个玄幻小说 6 章"
   - 助手消息："已创建 Blueprint #123 和 BookRun #456，流程已启动。你可以在下方操作栏查看进度或暂停/恢复流程。"
   - 工具树显示：blueprint.create ✓、book_run.create ✓、book_run.start ✓
6. `AssistantActionBar` 按钮全部可用（暂停、恢复、停止、重试、导出等）

## 验证要点

- [ ] 输入"写一个玄幻小说 6 章"后，自动创建 Blueprint 和 BookRun
- [ ] 工具树正确显示 3 个 tool call 状态
- [ ] ActionBar 按钮从灰色变为可用状态
- [ ] 失败时显示明确的错误消息，而不是静默失败
- [ ] 其他任务类型（chapter_review、artifact_export）保持原有确认逻辑

## 未来增强

1. **章节审阅自动执行**：`chapter_review` 意图也可以自动调用 `/api/scene-packets/{id}/review`
2. **制品导出自动执行**：`artifact_export` 意图可以自动调用 `/api/book-runs/{id}/export`
3. **进度轮询**：自动刷新 BookRun 状态，无需手动刷新页面
4. **流式输出**：通过 Server-Sent Events 实时推送执行进度
5. **撤销功能**：如果用户不满意自动创建的结果，提供"撤销"按钮删除 BookRun

## 技术债务

- 当前测试需要 mock 大量 fetch 调用，可考虑引入 MSW (Mock Service Worker) 简化测试
- `executeTrialGenerationIntent` 是 Server Action，但返回值通过 Promise 传递，未来可考虑改为 Server Action + redirect 模式
- AssistantConversation 是 Server Component，执行逻辑在服务端，响应时间取决于 API 延迟

## 相关文件

- `apps/web/components/home/assistant-intent-executor.ts` (新增)
- `apps/web/components/home/AssistantConversation.tsx` (修改)
- `apps/web/components/home/assistant-intent.ts` (依赖)
- `apps/web/components/home/assistant-session-store.ts` (依赖)
- `apps/web/components/home/assistant-tools/tool-call-writer.ts` (依赖)
- `apps/web/tests/assistant-intent-executor.test.ts` (新增)
