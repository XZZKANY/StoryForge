import type { AgentResultMessage, AgentToolTrace } from '../../lib/api-client';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { AcceptClaim } from '../../lib/assistant-events';
import type { LocalConversationAction } from '../../lib/local-conversation-action';
import type { ContextBundle } from '../../lib/project-context';
import type { LayoutMode } from '../shell/useShellState';
import type { HandoffChapter } from '../../lib/chapter-handoff';
import type { ObservatoryPromises } from '../../lib/observations';
import type { WriteBatchGrant } from '../../lib/write-batch-grant';

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
  /** 输入框底部模型下拉在没有任何配置时打开设置。 */
  onOpenSettings?: () => void;
  /** 将运行中的 Agent 状态投影给作品总览，避免右栏隐藏时失去可见性。 */
  onAgentRunSummaryChange?: (summary: AgentRunOverviewSummary | null) => void;
  /** 后端阅读序章节与伏笔台账：新会话开场「接着写」的事实来源；不传就不开场。 */
  bookChapters?: ReadonlyArray<HandoffChapter & { estimatedChars?: number | null }> | null;
  bookPromises?: ObservatoryPromises | null;
};

export type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  stream?: {
    runId: string;
    phase: 'waiting' | 'streaming' | 'working' | 'unknown' | 'interrupted' | 'complete';
    detail?: string;
  };
};

/** UI run status does not determine whether text is an authoritative body or a diagnosis. */
export type AgentTextSettlement =
  | { kind: 'result'; content: string }
  | { kind: 'diagnostic'; detail: string };

export type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

export type AgentStep = {
  id: string;
  title: string;
  tool: string;
  status: AgentStepStatus;
  detail: string;
  /** 工具步骤行右侧的淡字（「问题 3 个」「12 秒」）；有它时行内不再显示纯文本 detail。 */
  metrics?: string[];
  /** 这一步用的模型，只进步骤行的悬停提示。 */
  model?: string;
  filePath?: string;
  patchId?: string;
  /** 这次工具调用读过的文件（引擎记的原样路径），给对话栏「上下文」列出来。 */
  sources?: string[];
  /** fs.search 的检索词 / fs.list 的子目录（根目录为空串）。 */
  lookup?: string;
  /** skill.read 读过的技能；plugin 为插件 id，作品技能为 null。 */
  skill?: SkillReadRef;
};

/** 一次 skill.read 读到的技能：作品技能的 path 是项目相对路径，插件技能是插件内路径。 */
export type SkillReadRef = { name: string; plugin: string | null; path: string | null };

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
  executionOutcome?: AgentResultMessage['agent_result']['execution_outcome'];
  /** UI delivery uncertainty only; status is the last observed runtime state, not a new API state. */
  deliveryUnknown?: { scope: string; retryRequest: RetryRequest };
  /** 前几轮模型在调工具之前说的话：回答区只留最后一轮正文，这些挪进思考过程，不随下一轮清空。 */
  notes?: AgentRunNote[];
  /** 本机发起时刻（毫秒），只给操作条显示已用时间。 */
  startedAt?: number;
  /** 作者拒绝了这次修改：引擎按契约把运行记成 failed，界面按作者的正常决定显示，不当失败。 */
  rejectedByAuthor?: boolean;
};

/** toolIndex = 这一轮开始时已经出现的工具步骤数，思考过程据此把这句话排在它之后的工具前面。 */
export type AgentRunNote = { round: number; toolIndex: number; text: string };

export type RetryRequest = {
  goal: string;
  action: LocalConversationAction;
  intent?: 'file.revise' | 'chapter.write' | 'chapter.polish';
  options: RunAuthorAgentOptions;
  excludedKnowledgeIds: string[];
  /** 首次请求的编辑器归属；undefined 表示显式新章目标，不依赖当前稿件。 */
  currentFile: string | null | undefined;
};

export type RunAuthorAgentOptions = {
  useMainModel?: boolean;
  /** 显式起草目标（如「AI 起草下一章」）：目标文件尚不存在，file_path 锚定它。 */
  targetFilePath?: string;
  /** 「写/起草下一章」：目标交连载计划回退，不刷盘不读当前稿、不带 current_file/file_path。 */
  planFallback?: boolean;
  /** 引用章等显式上下文：并入 context bundle 的 pinnedFiles，不改写作者原话。 */
  explicitContextPaths?: string[];
  /** 批量写章的一次性授权：只有调度器会带，只对这一批计划里的写章生效（`lib/write-batch-grant.ts`）。 */
  writeBatchGrant?: WriteBatchGrant;
};

/**
 * 发起的这一轮最后怎样了，给要接着往下走的调用方（批量写章调度器）用；平时的调用方不看。
 * not_dispatched：没发出去（没打开作品、AI 正忙、结果未知等）；unsettled：发出去了但这里拿不到结果
 * （中途切了会话或作品、结果未知）；settled：拿到了终态，proposal 是交给编辑器的那份修订。
 */
export type RunAuthorAgentOutcome =
  | { kind: 'not_dispatched' }
  | { kind: 'unsettled'; runId: string }
  | {
      kind: 'settled';
      runId: string;
      proposal: { patchId: string; filePath: string; requiresConfirmation: boolean } | null;
    };

export type RunAuthorAgent = (
  goal: string,
  action?: LocalConversationAction,
  intent?: 'file.revise' | 'chapter.write' | 'chapter.polish',
  excludedKnowledgeIds?: string[],
  options?: RunAuthorAgentOptions,
) => Promise<RunAuthorAgentOutcome>;

export type PendingRepairCommand = {
  command_id: string;
  args: Record<string, unknown>;
};

export type AgentRunControlHandlers = {
  onApprovePermission: () => void;
  onDenyPermission: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onReconcileRun?: () => void;
  onStopRun: () => void;
  onConfirmChapterBrief?: (brief: ChapterBrief) => void;
  /** 回报编辑器有没有接住：界面据此显示「正在写进稿子」或给出去哪里接受。 */
  onAcceptPatch?: () => AcceptClaim | void;
  /** 返回 false 表示没否掉（补丁目标还没打开、恢复记录写不进去）：对话区留着作者写的方向。 */
  onRejectPatch?: (direction: string) => void | Promise<boolean>;
};

/** 章纲按已写内容对计划做的调整：计划原句、已写原句都核对过；program 是程序补的（已死的人）。 */
export type ChapterBriefAdjustment = {
  planQuote: string;
  factQuote: string;
  adjustment: string;
  source: 'model' | 'program';
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
  /** 起草照这些写，优先于目标和节拍；作者可以逐条改回原计划。 */
  factAdjustments?: ChapterBriefAdjustment[];
  /** 章纲挑的写法 skill（`写法/` 里的名字），起草带上它们的全文；只读展示。 */
  writingSkills?: string[];
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
