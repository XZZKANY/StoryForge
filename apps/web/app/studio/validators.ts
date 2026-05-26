import type {
  StudioApprovalExecuteResult,
  StudioApprovalSummary,
  StudioChapterGoal,
  StudioJudgeReview,
  StudioRecoverySummary,
  StudioRepairPatch,
  StudioScenePacket,
} from './types';

export function isStudioChapterGoal(value: unknown): value is StudioChapterGoal {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioChapterGoal>;
  return (
    typeof candidate.book_id === 'number' &&
    typeof candidate.target_chapter_id === 'number' &&
    typeof candidate.target_chapter_ordinal === 'number' &&
    typeof candidate.target_chapter_title === 'string' &&
    typeof candidate.chapter_goal === 'string' &&
    (typeof candidate.previous_chapter_summary === 'string' ||
      candidate.previous_chapter_summary === null) &&
    Array.isArray(candidate.continuity_constraints)
  );
}

export function isStudioScenePacket(value: unknown): value is StudioScenePacket {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioScenePacket>;
  return (
    typeof candidate.book_id === 'number' &&
    typeof candidate.target_chapter_ordinal === 'number' &&
    typeof candidate.scene_id === 'number' &&
    typeof candidate.scene_packet_id === 'number' &&
    (typeof candidate.job_run_id === 'number' || candidate.job_run_id === null) &&
    typeof candidate.status === 'string' &&
    (typeof candidate.chapter_goal === 'string' || candidate.chapter_goal === null) &&
    typeof candidate.evidence_count === 'number' &&
    (typeof candidate.compiled_context_id === 'string' || candidate.compiled_context_id === null) &&
    typeof candidate.budget_summary === 'object' &&
    candidate.budget_summary !== null
  );
}

export function isStudioJudgeReview(value: unknown): value is StudioJudgeReview {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioJudgeReview>;
  return (
    typeof candidate.scene_packet_id === 'number' &&
    typeof candidate.status === 'string' &&
    typeof candidate.issue_count === 'number' &&
    (typeof candidate.highest_severity === 'string' || candidate.highest_severity === null) &&
    typeof candidate.score === 'number' &&
    Array.isArray(candidate.issues)
  );
}

export function isStudioRepairPatch(value: unknown): value is StudioRepairPatch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioRepairPatch>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.issue_id === 'number' &&
    typeof candidate.status === 'string' &&
    typeof candidate.target_span === 'string' &&
    typeof candidate.replacement_text === 'string' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.requires_rejudge === 'boolean'
  );
}

export function isStudioApprovalSummary(value: unknown): value is StudioApprovalSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioApprovalSummary>;
  return (
    typeof candidate.can_approve === 'boolean' &&
    (typeof candidate.approvable_object === 'object' || candidate.approvable_object === null) &&
    (typeof candidate.target_chapter === 'object' || candidate.target_chapter === null) &&
    typeof candidate.writeback_status === 'string' &&
    (typeof candidate.unavailable_reason === 'string' || candidate.unavailable_reason === null)
  );
}

export function isStudioApprovalExecuteResult(
  value: unknown,
): value is StudioApprovalExecuteResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioApprovalExecuteResult>;
  return (
    typeof candidate.writeback_status === 'string' &&
    (typeof candidate.approved_chapter_id === 'number' || candidate.approved_chapter_id === null) &&
    (typeof candidate.continuity_update_summary === 'string' ||
      candidate.continuity_update_summary === null) &&
    (typeof candidate.unavailable_reason === 'string' || candidate.unavailable_reason === null)
  );
}

export function isStudioRecoverySummary(value: unknown): value is StudioRecoverySummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<StudioRecoverySummary>;
  return (
    typeof candidate.can_recover === 'boolean' &&
    (typeof candidate.failed_node === 'string' || candidate.failed_node === null) &&
    (typeof candidate.checkpoint === 'object' || candidate.checkpoint === null) &&
    Array.isArray(candidate.recoverable_steps) &&
    (typeof candidate.error_summary === 'string' || candidate.error_summary === null) &&
    (typeof candidate.unrecoverable_reason === 'string' || candidate.unrecoverable_reason === null)
  );
}
