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
