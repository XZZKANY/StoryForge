import type {
  AgentControlMessageType,
  AgentResultMessage,
  AgentToolTrace,
} from '../../lib/api-client';
import type { LocalConversationAction } from '../../lib/local-conversation-action';
import type { ContextBundle, SemanticFile } from '../../lib/project-context';
import type { LayoutMode } from '../shell/useShellState';

export type ChatWindowProps = {
  projectPath: string | null;
  currentFile: string | null;
  assistantSessionId?: number | null;
  pendingInitialPrompt?: string | null;
  onPendingInitialPromptConsumed?: () => void;
  onAssistantSessionChange?: (assistantSessionId: number | null) => void;
  // Q4 布局三态：对话头就地切换编辑/平衡/对话聚焦（右栏挂载时才需要）。
  layoutMode?: LayoutMode;
  onSetLayoutMode?: (mode: LayoutMode) => void;
  // 观测镜：对话头雷达图标切到右栏第二视图（Ctrl+4 同义）。
  onOpenObservatory?: () => void;
};

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

export type AgentStep = {
  id: string;
  title: string;
  tool: string;
  status: AgentStepStatus;
  detail: string;
};

export type AgentRun = {
  id: string;
  sessionId: string;
  goal: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  steps: AgentStep[];
};

export type RetryRequest = {
  goal: string;
  action: LocalConversationAction;
  intent?: 'file.revise';
};

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
  onStopRun: () => void;
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

export type StableAgentRequestPayload = {
  project_path: string;
  current_file?: string;
  file_path?: string;
  content?: string;
  instruction: string;
  context?: string;
  selection?: string;
  project_name: string | null;
  assistant_session_id: number | null;
  context_bundle: ReturnType<typeof import('../../lib/api-client').toAssistantContextBundlePayload>;
  review_report?: ReviewReport;
  selected_issue_ids?: string[];
  included_categories?: ReviewCategory[];
};

export type FileRevisionPatch = {
  id?: string;
  file_path: string;
  before: string;
  after: string;
};

export type ChatWindowAgentResult = AgentResultMessage;
export type ChatWindowAgentToolTrace = AgentToolTrace;
export type ChatWindowAgentControlMessageType = AgentControlMessageType;
export type ChatWindowSemanticFile = SemanticFile;
