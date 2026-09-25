/**
 * 对话窗口容器：组合 session/context、Agent stream、run control 与展示层。
 */

import { useEffect, useRef } from 'react';

import { ChatWindowView } from './chat-window/ChatWindowView';
import type { ChatWindowProps } from './chat-window/types';
import { DEFAULT_AGENT_PERMISSION_PROFILE } from '../lib/agent-permission';
import { useAgentRunControls } from './chat-window/useAgentRunControls';
import { useAgentRunRecovery } from './chat-window/useAgentRunRecovery';
import { useAgentStreamEvent } from './chat-window/useAgentStreamEvent';
import { useChatSessionContext } from './chat-window/useChatSessionContext';
import { useChatSubmission } from './chat-window/useChatSubmission';
import { useChatWindowState } from './chat-window/useChatWindowState';
import { projectOverviewActivity } from './chat-window/overview-activity';
import { useRunAuthorAgent } from './chat-window/useRunAuthorAgent';
import {
  REQUEST_CHAPTER_POLISH_EVENT,
  RETRY_WITHOUT_KNOWLEDGE_EVENT,
  type ChapterPolishRequest,
  type RetryWithoutKnowledge,
} from '../lib/assistant-events';

export {
  filePathFromAgentResult,
  repairPatchApproval,
  resolveProposedPatchFilePath,
  shouldApplyAgentControlAck,
  writableFilePatch,
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
export {
  overviewActivityActionLabel,
  overviewActivityLabel,
  projectOverviewActivity,
} from './chat-window/overview-activity';

export function ChatWindow(props: ChatWindowProps) {
  const { onAgentRunSummaryChange, projectPath, assistantSessionId } = props;
  const retryInFlightRef = useRef(false);
  const summaryScopeRef = useRef(`${projectPath ?? ''}:${assistantSessionId ?? 'draft'}`);
  const agentPermissionProfile = props.agentPermissionProfile ?? DEFAULT_AGENT_PERMISSION_PROFILE;
  const onAgentPermissionProfileChange = props.onAgentPermissionProfileChange ?? (() => undefined);
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
    agentPermissionProfile,
  );
  const controls = useAgentRunControls(state, runAuthorAgent, applyAgentStreamEvent, recovery);
  const submission = useChatSubmission(state, runAuthorAgent, props);

  useEffect(() => {
    const scope = `${projectPath ?? ''}:${assistantSessionId ?? 'draft'}`;
    if (summaryScopeRef.current !== scope) {
      summaryScopeRef.current = scope;
      onAgentRunSummaryChange?.(null);
      return;
    }
    onAgentRunSummaryChange?.(
      projectOverviewActivity({
        projectPath,
        assistantSessionId,
        agentRun: state.agentRun,
        chapterBrief: state.chapterBrief,
        agentBusy: state.agentBusy,
        sessionLoadError: state.sessionLoadError,
        retryableFailure: Boolean(state.retryRequest) && !state.agentBusy,
      }),
    );
  }, [
    assistantSessionId,
    onAgentRunSummaryChange,
    projectPath,
    state.agentBusy,
    state.agentRun,
    state.chapterBrief,
    state.retryRequest,
    state.sessionLoadError,
  ]);

  useEffect(() => {
    const onRetryWithoutKnowledge = (event: Event) => {
      const detail = (event as CustomEvent<RetryWithoutKnowledge>).detail;
      if (event.defaultPrevented || !detail?.knowledgeId || !detail.goal || !projectPath) return;
      if (detail.projectPath && detail.projectPath !== projectPath) return;
      if (detail.filePath && detail.filePath !== props.currentFile) return;
      event.preventDefault();
      if (state.agentBusy || retryInFlightRef.current) {
        detail.complete?.('Agent 正忙，请稍后重试');
        return;
      }
      retryInFlightRef.current = true;
      state.setMessages((current) => [
        ...current,
        { role: 'user', content: `移除知识 ${detail.relativePath} 后重试：${detail.goal}` },
      ]);
      void (async () => {
        try {
          await runAuthorAgent(detail.goal, undefined, undefined, [detail.knowledgeId]);
          // Completion means the request settled, not that a patch was accepted/written.
          detail.complete?.();
        } catch (error) {
          detail.complete?.(error instanceof Error ? error.message : String(error));
        } finally {
          retryInFlightRef.current = false;
        }
      })();
    };
    window.addEventListener(RETRY_WITHOUT_KNOWLEDGE_EVENT, onRetryWithoutKnowledge);
    return () => window.removeEventListener(RETRY_WITHOUT_KNOWLEDGE_EVENT, onRetryWithoutKnowledge);
  }, [projectPath, props.currentFile, runAuthorAgent, state]);

  useEffect(() => {
    const onChapterPolish = (event: Event) => {
      const detail = (event as CustomEvent<ChapterPolishRequest>).detail;
      const useMainModel = detail?.useMainModel === true;
      const goal = useMainModel ? '保守润色当前章，本次明确使用主模型' : '保守润色当前章';
      state.setMessages((current) => [...current, { role: 'user', content: goal }]);
      void runAuthorAgent(goal, undefined, 'chapter.polish', [], { useMainModel });
    };
    window.addEventListener(REQUEST_CHAPTER_POLISH_EVENT, onChapterPolish);
    return () => window.removeEventListener(REQUEST_CHAPTER_POLISH_EVENT, onChapterPolish);
  }, [runAuthorAgent, state]);

  return (
    <ChatWindowView
      state={state}
      projectPath={props.projectPath}
      assistantSessionId={props.assistantSessionId}
      layoutMode={props.layoutMode}
      onSetLayoutMode={props.onSetLayoutMode}
      onOpenObservatory={props.onOpenObservatory}
      observatoryAttention={props.observatoryAttention}
      agentPermissionProfile={agentPermissionProfile}
      onAgentPermissionProfileChange={onAgentPermissionProfileChange}
      handleSelectSession={session.handleSelectSession}
      handleNewSession={() => {
        submission.clearQueuedMessages();
        session.handleNewSession();
      }}
      retryAssistantSessionLoad={session.retryAssistantSessionLoad}
      retryContextCandidates={session.retryContextCandidates}
      addExplicitContext={session.addExplicitContext}
      togglePinnedContext={session.togglePinnedContext}
      handleSubmit={submission.handleSubmit}
      handleComposerSubmit={submission.handleComposerSubmit}
      userMessageHistory={submission.userMessageHistory}
      conversationScope={submission.conversationScope}
      queuedMessages={submission.queuedMessages}
      onRemoveQueuedMessage={submission.removeQueuedMessage}
      retryLastFailedRun={controls.retryLastFailedRun}
      agentRunControls={controls.agentRunControls}
    />
  );
}
