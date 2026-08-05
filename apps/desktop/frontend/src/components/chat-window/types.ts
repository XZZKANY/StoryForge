import type {
  AgentControlMessageType,
  AgentResultMessage,
  AgentToolTrace,
} from '../../lib/api-client';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
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
  // 观测镜：对话头雷达图标切到右栏第二视图（Ctrl+4 同义）；
  // observatoryAttention 为 true 时雷达图标亮小紫点（光标行提到 canon 实体）。
  onOpenObservatory?: () => void;
  observatoryAttention?: boolean;
  agentPermissionProfile?: AgentPermissionProfile;
  onAgentPermissionProfileChange?: (profile: AgentPermissionProfile) => void;
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
};

// paused/stopped 是作者主动控制态：暂停留有恢复入口、停止是中性收尾（非失败）。
// 与 running/waiting/completed/failed 一起构成运行状态机的全集。
export type AgentRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'paused' | 'stopped';

export type AgentRun = {
  id: string;
  sessionId: string;
  goal: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  permissionProfile?: AgentPermissionProfile;
};

export type RetryRequest = {
  goal: string;
  action: LocalConversationAction;
  intent?: 'file.revise' | 'chapter.write';
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
  onConfirmChapterBrief?: (brief: ChapterBrief) => void;
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
  author_view?: AuthorViewPayload;
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
