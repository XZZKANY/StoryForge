import type { ApiResponseSchema } from '../../lib/api-client';

export type StudioBookListItem = ApiResponseSchema<'StudioBookListItem'>;

export type StudioBookListState =
  | { readonly status: 'ready'; readonly books: readonly StudioBookListItem[] }
  | { readonly status: 'error'; readonly message: string };

export type StudioTarget = {
  readonly book_id: number;
  readonly target_ordinal: number;
};

export type StudioChapterGoal = ApiResponseSchema<'StudioChapterGoalRead'>;

export type StudioChapterGoalState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly goal: StudioChapterGoal }
  | { readonly status: 'error'; readonly message: string };

export type StudioScenePacket = ApiResponseSchema<'StudioScenePacketRead'>;

export type StudioScenePacketState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly packet: StudioScenePacket }
  | { readonly status: 'error'; readonly message: string };

export type StudioJudgeIssue = ApiResponseSchema<'StudioJudgeIssueRead'>;
export type StudioJudgeReview = ApiResponseSchema<'StudioJudgeReviewRead'>;

export type StudioJudgeReviewState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly review: StudioJudgeReview }
  | { readonly status: 'error'; readonly message: string };

export type StudioRepairPatch = ApiResponseSchema<'StudioRepairPatchRead'>;

export type StudioRepairPatchState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly patches: readonly StudioRepairPatch[] }
  | { readonly status: 'error'; readonly message: string };

export type StudioApprovalSummary = ApiResponseSchema<'StudioApprovalSummaryRead'>;

export type StudioApprovalSummaryState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly summary: StudioApprovalSummary }
  | { readonly status: 'error'; readonly message: string };

export type StudioApprovalExecuteResult = ApiResponseSchema<'StudioApprovalExecuteRead'>;
export type StudioRecoverySummary = ApiResponseSchema<'StudioRecoverySummaryRead'>;

export type StudioRecoverySummaryState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly summary: StudioRecoverySummary }
  | { readonly status: 'error'; readonly message: string };
