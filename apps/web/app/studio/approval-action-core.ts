import type { ApiFetchInit } from '../../lib/api-client';

import type { StudioApprovalExecuteResult } from './types';
import { isStudioApprovalExecuteResult } from './validators';

export type StudioApprovalRequestBody = {
  readonly scene_packet_id?: number;
  readonly repair_patch_id?: number;
};

export type StudioApprovalSessionWrite = {
  readonly assistantSessionId?: number;
  readonly writebackStatus: string;
  readonly approvedChapterId?: number | null;
  readonly repairPatchId?: number;
  readonly scenePacketId?: number;
  readonly summary?: string | null;
};

export type ApprovalRequestBuildResult =
  | { readonly status: 'ready'; readonly body: StudioApprovalRequestBody }
  | { readonly status: 'invalid'; readonly redirectUrl: string };

export type StudioApprovalSubmitDependencies = {
  readonly endpoint: string;
  readonly apiFetch: (path: string, init: ApiFetchInit) => Promise<Response>;
  readonly revalidatePath: (path: string) => void;
  readonly redirect: (url: string) => never;
  readonly resultTarget?: StudioApprovalResultTarget;
  readonly writeAssistantApprovalSession?: (payload: StudioApprovalSessionWrite) => Promise<void>;
};

export type StudioApprovalResultTarget = {
  readonly pathname: string;
  readonly view?: string;
  readonly bookId?: number;
  readonly assistantSessionId?: number;
};

function getRequiredFormValue(
  formData: FormData,
  key: 'scene_packet_id' | 'repair_patch_id',
): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function buildApprovalResultUrl(
  payload: Partial<StudioApprovalExecuteResult>,
  target: StudioApprovalResultTarget = { pathname: '/studio' },
): string {
  const params = new URLSearchParams();
  if (target.view) {
    params.set('view', target.view);
  }
  if (typeof target.bookId === 'number') {
    params.set('book_id', String(target.bookId));
  }
  if (typeof target.assistantSessionId === 'number') {
    params.set('assistant_session_id', String(target.assistantSessionId));
  }
  params.set('approval_submitted', '1');
  params.set('writeback_status', payload.writeback_status ?? '提交失败');
  if (typeof payload.approved_chapter_id === 'number') {
    params.set('approved_chapter_id', String(payload.approved_chapter_id));
  }
  if (
    typeof payload.continuity_update_summary === 'string' &&
    payload.continuity_update_summary.length > 0
  ) {
    params.set('continuity_update_summary', payload.continuity_update_summary);
  }
  if (typeof payload.unavailable_reason === 'string' && payload.unavailable_reason.length > 0) {
    params.set('unavailable_reason', payload.unavailable_reason);
  }
  return `${target.pathname}?${params.toString()}`;
}

function readResultTarget(formData: FormData): StudioApprovalResultTarget {
  const targetPath = formData.get('result_path');
  const targetView = formData.get('result_view');
  const bookId = formData.get('book_id');
  const parsedBookId = typeof bookId === 'string' ? Number.parseInt(bookId, 10) : Number.NaN;
  return {
    pathname: typeof targetPath === 'string' && targetPath.length > 0 ? targetPath : '/studio',
    view: typeof targetView === 'string' && targetView.length > 0 ? targetView : undefined,
    bookId: Number.isInteger(parsedBookId) && parsedBookId > 0 ? parsedBookId : undefined,
    assistantSessionId: readPositiveInt(formData, 'assistant_session_id'),
  };
}

function readPositiveInt(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function buildApprovalRequestBody(formData: FormData): ApprovalRequestBuildResult {
  const scenePacketId = getRequiredFormValue(formData, 'scene_packet_id');
  const repairPatchId = getRequiredFormValue(formData, 'repair_patch_id');
  const resultTarget = readResultTarget(formData);

  if (scenePacketId !== undefined && repairPatchId !== undefined) {
    return {
      status: 'invalid',
      redirectUrl: buildApprovalResultUrl(
        {
          writeback_status: '未执行',
          unavailable_reason: 'Scene Packet ID 与 Repair Patch ID 只能提供一个。',
        },
        resultTarget,
      ),
    };
  }
  if (scenePacketId !== undefined) {
    return { status: 'ready', body: { scene_packet_id: Number(scenePacketId) } };
  }
  if (repairPatchId !== undefined) {
    return { status: 'ready', body: { repair_patch_id: Number(repairPatchId) } };
  }
  return {
    status: 'invalid',
    redirectUrl: buildApprovalResultUrl(
      {
        writeback_status: '未执行',
        unavailable_reason: '需要提供 Scene Packet ID 或 Repair Patch ID。',
      },
      resultTarget,
    ),
  };
}

export async function submitStudioApproval(
  formData: FormData,
  dependencies: StudioApprovalSubmitDependencies,
): Promise<never> {
  const resultTarget = dependencies.resultTarget ?? readResultTarget(formData);
  const request = buildApprovalRequestBody(formData);
  if (request.status === 'invalid') {
    return dependencies.redirect(request.redirectUrl);
  }

  let response: Response;
  try {
    response = await dependencies.apiFetch(dependencies.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return dependencies.redirect(
      buildApprovalResultUrl(
        { writeback_status: '提交失败', unavailable_reason: message },
        resultTarget,
      ),
    );
  }
  if (!response.ok) {
    return dependencies.redirect(
      buildApprovalResultUrl(
        {
          writeback_status: '提交失败',
          unavailable_reason: `批准写回 API 返回 ${response.status}`,
        },
        resultTarget,
      ),
    );
  }
  const responsePayload: unknown = await response.json();
  if (!isStudioApprovalExecuteResult(responsePayload)) {
    return dependencies.redirect(
      buildApprovalResultUrl(
        {
          writeback_status: '提交失败',
          unavailable_reason: '批准写回 API 返回格式不符合预期',
        },
        resultTarget,
      ),
    );
  }
  const approvalResult = responsePayload;

  try {
    await dependencies.writeAssistantApprovalSession?.({
      assistantSessionId: resultTarget.assistantSessionId,
      writebackStatus: approvalResult.writeback_status,
      approvedChapterId: approvalResult.approved_chapter_id,
      repairPatchId: request.body.repair_patch_id,
      scenePacketId: request.body.scene_packet_id,
      summary: approvalResult.continuity_update_summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return dependencies.redirect(
      buildApprovalResultUrl(
        { writeback_status: '提交失败', unavailable_reason: message },
        resultTarget,
      ),
    );
  }

  dependencies.revalidatePath('/studio');
  if (resultTarget.pathname === '/') {
    dependencies.revalidatePath('/');
  }
  return dependencies.redirect(buildApprovalResultUrl(approvalResult, resultTarget));
}
