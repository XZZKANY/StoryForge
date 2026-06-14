import { Suspense } from 'react';
import { HomeComposer } from './HomeComposer';
import { HomeGreeting } from './HomeGreeting';
import { readBookRun } from '../../app/book-runs/api';
import { AssistantActionBar } from './AssistantActionBar';
import { AssistantMessageList } from './AssistantMessageList';
import { parseAssistantIntent } from './assistant-intent';
import {
  readAssistantSession,
  readAssistantToolCalls,
  type AssistantSessionDetail,
} from './assistant-session-store';
import {
  mapAssistantToolCallsToAssistantToolNodes,
  mapBookRunToAssistantToolNodes,
} from './assistant-tool-node-mapper';
import type { AssistantMessage } from './assistant-types';
import type { HomeSearchParams } from './home-view';

export async function AssistantConversation({
  searchParams = {},
}: {
  readonly searchParams?: HomeSearchParams;
}) {
  const intentText = firstParam(searchParams.intent);
  const assistantSessionId = readPositiveInt(firstParam(searchParams.assistant_session_id));
  const bookId = readPositiveInt(firstParam(searchParams.book_id));
  const bookRunId = readPositiveInt(firstParam(searchParams.book_run_id));
  const repairPatchId = readPositiveInt(firstParam(searchParams.repair_patch_id));
  const scenePacketId = readPositiveInt(firstParam(searchParams.scene_packet_id));
  const queryTargetChapterOrdinal = readPositiveInt(
    firstParam(searchParams.target_chapter_ordinal),
  );
  const chapterReviewStatus = firstParam(searchParams.chapter_review_status);
  const chapterReviewError = firstParam(searchParams.chapter_review_error);
  const chapterReviewSummary = firstParam(searchParams.chapter_review_summary);
  const artifactExportStatus = firstParam(searchParams.artifact_export_status);
  const artifactExportSummary = firstParam(searchParams.artifact_export_summary);
  const artifactExportError = firstParam(searchParams.artifact_export_error);
  const {
    messages,
    bookRunStatus,
    targetChapterOrdinal,
    resolvedBookRunId,
    resolvedAssistantSessionId,
  } = await buildConversationState(
    assistantSessionId,
    intentText,
    queryTargetChapterOrdinal,
    bookRunId,
    scenePacketId,
    repairPatchId,
    chapterReviewStatus,
    chapterReviewError,
    chapterReviewSummary,
    artifactExportStatus,
    artifactExportSummary,
    artifactExportError,
  );

  return (
    <div className="w-full px-6 pb-14 pt-[clamp(52px,8vh,86px)]">
      <div className="w-full max-w-[1040px]">
        <HomeGreeting />
        {messages.length > 0 ? (
          <div className="mt-6 grid gap-4">
            <AssistantMessageList messages={messages} />
            <AssistantActionBar
              assistantSessionId={assistantSessionId}
              bookId={bookId}
              bookRunId={bookRunId}
              bookRunStatus={bookRunStatus}
              repairPatchId={repairPatchId}
              scenePacketId={scenePacketId}
              targetChapterOrdinal={targetChapterOrdinal}
            />
          </div>
        ) : null}
        <div className="mt-5 md:mt-6">
          <Suspense fallback={<div className="h-32" />}>
            <HomeComposer initialSearchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function buildConversationState(
  assistantSessionId: number | undefined,
  intentText: string | undefined,
  queryTargetChapterOrdinal: number | undefined,
  bookRunId: number | undefined,
  scenePacketId: number | undefined,
  repairPatchId: number | undefined,
  chapterReviewStatus: string | undefined,
  chapterReviewError: string | undefined,
  chapterReviewSummary: string | undefined,
  artifactExportStatus: string | undefined,
  artifactExportSummary: string | undefined,
  artifactExportError: string | undefined,
): Promise<{
  messages: AssistantMessage[];
  bookRunStatus?: string;
  targetChapterOrdinal?: number;
  resolvedBookRunId?: number;
  resolvedAssistantSessionId?: number;
}> {
  const messages: AssistantMessage[] = [];
  let bookRunStatus: string | undefined;
  let targetChapterOrdinal = queryTargetChapterOrdinal;
  let toolCallNodes: AssistantMessage['toolNodes'] = [];
  let resolvedBookRunId = bookRunId;
  let resolvedAssistantSessionId = assistantSessionId;
  if (
    !assistantSessionId &&
    !intentText &&
    !bookRunId &&
    !chapterReviewStatus &&
    !artifactExportStatus
  ) {
    return { messages, resolvedBookRunId, resolvedAssistantSessionId };
  }
  try {
    let restoredSession: AssistantSessionDetail | undefined;
    if (assistantSessionId) {
      const sessionResult = await readAssistantSession(assistantSessionId);
      if (sessionResult.status === 'ready') {
        restoredSession = sessionResult.data;
        messages.push(...assistantSessionMessagesFor(restoredSession));
      } else {
        messages.push({
          id: `assistant-session-query-${assistantSessionId}`,
          role: 'assistant',
          content: `没有读取到 Assistant 会话 #${assistantSessionId} 的历史消息：${sessionResult.message}`,
          createdAt: 'assistant-session-query',
        });
      }
      const toolCallResult = await readAssistantToolCalls(assistantSessionId);
      if (toolCallResult.status === 'ready' && toolCallResult.data.length > 0) {
        toolCallNodes = mapAssistantToolCallsToAssistantToolNodes(toolCallResult.data);
      }
    }
    if (intentText) {
      const intent = parseAssistantIntent(intentText);
      targetChapterOrdinal = intent.targetChapterOrdinal ?? targetChapterOrdinal;
      if (!restoredSession || !sessionContainsMessage(restoredSession, intentText)) {
        messages.push({
          id: 'assistant-user-intent',
          role: 'user',
          content: intentText,
          createdAt: 'query-intent',
          taskType: intent.taskType,
        });

        // 自动执行 trial_generation 意图
        if (intent.taskType === 'trial_generation' && !bookRunId) {
          const executionResult = await executeTrialGenerationIntent(intent, resolvedAssistantSessionId);
          if (executionResult.status === 'ok') {
            // 执行成功：更新上下文，让 ActionBar 可以操作
            resolvedBookRunId = executionResult.bookRunId;
            resolvedAssistantSessionId = executionResult.assistantSessionId;
            messages.push({
              id: 'assistant-intent-execution-ok',
              role: 'assistant',
              content: executionResult.message,
              createdAt: 'query-intent',
              taskType: intent.taskType,
            });
            // 重新读取 tool calls 来显示工具树
            if (resolvedAssistantSessionId) {
              const toolCallResult = await readAssistantToolCalls(resolvedAssistantSessionId);
              if (toolCallResult.status === 'ready' && toolCallResult.data.length > 0) {
                toolCallNodes = mapAssistantToolCallsToAssistantToolNodes(toolCallResult.data);
              }
            }
          } else {
            messages.push({
              id: 'assistant-intent-execution-failed',
              role: 'assistant',
              content: `执行失败：${executionResult.message}`,
              createdAt: 'query-intent',
              taskType: intent.taskType,
            });
          }
        } else {
          // 其他任务类型保持原有确认逻辑
          messages.push({
            id: 'assistant-intent-confirmation',
            role: 'assistant',
            content: formatIntentConfirmation(intent),
            createdAt: 'query-intent',
            taskType: intent.taskType,
          });
        }
      }
    }
    if (resolvedBookRunId) {
      const bookRunId = resolvedBookRunId;
      const bookRun = await readBookRun(bookRunId);
      if (bookRun) {
        bookRunStatus = bookRun.status;
        const existingBookRunMessage = messages.find((m) => m.id === `assistant-book-run-${bookRun.id}`);
        if (!existingBookRunMessage) {
          messages.push({
            id: `assistant-book-run-${bookRun.id}`,
            role: 'assistant',
            content: `BookRun #${bookRun.id} 当前状态：${bookRun.status}。`,
            createdAt: 'book-run-query',
            taskType: 'trial_generation',
            toolNodes:
              toolCallNodes.length > 0 ? toolCallNodes : mapBookRunToAssistantToolNodes(bookRun),
          });
        }
      } else {
        messages.push({
          id: `assistant-book-run-${resolvedBookRunId}-missing`,
          role: 'assistant',
          content: `没有读取到 BookRun #${resolvedBookRunId}，请确认运行 ID 是否存在。`,
          createdAt: 'book-run-query',
          taskType: 'trial_generation',
        });
      }
    }
    if (!resolvedBookRunId && toolCallNodes.length > 0) {
      messages.push({
        id: `assistant-session-${resolvedAssistantSessionId}-tool-calls`,
        role: 'assistant',
        content: '已读取 Assistant 工具调用事实源。工具树优先展示可重放的 tool call 状态。',
        createdAt: 'assistant-tool-calls-query',
        toolNodes: toolCallNodes,
      });
    }
    const chapterReviewMessage = chapterReviewMessageFor(
      chapterReviewStatus,
      scenePacketId,
      repairPatchId,
      chapterReviewError,
      chapterReviewSummary,
    );
    if (chapterReviewMessage) messages.push(chapterReviewMessage);
    const artifactMessage = artifactExportMessageFor(
      artifactExportStatus,
      bookRunId,
      artifactExportSummary,
      artifactExportError,
    );
    if (artifactMessage) messages.push(artifactMessage);
    return {
      messages,
      bookRunStatus,
      targetChapterOrdinal,
      resolvedBookRunId,
      resolvedAssistantSessionId,
    };
  } catch (error) {
    return {
      messages: [
        {
          id: 'assistant-intent-error',
          role: 'assistant',
          content: error instanceof Error ? error.message : '创作目标解析失败。',
          createdAt: 'query-intent',
          taskType: 'trial_generation',
        },
      ],
      resolvedBookRunId,
      resolvedAssistantSessionId,
    };
  }
}

function assistantSessionMessagesFor(session: AssistantSessionDetail): AssistantMessage[] {
  return session.messages.map((message) => ({
    id: `assistant-session-${session.id}-message-${message.id}`,
    role: message.role,
    content: message.content,
    createdAt: message.created_at ?? 'assistant-session-query',
    taskType: taskTypeForSession(session.task_type),
  }));
}

function sessionContainsMessage(session: AssistantSessionDetail, content: string): boolean {
  return session.messages.some((message) => message.content.trim() === content.trim());
}

function taskTypeForSession(taskType: string): AssistantMessage['taskType'] {
  if (
    taskType === 'trial_generation' ||
    taskType === 'chapter_review' ||
    taskType === 'artifact_export' ||
    taskType === 'goal_update'
  ) {
    return taskType;
  }
  return undefined;
}

function formatIntentConfirmation(intent: ReturnType<typeof parseAssistantIntent>): string {
  if (intent.taskType === 'chapter_review' && intent.targetChapterOrdinal) {
    return `已收到章节审阅目标：第 ${intent.targetChapterOrdinal} 章，任务类型 ${intent.taskType}。我会定位真实 Scene Packet 后发起 Judge 审阅和 Repair 修复建议。`;
  }
  return `已收到创作目标：${intent.targetChapterCount} 章，任务类型 ${intent.taskType}。我会先创建真实 Blueprint 和 BookRun，再展示工具状态。`;
}

function chapterReviewMessageFor(
  chapterReviewStatus: string | undefined,
  scenePacketId: number | undefined,
  repairPatchId: number | undefined,
  chapterReviewError: string | undefined,
  chapterReviewSummary: string | undefined,
): AssistantMessage | null {
  if (!chapterReviewStatus) return null;
  const summary = formatChapterReviewSummary(chapterReviewSummary);
  if (chapterReviewStatus === 'select_chapter') {
    return {
      id: 'assistant-chapter-review-select-chapter',
      role: 'assistant',
      content: '需要选择真实章节或 Scene Packet 后，才能发起 Judge 审阅和 Repair 修复建议。',
      createdAt: 'chapter-review',
      taskType: 'chapter_review',
    };
  }
  if (chapterReviewStatus === 'select_book') {
    return {
      id: 'assistant-chapter-review-select-book',
      role: 'assistant',
      content: '需要选择真实作品后，才能按章节序号定位 Scene Packet 并发起审阅。',
      createdAt: 'chapter-review',
      taskType: 'chapter_review',
    };
  }
  if (chapterReviewStatus === 'ready') {
    const patchSummary = repairPatchId
      ? `Repair Patch #${repairPatchId} 已准备好，可点击“应用修复”。`
      : '当前章节没有可应用的 Repair Patch，可先查看审阅摘要。';
    return {
      id: `assistant-chapter-review-${scenePacketId ?? 'unknown'}-ready`,
      role: 'assistant',
      content: `Scene Packet #${scenePacketId ?? '未知'} 的章节审阅已准备好。${patchSummary}${summary}`,
      createdAt: 'chapter-review',
      taskType: 'chapter_review',
    };
  }
  if (chapterReviewStatus === 'failed') {
    const reason = chapterReviewError?.trim() || '章节审阅链路返回失败。';
    return {
      id: `assistant-chapter-review-${scenePacketId ?? 'unknown'}-failed`,
      role: 'assistant',
      content: `章节审阅失败：${reason}${summary}`,
      createdAt: 'chapter-review',
      taskType: 'chapter_review',
    };
  }
  return null;
}

function formatChapterReviewSummary(value: string | undefined): string {
  if (!value?.trim()) return '';
  try {
    const parsed = JSON.parse(value) as {
      readonly issues?: readonly {
        readonly summary?: unknown;
        readonly severity?: unknown;
        readonly evidence?: unknown;
      }[];
      readonly repairPatch?: unknown;
    };
    const parts: string[] = [];
    const issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 2) : [];
    for (const issue of issues) {
      const summary = readSummaryString(issue.summary);
      const severity = readSummaryString(issue.severity);
      const evidence = readSummaryString(issue.evidence);
      const issueParts = [
        summary ? `问题：${summary}` : undefined,
        severity ? `严重级别：${severity}` : undefined,
        evidence ? `证据引用：${evidence}` : undefined,
      ].filter((item): item is string => Boolean(item));
      if (issueParts.length > 0) parts.push(issueParts.join('；'));
    }
    const repairPatch = readSummaryString(parsed.repairPatch);
    if (repairPatch) parts.push(`Repair Patch 摘要：${repairPatch}`);
    return parts.length > 0 ? ` 审阅摘要：${parts.join('。')}` : '';
  } catch {
    return '';
  }
}

function readSummaryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function artifactExportMessageFor(
  artifactExportStatus: string | undefined,
  bookRunId: number | undefined,
  artifactExportSummary: string | undefined,
  artifactExportError: string | undefined,
): AssistantMessage | null {
  if (!artifactExportStatus) return null;
  if (artifactExportStatus === 'ok') {
    const summary = artifactExportSummary?.trim()
      ? `制品摘要：${artifactExportSummary.trim()}。`
      : '制品摘要已写入 Artifacts。';
    return {
      id: `assistant-artifact-export-${bookRunId ?? 'unknown'}-ok`,
      role: 'assistant',
      content: `BookRun #${bookRunId ?? '未知'} 已导出 Markdown、EPUB 和审计报告。${summary}`,
      createdAt: 'artifact-export',
      taskType: 'artifact_export',
    };
  }
  if (artifactExportStatus === 'not_ready') {
    return {
      id: `assistant-artifact-export-${bookRunId ?? 'unknown'}-not-ready`,
      role: 'assistant',
      content: `BookRun #${bookRunId ?? '未知'} 尚未完成，不能导出 Markdown、EPUB 和审计报告。`,
      createdAt: 'artifact-export',
      taskType: 'artifact_export',
    };
  }
  if (artifactExportStatus === 'invalid') {
    return {
      id: 'assistant-artifact-export-invalid',
      role: 'assistant',
      content: '导出失败：缺少有效 BookRun ID，无法生成 Markdown、EPUB 和审计报告。',
      createdAt: 'artifact-export',
      taskType: 'artifact_export',
    };
  }
  if (artifactExportStatus === 'failed') {
    const reason = artifactExportError?.trim() || '导出链路返回失败。';
    return {
      id: `assistant-artifact-export-${bookRunId ?? 'unknown'}-failed`,
      role: 'assistant',
      content: `导出失败：${reason}`,
      createdAt: 'artifact-export',
      taskType: 'artifact_export',
    };
  }
  return null;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readPositiveInt(value: string | undefined): number | undefined {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
