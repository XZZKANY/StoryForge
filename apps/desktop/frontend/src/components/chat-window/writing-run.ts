import type { WritingRunEvent } from '../../lib/api-client';
import type { ChatWindowAgentResult, WritingRunProjection } from './types';

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function writingRunIdFromResult(message: ChatWindowAgentResult): number | null {
  return (
    numberOrNull(message.agent_result.writing_run_id) ??
    numberOrNull(message.agent_result.writing_run?.writing_run_id) ??
    numberOrNull(message.agent_result.book_run_id) ??
    numberOrNull(message.agent_result.book_run?.id)
  );
}

export function applyWritingRunEventProjection(
  current: WritingRunProjection | null,
  event: WritingRunEvent,
): WritingRunProjection | null {
  const writingRun = event.data.writing_run;
  const writingRunId =
    numberOrNull(event.data.writing_run_id) ??
    (writingRun && typeof writingRun === 'object'
      ? numberOrNull((writingRun as { writing_run_id?: unknown }).writing_run_id)
      : null);
  const resolvedWritingRunId =
    writingRunId ?? numberOrNull(event.data.book_run_id) ?? current?.writingRunId ?? null;
  if (resolvedWritingRunId === null) return current;
  if (event.event === 'progress') {
    return {
      writingRunId: resolvedWritingRunId,
      status:
        typeof event.data.status === 'string' ? event.data.status : (current?.status ?? 'running'),
      currentChapterIndex:
        numberOrNull(event.data.current_chapter_index) ?? current?.currentChapterIndex ?? null,
      totalChapters: numberOrNull(event.data.total_chapters) ?? current?.totalChapters ?? null,
      completedCount: numberOrNull(event.data.completed_count) ?? current?.completedCount ?? null,
      latestEvent: 'progress',
      failureReason: current?.failureReason ?? null,
    };
  }
  const blocked = event.data.blocked_chapter;
  const failureReason =
    typeof event.data.pause_reason === 'string'
      ? event.data.pause_reason
      : blocked && typeof blocked === 'object'
        ? '存在阻塞章节'
        : (current?.failureReason ?? null);
  return {
    writingRunId: resolvedWritingRunId,
    status: current?.status ?? 'running',
    currentChapterIndex: current?.currentChapterIndex ?? null,
    totalChapters: current?.totalChapters ?? null,
    completedCount: current?.completedCount ?? null,
    latestEvent: event.event,
    failureReason,
  };
}
