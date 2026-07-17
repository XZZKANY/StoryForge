/**
 * 对话窗口容器：组合 session/context、Agent stream、run control 与展示层。
 */

import { ChatWindowView } from './chat-window/ChatWindowView';
import type { ChatWindowProps } from './chat-window/types';
import { useAgentRunControls } from './chat-window/useAgentRunControls';
import { useAgentRunRecovery } from './chat-window/useAgentRunRecovery';
import { useAgentStreamEvent } from './chat-window/useAgentStreamEvent';
import { useChatSessionContext } from './chat-window/useChatSessionContext';
import { useChatSubmission } from './chat-window/useChatSubmission';
import { useChatWindowState } from './chat-window/useChatWindowState';
import { useRunAuthorAgent } from './chat-window/useRunAuthorAgent';

export {
  filePathFromAgentResult,
  repairPatchApproval,
  resolveProposedPatchFilePath,
  shouldApplyAgentControlAck,
} from './chat-window/agent-result';
export { buildStableAgentRequestPayload } from './chat-window/request-payload';
export { buildAgentRunRecoveryDisplay } from './chat-window/recovery';
export {
  extractIssueScopeFromInstruction,
  reviewIssuesFromReport,
  scopeWarningFromAgentResult,
} from './chat-window/review';
export {
  displayFromResumeDiagnostic,
  statusFromAgentResult,
  stepsFromResumedAgentResult,
} from './chat-window/resumed-result';
export { AgentRunRecoveryPanel, WritingRunProgressPanel } from './chat-window/panels';
export { applyWritingRunEventProjection, writingRunIdFromResult } from './chat-window/writing-run';
export type { StableAgentRequestPayload } from './chat-window/types';

export function ChatWindow(props: ChatWindowProps) {
  const state = useChatWindowState(props);
  const session = useChatSessionContext(state, props);
  const recovery = useAgentRunRecovery(state, props.onAssistantSessionChange);
  const applyAgentStreamEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const runAuthorAgent = useRunAuthorAgent(
    state,
    applyAgentStreamEvent,
    recovery.updateAgentStatus,
    recovery.refreshAgentRunRecovery,
    props.onAssistantSessionChange,
  );
  const controls = useAgentRunControls(state, runAuthorAgent, applyAgentStreamEvent, recovery);
  const submission = useChatSubmission(state, runAuthorAgent, props);

  return (
    <ChatWindowView
      state={state}
      projectPath={props.projectPath}
      assistantSessionId={props.assistantSessionId}
      layoutMode={props.layoutMode}
      onSetLayoutMode={props.onSetLayoutMode}
      onOpenObservatory={props.onOpenObservatory}
      handleSelectSession={session.handleSelectSession}
      handleNewSession={session.handleNewSession}
      retryAssistantSessionLoad={session.retryAssistantSessionLoad}
      retryContextCandidates={session.retryContextCandidates}
      addExplicitContext={session.addExplicitContext}
      togglePinnedContext={session.togglePinnedContext}
      handleSubmit={submission.handleSubmit}
      handleComposerSubmit={submission.handleComposerSubmit}
      userMessageHistory={submission.userMessageHistory}
      retryLastFailedRun={controls.retryLastFailedRun}
      agentRunControls={controls.agentRunControls}
    />
  );
}
