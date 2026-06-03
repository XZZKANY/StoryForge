import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  appendAssistantSessionMessage,
  createAssistantSession,
} from '../../components/home/assistant-session-store';
import { apiFetch } from '../../lib/api-client';

import { submitStudioApproval, type StudioApprovalSessionWrite } from './approval-action-core';
import { studioApproveEndpoint } from './api';

function truncateSessionSummary(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

function formatApprovalSessionContent(payload: StudioApprovalSessionWrite): string {
  const summary = truncateSessionSummary(payload.summary);
  const details = [
    `writeback_status=${payload.writebackStatus}`,
    typeof payload.approvedChapterId === 'number'
      ? `approved_chapter_id=${payload.approvedChapterId}`
      : null,
    typeof payload.repairPatchId === 'number' ? `repair_patch_id=${payload.repairPatchId}` : null,
    typeof payload.scenePacketId === 'number' ? `scene_packet_id=${payload.scenePacketId}` : null,
    summary ? `摘要：${summary}` : null,
  ].filter((value): value is string => value !== null);
  return `Studio 批准写回完成：${details.join('；')}。`;
}

async function writeAssistantApprovalSession(payload: StudioApprovalSessionWrite): Promise<void> {
  const content = formatApprovalSessionContent(payload);

  if (payload.assistantSessionId) {
    const result = await appendAssistantSessionMessage(payload.assistantSessionId, {
      role: 'assistant',
      content,
    });
    if (result.status === 'error') {
      throw new Error(result.message);
    }
    return;
  }

  const result = await createAssistantSession({
    title: 'Studio 批准写回',
    task_type: 'chapter_review',
    messages: [{ role: 'assistant', content }],
  });
  if (result.status === 'error') {
    throw new Error(result.message);
  }
}

export async function approveStudioWritebackAction(formData: FormData) {
  'use server';

  const resultPath = formData.get('result_path');
  const resultView = formData.get('result_view');
  const bookId = formData.get('book_id');
  const assistantSessionId = formData.get('assistant_session_id');
  const parsedBookId = typeof bookId === 'string' ? Number.parseInt(bookId, 10) : Number.NaN;
  const parsedAssistantSessionId =
    typeof assistantSessionId === 'string' ? Number.parseInt(assistantSessionId, 10) : Number.NaN;

  return submitStudioApproval(formData, {
    endpoint: studioApproveEndpoint,
    apiFetch,
    revalidatePath,
    redirect,
    writeAssistantApprovalSession,
    resultTarget: {
      pathname: typeof resultPath === 'string' && resultPath.length > 0 ? resultPath : '/studio',
      view: typeof resultView === 'string' && resultView.length > 0 ? resultView : undefined,
      bookId: Number.isInteger(parsedBookId) && parsedBookId > 0 ? parsedBookId : undefined,
      assistantSessionId:
        Number.isInteger(parsedAssistantSessionId) && parsedAssistantSessionId > 0
          ? parsedAssistantSessionId
          : undefined,
    },
  });
}
