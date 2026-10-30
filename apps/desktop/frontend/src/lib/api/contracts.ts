/**
 * 引擎与界面之间交换的数据形状。原先由后端 OpenAPI 快照生成，后端移除时（2026-10，P6-4）按最后一份
 * 快照冻结在这里；改字段就是改契约，引擎与界面要一起改。
 */

/**
 * @description Agent Runtime 的只读角色目录，用于 Root Agent 调度和权限边界判断。
 */
export type ApiAgentRoleRead = {
  aliases: string[];
  allowed_tools: string[];
  can_be_mentioned: boolean;
  default_permission_profile: string;
  description: string;
  display_name: string;
  kind: string;
  name: string;
  output_artifacts: string[];
  read_only: boolean;
};

export type ApiAssistantContextBundle = {
  budget?: {
    [key: string]: unknown;
  } | null;
  current_file: string;
  files?: ApiAssistantContextBundleFile[];
  project_root: string;
  summary?: {
    [key: string]: unknown;
  };
};

export type ApiAssistantContextBundleFile = {
  excerpt: string;
  kind: string;
  path: string;
  relative_path: string;
  title: string;
};

export type ApiChapterCheckHistoryQuery = {
  assistant_session_id: number;
  /**
   * @default 20
   */
  limit: number;
  project_root: string;
};

export type ApiKnowledgeConflictEntryRead = {
  claim: string;
  evidence_state: string;
  knowledge_id: string;
  relative_path: string;
  sources: ApiKnowledgeProposalSourceRead[];
  status: string;
  title: string;
};

export type ApiKnowledgeProposalGroup = {
  artifact_id: number;
  created_at: string;
  proposal_group_id: string;
  proposals: ApiKnowledgeProposalItem[];
  revision: number;
  run_id: string;
  state: string;
};

export type ApiKnowledgeProposalInbox = {
  items: ApiKnowledgeProposalGroup[];
  pending_count: number;
};

export type ApiKnowledgeProposalItemEdit = {
  claim: string;
  confidence: string;
  kind: string;
  operation: string;
  reason: string;
  related_knowledge_ids?: string[];
  sources: ApiKnowledgeProposalSourceEdit[];
  target_path: string;
  title: string;
};

export type ApiKnowledgeProposalItem = {
  claim: string;
  claim_fingerprint: string;
  confidence: string;
  conflicts?: ApiKnowledgeConflictEntryRead[];
  kind: string;
  knowledge_id: string;
  operation: string;
  proposal_id: string;
  reason: string;
  related_knowledge_ids: string[];
  sources: ApiKnowledgeProposalSourceRead[];
  state: string;
  target_path: string;
  title: string;
};

export type ApiKnowledgeProposalPatch = {
  after: string;
  artifact_id: number;
  author_confirmation_event_id: string;
  baseline_hash: string;
  before: string;
  created_by_tool: string;
  file_path: string;
  id: string;
  kind: string;
  knowledge_id: string;
  patch_class: string;
  proposal_id: string;
  proposal_revision: number;
  relative_path: string;
  requires_confirmation: boolean;
};

export type ApiKnowledgeProposalResolveRequest = {
  artifact_id: number;
  author_confirmation_event_id?: string | null;
  patch_identity?: string | null;
  project_root: string;
  proposal_id: string;
  /**
   * @enum {string}
   */
  resolution: 'accepted' | 'rejected';
  revision: number;
};

export type ApiKnowledgeProposalSourceEdit = {
  locator?: string | null;
  path?: string | null;
  summary?: string | null;
  summary_sha256?: string | null;
  title?: string | null;
  type: string;
};

export type ApiKnowledgeProposalSourceRead = {
  accessed_at?: string | null;
  agent_event_id?: string | null;
  content_sha256?: string | null;
  locator?: string | null;
  path?: string | null;
  summary_sha256?: string | null;
  title?: string | null;
  type: string;
};

/**
 * @description 探测后端实际使用的模型服务连通性（resolved_llm_env），仅用于诊断展示，绝不回显凭据。
 */
export type ApiProviderHealthResponse = {
  base_url?: string | null;
  detail?: string | null;
  latency_ms?: number | null;
  missing_env?: string[];
  model?: string | null;
  model_count?: number | null;
  models?: string[];
  reachable: boolean;
  /**
   * @enum {string}
   */
  status: 'ok' | 'unreachable' | 'unauthorized' | 'misconfigured';
};

/**
 * @description 一次 AI 运行的模型用量（批量写章记账用，引擎 runUsage）。服务商没报、按字数估的那几次已按每字 1.5 个
 * token 换算；没拿到用量的请求不计入 tokens，只计次数。
 */
export type ApiRunUsage = {
  calls: number;
  estimated_calls: number;
  run_id: string;
  tokens: number;
  unknown_calls: number;
};

export type ApiWriteBatchBlocker = {
  chapters: number[];
  /**
   * @enum {string}
   */
  code:
    | 'read_only'
    | 'invalid_range'
    | 'gap_before_start'
    | 'chapter_blocked'
    | 'missing_goal'
    | 'target_unavailable'
    | 'setup_incomplete'
    | 'nothing_to_write'
    | 'batch_running'
    | 'previous_batch_unreviewed';
  message: string;
};

