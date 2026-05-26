import type { ApiFetchInit } from '../../lib/api-client';

import type { StudioApprovalExecuteResult } from './types';
import { isStudioApprovalExecuteResult } from './validators';

export type StudioApprovalRequestBody = {
  readonly scene_packet_id?: number;
  readonly repair_patch_id?: number;
};

export type ApprovalRequestBuildResult =
  | { readonly status: 'ready'; readonly body: StudioApprovalRequestBody }
  | { readonly status: 'invalid'; readonly redirectUrl: string };

export type StudioApprovalSubmitDependencies = {
  readonly endpoint: string;
  readonly apiFetch: (path: string, init: ApiFetchInit) => Promise<Response>;
  readonly revalidatePath: (path: string) => void;
  readonly redirect: (url: string) => never;
};

function getRequiredFormValue(
  formData: FormData,
  key: 'scene_packet_id' | 'repair_patch_id',
): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function buildApprovalResultUrl(payload: Partial<StudioApprovalExecuteResult>): string {
  const params = new URLSearchParams();
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
  return `/studio?${params.toString()}`;
}

export function buildApprovalRequestBody(formData: FormData): ApprovalRequestBuildResult {
  const scenePacketId = getRequiredFormValue(formData, 'scene_packet_id');
  const repairPatchId = getRequiredFormValue(formData, 'repair_patch_id');

  if (scenePacketId !== undefined && repairPatchId !== undefined) {
    return {
      status: 'invalid',
      redirectUrl: buildApprovalResultUrl({
        writeback_status: '未执行',
        unavailable_reason: 'Scene Packet ID 与 Repair Patch ID 只能提供一个。',
      }),
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
    redirectUrl: buildApprovalResultUrl({
      writeback_status: '未执行',
      unavailable_reason: '需要提供 Scene Packet ID 或 Repair Patch ID。',
    }),
  };
}

export async function submitStudioApproval(
  formData: FormData,
  dependencies: StudioApprovalSubmitDependencies,
): Promise<never> {
  const request = buildApprovalRequestBody(formData);
  if (request.status === 'invalid') {
    return dependencies.redirect(request.redirectUrl);
  }

  try {
    const response = await dependencies.apiFetch(dependencies.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
    });
    if (!response.ok) {
      return dependencies.redirect(
        buildApprovalResultUrl({
          writeback_status: '提交失败',
          unavailable_reason: `批准写回 API 返回 ${response.status}`,
        }),
      );
    }
    const payload: unknown = await response.json();
    if (!isStudioApprovalExecuteResult(payload)) {
      return dependencies.redirect(
        buildApprovalResultUrl({
          writeback_status: '提交失败',
          unavailable_reason: '批准写回 API 返回格式不符合预期',
        }),
      );
    }
    dependencies.revalidatePath('/studio');
    return dependencies.redirect(buildApprovalResultUrl(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return dependencies.redirect(
      buildApprovalResultUrl({ writeback_status: '提交失败', unavailable_reason: message }),
    );
  }
}
