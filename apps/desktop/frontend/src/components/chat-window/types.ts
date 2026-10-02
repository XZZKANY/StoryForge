import type { AgentResultMessage, AgentToolTrace } from '../../lib/api-client';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { LocalConversationAction } from '../../lib/local-conversation-action';
import type { ContextBundle } from '../../lib/project-context';
import type { LayoutMode } from '../shell/useShellState';

export type ChatWindowProps = {
  projectPath: string | null;
  currentFile: string | null;
  assistantSessionId?: number | null;
  /** Visible Agent surface, excluding other dialogs; presentation never grants authority. */
  decisionDialogsActive?: boolean;
  pendingInitialPrompt?: string | null;
  onPendingInitialPromptConsumed?: () => void;
  onAssistantSessionChange?: (assistantSessionId: number | null) => void;
  // Q4 布局三态：对话头就地切换编辑/平衡/对话聚焦（右栏挂载时才需要）。
  layoutMode?: LayoutMode;
  onSetLayoutMode?: (mode: LayoutMode) => void;
  // 观测镜：对话头雷达图标切到右栏第二视图（Ctrl+4 同义）；
  // observatoryAttention 为 true 时雷达图标亮小紫点（光标行提到 canon 实体）。
  onOpenObservatory?: () => void;
  observatoryAttention?: boolean;
  agentPermissionProfile?: AgentPermissionProfile;
  onAgentPermissionProfileChange?: (profile: AgentPermissionProfile) => void;
  /** 将运行中的 Agent 状态投影给作品总览，避免右栏隐藏时失去可见性。 */
  onAgentRunSummaryChange?: (summary: AgentRunOverviewSummary | null) => void;
};

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

// 工具步骤的结构化指标：从 output_summary 抽出的 key-value，用小 chip 平铺，
// 免得延迟 / 上下文数 / 问题数挤在一行中文长串里难扫读（detail 仍作纯文本回退）。
export type AgentStepMetric = { label: string; value: string };

export type AgentStep = {
  id: string;
  title: string;
  tool: string;
  status: AgentStepStatus;
  detail: string;
  metrics?: AgentStepMetric[];
  filePath?: string;
  patchId?: string;
};

// paused/stopped 是作者主动控制态：暂停留有恢复入口、停止是中性收尾（非失败）。
// 与 running/waiting/completed/failed 一起构成运行状态机的全集。
export type AgentRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'paused' | 'stopped';

export type AgentRunOverviewStatus =
  | 'running'
  | 'waiting'
  | 'waiting_permission'
  | 'waiting_brief'
  | 'waiting_patch'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'busy'
  | 'session_error';

/**
 * ChatWindow owns the live run/approval state. This is a read-only projection
 * for the overview; it never carries patch payloads or control callbacks.
 */
export type AgentRunOverviewSummary = {
  projectPath: string;
  status: AgentRunOverviewStatus;
  goal: string;
  message?: string;
  retryable?: boolean;
  assistantSessionId?: number | null;
};

export type AgentRun = {
  id: string;
  sessionId: string;
  goal: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  permissionProfile?: AgentPermissionProfile;
  /** UI routing only; live authorization remains in the App-owned coordinator. */
  executionProtocol?: 'external_writeback_v1';
  executionOutcome?: AgentResultMessage['agent_result']['execution_outcome'];
  /** UI delivery uncertainty only; status is the last observed runtime state, not a new API state. */
  deliveryUnknown?: { scope: string; retryRequest: RetryRequest };
};

export type RetryRequest = {
  goal: string;
  action: LocalConversationAction;
  intent?: 'file.revise' | 'chapter.write' | 'chapter.polish';
  useMainModel?: boolean;
};

export type RunAuthorAgent = (
  goal: string,
  action?: LocalConversationAction,
  intent?: 'file.revise' | 'chapter.write' | 'chapter.polish',
  excludedKnowledgeIds?: string[],
  options?: { useMainModel?: boolean; targetFilePath?: string },
) => Promise<void>;

export type PendingRepairCommand = {
  command_id: string;
  args: Record<string, unknown>;
};

export type WritingRunProjection = {
  writingRunId: number;
  status: string;
  currentChapterIndex: number | null;
  totalChapters: number | null;
  completedCount: number | null;
  latestEvent: string;
  failureReason?: string | null;
};

export type AgentRunControlHandlers = {
  onApprovePermission: () => void;
  onDenyPermission: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onReconcileRun?: () => void;
  onStopRun: () => void;
  onConfirmChapterBrief?: (brief: ChapterBrief) => void;
  onAcceptPatch?: () => void;
  onRejectPatch?: (direction: string) => void;
};

export type ChapterBrief = {
  briefId: string;
  revision: number;
  targetPath: string;
  chapterOrdinal: number | null;
  chapterTitle: string | null;
  goal: string;
  pov: string | null;
  setting: string | null;
  requiredBeats: string[];
  forbiddenItems: string[];
  continuityConstraints: string[];
  targetCharsMin: number;
  targetCharsMax: number;
};

export type ReviewReport = Record<string, unknown>;
export type ReviewCategory = 'plot' | 'character' | 'prose' | 'continuity';
export type ReviewIssue = {
  id: string;
  category: ReviewCategory;
  severity: string;
  message: string;
  evidence: string;
  suggestedAction: string;
};

export type ContextAppendResult = {
  bundle: ContextBundle;
  missingPaths: string[];
};

/** 作者此刻的编辑器视图，逐轮随对话请求发给后端（后端解码见 loop/author_view.py）。 */
export type AuthorViewPayload = {
  file_path: string;
  cursor_line: number;
  cursor_column: number;
  selection_text: string;
};

export type StableAgentRequestPayload = {
  project_path: string;
  current_file?: string;
  file_path?: string;
  content?: string;
  instruction: string;
  style_instruction?: string;
  use_main_model?: boolean;
  author_view?: AuthorViewPayload;
  project_name: string | null;
  assistant_session_id: number | null;
  context_bundle: ReturnType<typeof import('../../lib/api-client').toAssistantContextBundlePayload>;
  review_report?: ReviewReport;
  selected_issue_ids?: string[];
  included_categories?: ReviewCategory[];
};

export type ChatWindowAgentResult = AgentResultMessage;
export type ChatWindowAgentToolTrace = AgentToolTrace;