export type ApiWriteBatchChapter = {
  goal: string | null;
  ordinal: number;
  /**
   * @enum {string}
   */
  status: 'write' | 'skip_written' | 'after_trial';
  target_path: string;
  title: string | null;
  written_path: string | null;
};

export type ApiWriteBatchEstimate = {
  average_tokens: number;
  cap_tokens: number;
  chapter_count: number;
  estimated_calls: number;
  estimated_tokens: number;
  max_tokens: number;
  min_tokens: number;
  sample_count: number;
  unknown_calls: number;
};

/**
 * @description `/写 a-b` 批量写章的计划（引擎 planWriteBatch）：范围内每章写不写、写到哪个文件，不能开跑的原因，
 * 以及按本作品写章记录给的预估与上限；没有记录时是试写模式，只排第一章、不给预估。
 */
export type ApiWriteBatchPlan = {
  /**
   * @enum {string}
   */
  basis: 'history' | 'trial' | null;
  blockers: ApiWriteBatchBlocker[];
  can_start: boolean;
  chapters: ApiWriteBatchChapter[];
  estimate: ApiWriteBatchEstimate | null;
  from: number;
  note: string | null;
  /**
   * @enum {string}
   */
  permission_profile: 'read' | 'ask' | 'auto' | 'full';
  project_root: string;
  to: number;
};

/**
 * @description 批量写章停下的原因（引擎 nextWriteBatchStep 判定；最后三个由界面经 stopWriteBatch 送来）。
 */
export type ApiWriteBatchStopCode =
  | 'run_failed'
  | 'run_stopped'
  | 'check_blocked'
  | 'no_revision'
  | 'needs_confirmation'
  | 'writeback_blocked'
  | 'fact_disputes'
  | 'read_only'
  | 'model_changed'
  | 'cap_reached'
  | 'trial_done'
  | 'author_stopped'
  | 'app_closed'
  | 'run_not_started';

export type ApiWriteBatchStop = {
  code: ApiWriteBatchStopCode;
  message: string;
  ordinal: number | null;
};

export type ApiWriteBatchLegRun = {
  ordinal: number;
  run_id: string;
  tokens: number;
};

/**
 * @description 批量里开跑或续跑的一段：续跑重新估、重新给上限，所以上限按段算；试写段没有预估与上限。
 */
export type ApiWriteBatchLeg = {
  /**
   * @enum {string}
   */
  basis: 'history' | 'trial';
  cap_tokens: number | null;
  estimated_tokens: number | null;
  runs: ApiWriteBatchLegRun[];
  started_at: string;
  used_tokens: number;
};

export type ApiWriteBatchCheck = {
  issue_count: number;
  summary: string;
  /**
   * @enum {string}
   */
  verdict: 'pass' | 'repairable' | 'blocked' | 'unchecked';
};

/**
 * @description 批量里一章的结果。written_sha256 / chars / tokens / check 由引擎算；snapshot_version 与 facts_before
 * 是界面送来、引擎原样存的（撤销用）。
 */
export type ApiWriteBatchRecordChapter = {
  chars: number | null;
  check: ApiWriteBatchCheck | null;
  fact_disputes: number | null;
  facts_before: string | null;
  ordinal: number;
  run_id: string | null;
  snapshot_version: string | null;
  /**
   * @enum {string}
   */
  state: 'pending' | 'written' | 'stopped_here' | 'skipped_written' | 'after_trial';
  target_path: string;
  tokens: number | null;
  written_sha256: string | null;
};

/**
 * @description 最近一批批量写章的记录（`.storyforge/write-batch.json`）。是记录不是真值：哪章写没写以正文为准。
 */
export type ApiWriteBatch = {
  chapters: ApiWriteBatchRecordChapter[];
  created_at: string;
  from: number;
  id: string;
  legs: ApiWriteBatchLeg[];
  model_key: string;
  reviewed: boolean;
  /**
   * @enum {string}
   */
  status: 'running' | 'stopped' | 'finished';
  stop: ApiWriteBatchStop | null;
  to: number;
  version: number;
};

/**
 * @description 开跑 / 续跑的结果：没开成时 plan 里写着原因，batch 是没动过的最近一批（没有为 null）。
 */
export type ApiWriteBatchStartResult =
  | { batch: ApiWriteBatch; plan: ApiWriteBatchPlan; started: true }
  | { batch: ApiWriteBatch | null; plan: ApiWriteBatchPlan; started: false };

/**
 * @description 引擎判定的下一步：写哪一章，还是停、为什么停，或者这一批写完了。
 */
export type ApiWriteBatchStep =
  | { action: 'write'; goal: string | null; ordinal: number; target_path: string }
  | { action: 'stop'; code: ApiWriteBatchStopCode; message: string; ordinal: number | null }
  | { action: 'finished' };

export type ApiWriteBatchMismatch = {
  /**
   * @enum {string}
   */
  kind: 'missing' | 'changed' | 'written_outside';
  message: string;
  ordinal: number;
};

/**
 * @description 读最近一批：记录本身，加上记录与正文对不上的章（以正文为准）。
 */
export type ApiWriteBatchView = {
  batch: ApiWriteBatch | null;
  mismatches: ApiWriteBatchMismatch[];
};

export type ApiWriteBatchRecovery = {
  batch: ApiWriteBatch | null;
  recovered: boolean;
};
