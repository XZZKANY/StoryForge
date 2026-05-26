import type {
  StudioApprovalSummaryState,
  StudioBookListItem,
  StudioBookListState,
  StudioChapterGoalState,
  StudioJudgeReviewState,
  StudioRepairPatch,
  StudioRecoverySummaryState,
  StudioRepairPatchState,
  StudioScenePacket,
  StudioScenePacketState,
  StudioTarget,
} from './types';
import { readJson } from '../../lib/api-client';
import {
  isStudioApprovalSummary,
  isStudioChapterGoal,
  isStudioJudgeReview,
  isStudioRecoverySummary,
  isStudioRepairPatch,
  isStudioScenePacket,
} from './validators';

export const generationChain = [
  '作品选择',
  '章节目标',
  '检索素材证据',
  '生成 Scene Packet',
  'Judge 评审',
  'Repair 修订',
  '批准回写',
  '失败恢复',
];

export const studioBooksEndpoint = '/api/studio/books';
export const studioChapterGoalsEndpoint = '/api/studio/chapter-goals';
export const studioScenePacketsEndpoint = '/api/studio/scene-packets';
export const studioJudgeReviewsEndpoint = '/api/studio/judge-reviews';
export const studioRepairPatchesEndpoint = '/api/studio/repair-patches';
export const studioApprovalSummaryEndpoint = '/api/studio/approval-summary';
export const studioApproveEndpoint = '/api/studio/approve';
export const studioRecoverySummaryEndpoint = '/api/studio/recovery-summary';

export function getStudioTarget(book: StudioBookListItem | undefined): StudioTarget | undefined {
  if (!book) {
    return undefined;
  }
  return { book_id: book.id, target_ordinal: book.recent_chapter_ordinal ?? 1 };
}

export async function readStudioBooks(): Promise<StudioBookListState> {
  const result = await readJson<StudioBookListItem[]>(studioBooksEndpoint, {
    validate: Array.isArray,
    invalidMessage: '作品列表 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', books: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '作品列表 API 返回') };
}

export async function readStudioChapterGoal(
  target: StudioTarget | undefined,
): Promise<StudioChapterGoalState> {
  if (!target) {
    return { status: 'idle', message: '读取章节目标需要先获得作品列表。' };
  }

  const result = await readJson(studioChapterGoalsEndpoint, {
    params: { book_id: target.book_id, target_ordinal: target.target_ordinal },
    validate: isStudioChapterGoal,
    invalidMessage: '章节目标 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', goal: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '章节目标 API 返回') };
}

export async function readStudioScenePacket(
  target: StudioTarget | undefined,
): Promise<StudioScenePacketState> {
  if (!target) {
    return { status: 'idle', message: '读取 Scene Packet 需要先获得作品列表。' };
  }

  const result = await readJson(studioScenePacketsEndpoint, {
    params: { book_id: target.book_id, target_ordinal: target.target_ordinal },
    validate: isStudioScenePacket,
    invalidMessage: 'Scene Packet API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', packet: result.data }
    : { status: 'error', message: result.message.replace('API 返回', 'Scene Packet API 返回') };
}

export async function readStudioJudgeReview(
  scenePacketState: StudioScenePacketState,
): Promise<StudioJudgeReviewState> {
  if (scenePacketState.status !== 'ready') {
    return { status: 'idle', message: '读取 Judge 评审需要先获得 Scene Packet。' };
  }

  const result = await readJson(studioJudgeReviewsEndpoint, {
    params: { scene_packet_id: scenePacketState.packet.scene_packet_id },
    validate: isStudioJudgeReview,
    invalidMessage: 'Judge 评审 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', review: result.data }
    : { status: 'error', message: result.message.replace('API 返回', 'Judge 评审 API 返回') };
}

export async function readStudioRepairPatches(
  scenePacketState: StudioScenePacketState,
): Promise<StudioRepairPatchState> {
  if (scenePacketState.status !== 'ready') {
    return { status: 'idle', message: '读取 Repair 修订需要先获得 Judge 评审。' };
  }

  const result = await readJson(studioRepairPatchesEndpoint, {
    params: { scene_packet_id: scenePacketState.packet.scene_packet_id },
    validate: isStudioRepairPatchList,
    invalidMessage: 'Repair 修订 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', patches: result.data }
    : { status: 'error', message: result.message.replace('API 返回', 'Repair 修订 API 返回') };
}

export async function readStudioApprovalSummary(
  scenePacketState: StudioScenePacketState,
  repairPatchState: StudioRepairPatchState,
): Promise<StudioApprovalSummaryState> {
  if (repairPatchState.status === 'ready' && repairPatchState.patches.length > 0) {
    return readStudioApprovalSummaryByQuery('repair_patch_id', repairPatchState.patches[0].id);
  }
  if (scenePacketState.status === 'ready') {
    return readStudioApprovalSummaryByQuery(
      'scene_packet_id',
      scenePacketState.packet.scene_packet_id,
    );
  }
  return { status: 'idle', message: '读取批准回写摘要需要先获得 Repair 修订或 Scene Packet。' };
}

export async function readStudioApprovalSummaryByQuery(
  key: 'scene_packet_id' | 'repair_patch_id',
  value: number,
): Promise<StudioApprovalSummaryState> {
  const result = await readJson(studioApprovalSummaryEndpoint, {
    params: { [key]: value },
    validate: isStudioApprovalSummary,
    invalidMessage: '批准回写摘要 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', summary: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '批准回写摘要 API 返回') };
}

export async function readStudioRecoverySummary(
  scenePacketState: StudioScenePacketState,
): Promise<StudioRecoverySummaryState> {
  if (scenePacketState.status !== 'ready') {
    return { status: 'idle', message: '读取失败恢复摘要需要先获得 Scene Packet 中的任务线索。' };
  }

  const jobRunId = getJobRunIdFromScenePacket(scenePacketState.packet);
  if (jobRunId === undefined) {
    return {
      status: 'idle',
      message: '当前 Scene Packet 未提供 job_run_id，暂不读取失败恢复摘要。',
    };
  }

  const result = await readJson(studioRecoverySummaryEndpoint, {
    params: { job_run_id: jobRunId },
    validate: isStudioRecoverySummary,
    invalidMessage: '失败恢复摘要 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', summary: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '失败恢复摘要 API 返回') };
}

function getJobRunIdFromScenePacket(packet: StudioScenePacket): number | undefined {
  return packet.job_run_id ?? undefined;
}

function isStudioRepairPatchList(value: unknown): value is StudioRepairPatch[] {
  return Array.isArray(value) && value.every(isStudioRepairPatch);
}
