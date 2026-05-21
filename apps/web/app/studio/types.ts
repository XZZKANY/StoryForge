export type StudioBookListItem = {
  readonly id: number;
  readonly title: string;
  readonly recent_chapter_ordinal: number | null;
};

export type StudioBookListState =
  | { readonly status: "ready"; readonly books: readonly StudioBookListItem[] }
  | { readonly status: "error"; readonly message: string };

export type StudioTarget = {
  readonly book_id: number;
  readonly target_ordinal: number;
};

export type StudioChapterGoal = {
  readonly book_id: number;
  readonly target_chapter_id: number;
  readonly target_chapter_ordinal: number;
  readonly target_chapter_title: string;
  readonly chapter_goal: string;
  readonly previous_chapter_summary: string | null;
  readonly continuity_constraints: readonly string[];
};

export type StudioChapterGoalState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly goal: StudioChapterGoal }
  | { readonly status: "error"; readonly message: string };

export type StudioScenePacket = {
  readonly book_id: number;
  readonly target_chapter_ordinal: number;
  readonly scene_id: number;
  readonly scene_packet_id: number;
  readonly job_run_id: number | null;
  readonly status: string;
  readonly chapter_goal: string | null;
  readonly evidence_count: number;
  readonly compiled_context_id: string | null;
  readonly budget_summary: Record<string, unknown>;
};

export type StudioScenePacketState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly packet: StudioScenePacket }
  | { readonly status: "error"; readonly message: string };

export type StudioJudgeIssue = {
  readonly id: number;
  readonly category: string;
  readonly severity: string;
  readonly summary: string;
  readonly span_start: number;
  readonly span_end: number;
  readonly recommended_repair_mode: string;
};

export type StudioJudgeReview = {
  readonly scene_packet_id: number;
  readonly status: string;
  readonly issue_count: number;
  readonly highest_severity: string | null;
  readonly score: number;
  readonly issues: readonly StudioJudgeIssue[];
};

export type StudioJudgeReviewState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly review: StudioJudgeReview }
  | { readonly status: "error"; readonly message: string };

export type StudioRepairPatch = {
  readonly id: number;
  readonly issue_id: number;
  readonly status: string;
  readonly target_span: string;
  readonly replacement_text: string;
  readonly reason: string;
  readonly requires_rejudge: boolean;
};

export type StudioRepairPatchState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly patches: readonly StudioRepairPatch[] }
  | { readonly status: "error"; readonly message: string };

export type StudioApprovalSummary = {
  readonly can_approve: boolean;
  readonly approvable_object: { readonly object_type: string; readonly id: number; readonly status: string; readonly scene_id: number } | null;
  readonly target_chapter: { readonly id: number; readonly ordinal: number; readonly title: string; readonly status: string } | null;
  readonly writeback_status: string;
  readonly unavailable_reason: string | null;
};

export type StudioApprovalSummaryState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly summary: StudioApprovalSummary }
  | { readonly status: "error"; readonly message: string };

export type StudioApprovalExecuteResult = {
  readonly writeback_status: string;
  readonly approved_chapter_id: number | null;
  readonly continuity_update_summary: string | null;
  readonly unavailable_reason: string | null;
};

export type StudioRecoverySummary = {
  readonly can_recover: boolean;
  readonly failed_node: string | null;
  readonly checkpoint: Record<string, unknown> | null;
  readonly recoverable_steps: readonly string[];
  readonly error_summary: string | null;
  readonly unrecoverable_reason: string | null;
};

export type StudioRecoverySummaryState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "ready"; readonly summary: StudioRecoverySummary }
  | { readonly status: "error"; readonly message: string };
