import type { ApiAssistantContextBundle } from './contracts';
import type {
  AgentRunStartedFrame,
  AgentStepFrame,
  ControlAckFrame,
  PermissionRequiredFrame,
  ToolTraceFrame,
} from './generated/agent-ws';

export type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

export type ApiRuntimeHealthStatus = 'ready' | 'degraded' | 'unreachable';

export type ApiRuntimeHealth = {
  status: ApiRuntimeHealthStatus;
  reachable: boolean;
  baseUrl: string;
  latencyMs: number | null;
  checks: Record<string, string>;
  detail: string | null;
};

export type ReviseRequest = {
  filePath: string;
  content: string;
  instruction: string;
  projectName?: string | null;
  assistantSessionId?: number | null;
  contextBundle?: {
    projectRoot: string;
    currentFile: string | null;
    files: Array<{
      path: string;
      relativePath: string;
      kind: string;
      title: string;
      excerpt: string;
    }>;
    summary: {
      hasStoryStructure: boolean;
      counts: Record<string, number>;
    };
    budget?: {
      fileCount: number;
      charCount: number;
      maxFiles: number;
      maxExcerptChars: number;
      truncated: boolean;
      pinnedFileCount: number;
      missingPinnedFiles: string[];
    };
  } | null;
};

export type AssistantContextBundlePayload = Omit<ApiAssistantContextBundle, 'current_file'> & {
  current_file?: string | null;
};

export type CrossChapterChapterInput = {
  name: string;
  content: string;
};

export type CrossChapterRequest = {
  chapters: CrossChapterChapterInput[];
  focus?: string | null;
};

export type CrossChapterFinding = {
  type: string;
  severity: string;
  chapters: string[];
  finding: string;
  evidence: string;
};

export type CrossChapterResult = {
  findings: CrossChapterFinding[];
  model: string | null;
  latencyMs: number | null;
};

export type AgentPlanStep = {
  step: string;
  detail: string;
  status: string;
};

export type AgentToolTrace = {
  tool_name: string;
  status: string;
  input_summary: Record<string, unknown>;
  output_summary?: Record<string, unknown>;
  audit_event_id?: string;
  assistant_tool_call_id?: number;
  error_message?: string;
};

export type AgentProposedPatch =
  | {
      id?: string;
      kind: 'file_revision';
      file_path: string;
      before: string;
      after: string;
      requires_confirmation: boolean;
      approval_action: string;
    }
  | {
      kind: 'repair_patch';
      repair_patch: Record<string, unknown>;
      requires_confirmation: boolean;
      approval_command?: {
        command_id: string;
        args: Record<string, unknown>;
      } | null;
    }
  | Record<string, unknown>;

export type WritingRunHandle = {
  writing_run_id: number;
  scope: string;
  mode: string;
  status: string;
  book_run_id?: number | null;
  book_run?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AgentResultMessage = {
  type: 'agent_result';
  session_id: string;
  run_id?: string;
  assistant_session_id: number;
  intent: string;
  user_message: string;
  plan: AgentPlanStep[];
  agent_result: {
    summary?: string;
    requires_user_confirmation?: boolean;
    writing_run?: WritingRunHandle | null;
    writing_run_id?: number | null;
    book_run?: Record<string, unknown> | null;
    book_run_id?: number | null;
    [key: string]: unknown;
  };
  tool_trace: AgentToolTrace[];
  proposed_patch?: AgentProposedPatch | null;
  system_jobs?: {
    title?: {
      title?: string;
      updated_session_title?: boolean;
      [key: string]: unknown;
    };
    summary?: Record<string, unknown>;
    compaction?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

export type AgentErrorMessage = {
  type: 'error';
  session_id: string;
  run_id?: string;
  detail: string;
};

type WithFrontendAgentPatch<Frame extends { proposed_patch: unknown }> = Omit<
  Frame,
  'proposed_patch'
> & {
  proposed_patch: AgentProposedPatch | null;
};

export type AgentRunStartedMessage = AgentRunStartedFrame;

export type AgentStepEventMessage = Omit<
  AgentStepFrame,
  'assistant_session_id' | 'step' | 'detail' | 'status'
> & {
  assistant_session_id?: number | null;
  step: string;
  detail: string;
  status: string;
};

export type AgentToolTraceEventMessage = Omit<
  AgentToolTraceEventMessageFrame,
  'assistant_session_id' | 'trace'
> & {
  assistant_session_id?: number | null;
  trace: AgentToolTrace;
};

type AgentToolTraceEventMessageFrame = ToolTraceFrame;

export type AgentPermissionRequiredMessage = WithFrontendAgentPatch<
  Omit<PermissionRequiredFrame, 'assistant_session_id'> & {
    assistant_session_id?: number | null;
  }
>;

export type AgentControlMessageType =
  | 'approve_permission'
  | 'deny_permission'
  | 'pause_run'
  | 'resume_run'
  | 'stop_run'
  | 'retry_from_checkpoint';

export type AgentControlAckMessage = ControlAckFrame & {
  resumed_result?: AgentResultMessage;
  resume_diagnostic?: Record<string, unknown>;
};

export type AgentStreamEventMessage =
  | AgentRunStartedMessage
  | AgentStepEventMessage
  | AgentToolTraceEventMessage
  | AgentPermissionRequiredMessage
  | AgentControlAckMessage;

export type AgentSocketMessage =
  | AgentResultMessage
  | AgentErrorMessage
  | AgentStreamEventMessage
  | {
      type: string;
      [key: string]: unknown;
    };

export type AgentUserMessageRequest = {
  sessionId: string;
  userMessage: string;
  assistantSessionId?: number | null;
  intent?: string;
  args?: Record<string, unknown>;
  agentRoleHints?: string[];
  agentRoleMentions?: string[];
  timeoutMs?: number;
  stream?: boolean;
  runId?: string;
  onEvent?: (event: AgentSocketMessage) => void;
};

export type AgentControlMessageRequest = {
  sessionId: string;
  runId: string;
  type: AgentControlMessageType;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
};

export type AgentRunSavePoint = {
  kind: string;
  source: 'event' | 'artifact' | string;
  event_id?: number;
  event_type?: string;
  sequence?: number;
  artifact_id?: number;
  artifact_kind?: string;
  requires_confirmation?: boolean;
  summary: Record<string, unknown>;
};

export type AgentRunSavePointProjection = {
  run_id: string;
  status: string;
  current_step?: string | null;
  save_points: AgentRunSavePoint[];
  pending: Record<string, unknown>;
  recoverability: Record<string, unknown>;
  runtime_recovery: Record<string, unknown>;
  interruption_model: Record<string, unknown>;
};

export type BookRunEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type WritingRunEvent = BookRunEvent;

export type AssistantMessageRecord = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  updated_at: string;
};

export type AssistantSessionRecord = {
  id: number;
  title: string;
  task_type: string;
  project_path: string | null;
  blueprint_id: number | null;
  book_run_id: number | null;
  artifact_id: number | null;
  messages: AssistantMessageRecord[];
  created_at: string;
  updated_at: string;
};
