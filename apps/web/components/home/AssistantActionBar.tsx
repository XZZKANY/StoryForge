import { approveStudioWritebackAction } from '../../app/studio/actions';

import { submitAssistantArtifactExport } from './assistant-artifact-export-actions';
import { submitAssistantBookRunCommand } from './assistant-book-run-actions';
import { submitAssistantChapterReview } from './assistant-chapter-review-actions';

type AssistantActionBarProps = {
  readonly assistantSessionId?: number;
  readonly bookId?: number;
  readonly bookRunId?: number;
  readonly bookRunStatus?: string;
  readonly repairPatchId?: number;
  readonly scenePacketId?: number;
  readonly targetChapterOrdinal?: number;
  readonly disabledReason?: string;
};

const bookRunActions = [
  { label: '暂停流程', action: 'pause' },
  { label: '恢复流程', action: 'resume' },
  { label: '停止流程', action: 'stop' },
  { label: '从 checkpoint 重试', action: 'retry' },
] as const;

export function AssistantActionBar({
  assistantSessionId,
  bookId,
  bookRunId,
  bookRunStatus,
  repairPatchId,
  scenePacketId,
  targetChapterOrdinal,
  disabledReason,
}: AssistantActionBarProps) {
  const reason = disabledReason ?? (bookRunId ? undefined : '等待真实 BookRun 创建后可用。');
  const reviewReason =
    disabledReason ??
    (scenePacketId || (bookId && targetChapterOrdinal)
      ? undefined
      : targetChapterOrdinal
        ? '需要选择真实作品后才能定位章节。'
        : '需要选择真实章节或 Scene Packet。');
  const writebackReason =
    disabledReason ?? (repairPatchId ? undefined : '需要选择真实 Repair Patch。');
  const exportReason =
    disabledReason ??
    (bookRunId
      ? bookRunStatus === 'completed'
        ? undefined
        : bookRunStatus
          ? `BookRun 当前状态为 ${bookRunStatus}，完成后才能导出交付物。`
          : '未读取到 BookRun 状态，暂不能导出交付物。'
      : '等待真实 BookRun 创建后可用。');

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Assistant 流程操作">
      <form action={submitAssistantChapterReview}>
        <input type="hidden" name="assistant_session_id" value={assistantSessionId ?? ''} />
        <input type="hidden" name="book_id" value={bookId ?? ''} />
        <input type="hidden" name="target_chapter_ordinal" value={targetChapterOrdinal ?? ''} />
        <input type="hidden" name="scene_packet_id" value={scenePacketId ?? ''} />
        <button
          type="submit"
          disabled={Boolean(reviewReason)}
          title={reviewReason}
          className="rounded-lg border border-[#4b4943] px-2.5 py-1 text-xs text-[#ddd4c8] hover:border-[#d8cab8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          审阅章节
        </button>
      </form>
      <form action={approveStudioWritebackAction}>
        <input type="hidden" name="assistant_session_id" value={assistantSessionId ?? ''} />
        <input type="hidden" name="repair_patch_id" value={repairPatchId ?? ''} />
        <input type="hidden" name="result_path" value="/" />
        <input type="hidden" name="result_view" value="projects" />
        <button
          type="submit"
          disabled={Boolean(writebackReason)}
          title={writebackReason}
          className="rounded-lg border border-[#4b4943] px-2.5 py-1 text-xs text-[#ddd4c8] hover:border-[#d8cab8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          应用修复
        </button>
      </form>
      {bookRunActions.map((item) => (
        <form key={item.action} action={submitAssistantBookRunCommand}>
          <input type="hidden" name="assistant_session_id" value={assistantSessionId ?? ''} />
          <input type="hidden" name="book_run_id" value={bookRunId ?? ''} />
          <input type="hidden" name="book_run_command" value={item.action} />
          <button
            type="submit"
            disabled={Boolean(reason)}
            data-endpoint={bookRunId ? `/api/book-runs/${bookRunId}/${item.action}` : undefined}
            title={reason}
            className="rounded-lg border border-[#4b4943] px-2.5 py-1 text-xs text-[#ddd4c8] hover:border-[#d8cab8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {item.label}
          </button>
        </form>
      ))}
      {bookRunId ? (
        <>
          <form action={submitAssistantArtifactExport}>
            <input type="hidden" name="assistant_session_id" value={assistantSessionId ?? ''} />
            <input type="hidden" name="book_run_id" value={bookRunId} />
            <button
              type="submit"
              disabled={Boolean(exportReason)}
              title={exportReason}
              className="rounded-lg border border-[#4b4943] px-2.5 py-1 text-xs text-[#ddd4c8] hover:border-[#d8cab8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              导出交付物
            </button>
          </form>
          <a
            href={`/book-runs/${bookRunId}/audit`}
            className="rounded-lg border border-[#4b4943] px-2.5 py-1 text-xs text-[#ddd4c8] no-underline hover:border-[#d8cab8]"
          >
            查看审计
          </a>
        </>
      ) : (
        <span className="text-xs text-[#8f877d]">{reason}</span>
      )}
    </div>
  );
}
