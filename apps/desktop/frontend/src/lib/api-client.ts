/**
 * 桌面端 StoryForge API client
 * Tauri 运行时优先从 Rust 主进程读取本地 API 配置；浏览器预览退回 Vite env。
 */

export {
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
export { getAgentRunSavePoints } from './api/agent-runs';
export {
  getAssistantSession,
  listAgentRoles,
  listAssistantSessions,
  probeProviderHealth,
} from './api/assistant';
export { requestCrossChapterConsistency } from './api/cross-chapter';
export { executeIdeCommand } from './api/ide-commands';
export { toAssistantContextBundlePayload } from './api/codecs';
export { getApiConfig } from './api/config';
export { probeApiRuntimeHealth } from './api/runtime-health';
export { subscribeBookRunEvents, subscribeWritingRunEvents } from './api/run-events';
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
  AgentRunSavePoint,
  AgentRunSavePointProjection,
  AgentSocketMessage,
  AgentStepEventMessage,
  AgentStreamEventMessage,
  AgentToolTrace,
  AgentToolTraceEventMessage,
  AgentUserMessageRequest,
  ApiRuntimeHealth,
  ApiRuntimeHealthStatus,
  AssistantContextBundlePayload,
  AssistantMessageRecord,
  AssistantSessionRecord,
  BookRunEvent,
  CrossChapterFinding,
  CrossChapterRequest,
  CrossChapterResult,
  ReviseRequest,
  ReviseResult,
  WritingRunEvent,
  WritingRunHandle,
} from './api/types';
