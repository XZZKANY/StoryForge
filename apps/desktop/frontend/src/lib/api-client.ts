/**
 * 桌面端 StoryForge API client
 * Tauri 运行时优先从 Rust 主进程读取本地 API 配置；浏览器预览退回 Vite env。
 */

export {
  DEFAULT_AGENT_TIMEOUT_MS,
  isAgentControlAckMessage,
  isAgentErrorMessage,
  isAgentPermissionRequiredMessage,
  isAgentResultMessage,
  isAgentRunStartedMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
  sendAgentControlMessage,
  sendAgentUserMessage,
} from './api/agent-socket';
export { getAgentRunEvents, getAgentRunSavePoints } from './api/agent-runs';
export {
  getAssistantSession,
  getAssistantSessionFailedTurns,
  listAssistantSessions,
  probeProviderHealth,
  renameAssistantSession,
  reviseFileContent,
} from './api/assistant';
export type { AssistantReviseResult } from './api/assistant';
export { requestCrossChapterConsistency } from './api/cross-chapter';
export { executeIdeCommand } from './api/ide-commands';
export { toAssistantContextBundlePayload } from './api/codecs';
export type {
  AgentControlAckMessage,
  AgentControlMessageRequest,
  AgentControlMessageType,
  AgentErrorMessage,
  AgentPermissionRequiredMessage,
  AgentPlanStep,
  AgentProposedPatch,
  AgentResultMessage,
  AgentRunStartedMessage,
  AgentRunWaitingMessage,
  AgentRunSavePoint,
  AgentRunSavePointProjection,
  AgentSocketMessage,
  AgentStepEventMessage,
  AgentStreamEventMessage,
  AgentToolTrace,
  AgentToolTraceEventMessage,
  AgentUserMessageRequest,
  AssistantContextBundlePayload,
  AssistantMessageRecord,
  AssistantFailedTurnRecord,
  AssistantSessionRecord,
  CrossChapterFinding,
  CrossChapterRequest,
  CrossChapterResult,
} from './api/types';
