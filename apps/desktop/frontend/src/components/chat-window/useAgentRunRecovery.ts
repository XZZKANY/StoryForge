import { useCallback } from 'react';

import {
  emitFileSuggestion,
  emitReviewIssues,
  emitSuggestionResult,
} from '../../lib/assistant-events';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import { getAgentRunSavePoints, type AgentResultMessage } from '../../lib/api-client';
import { resolveProjectRelativePath } from '../../lib/project-context';
import {
  filePathFromAgentResult,
  fileRevisionPatch,
  issueIdsFromAgentResult,
  modelFromToolTrace,
  resolveProposedPatchFilePath,
} from './agent-result';
import { titleFromSystemJobs } from './conversation-utils';
import { buildAgentRunRecoveryDisplay } from './recovery';
import {
  reviewIssuesFromReport,
  reviewReportFromMessage,
  reviewReportSummary,
  scopeWarningFromAgentResult,
} from './review';
import {
  displayFromResumeDiagnostic,
  statusFromAgentResult,
  stepsFromResumedAgentResult,
} from './resumed-result';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import type { AgentRun, AgentStep, ChatWindowProps } from './types';
import type { ChatWindowState } from './useChatWindowState';

export function useAgentRunRecovery(
  state: ChatWindowState,
  onAssistantSessionChange: ChatWindowProps['onAssistantSessionChange'],
) {
  const {
    setAgentRun,
    setAgentBusy,
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    projectPathRef,
    currentFileRef,
    setConversationTitle,
    setMessages,
    setLastReviewReport,
    setLastReviewReportFile,
    setAgentRunRecovery,
    lastContextBundle,
  } = state;

  const updateAgentStep = useCallback(
    (stepId: string, patch: Partial<AgentStep>) => {
      setAgentRun((run) => {
        if (!run) return run;
        return {
          ...run,
          steps: run.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
        };
      });
    },
    [setAgentRun],
  );

  const updateAgentStatus = useCallback(
    (status: AgentRun['status']) => {
      setAgentRun((run) => (run ? { ...run, status } : run));
      setAgentBusy(status === 'running');
    },
    [setAgentBusy, setAgentRun],
  );

  const refreshAgentRunRecovery = useCallback(
    async (runId: string) => {
      try {
        const projection = await getAgentRunSavePoints(runId);
        if (agentRunIdRef.current === runId) {
          setAgentRunRecovery(buildAgentRunRecoveryDisplay(projection));
        }
      } catch {
        if (agentRunIdRef.current === runId) setAgentRunRecovery(null);
      }
    },
    [agentRunIdRef, setAgentRunRecovery],
  );

  const applyResumedAgentResult = useCallback(
    (response: AgentResultMessage) => {
      if (
        !isRunResultForActiveSession(
          conversationKey(assistantSessionIdRef.current, draftNonceRef.current),
          conversationKey(response.assistant_session_id, ''),
        )
      ) {
        return;
      }
      assistantSessionIdRef.current = response.assistant_session_id;
      runStartConversationKeyRef.current = conversationKey(response.assistant_session_id, '');
      onAssistantSessionChange?.(response.assistant_session_id);
      const systemTitle = titleFromSystemJobs(response);
      if (systemTitle) setConversationTitle(systemTitle);

      const nextStatus = statusFromAgentResult(response);
      setAgentRun((run) =>
        run
          ? {
              ...run,
              status: nextStatus,
              steps: stepsFromResumedAgentResult(response),
            }
          : run,
      );
      setAgentBusy(false);

      const proposed = fileRevisionPatch(response);
      if (proposed) {
        const filePath = resolveProposedPatchFilePath(projectPathRef.current, proposed.file_path);
        if (!filePath) {
          const message = 'Agent 返回的修订目标不在当前项目内，已阻止写回。';
          setMessages((prev) => [...prev, { role: 'assistant', content: message }]);
          emitSuggestionResult({
            filePath: proposed.file_path,
            status: 'error',
            message,
            assistantSessionId: response.assistant_session_id,
          });
          updateAgentStatus('failed');
          return;
        }
        emitFileSuggestion(
          createRemoteFileSuggestion({
            id: proposed.id,
            filePath,
            before: proposed.before,
            after: proposed.after,
            summary: response.agent_result.summary ?? 'Agent 已生成修订建议。',
            model: modelFromToolTrace(response),
            userIntent: response.user_message,
            assistantSessionId: response.assistant_session_id,
            issueIds: issueIdsFromAgentResult(response),
            contextFiles: lastContextBundle?.files.map((file) => file.relativePath) ?? [],
            scopeWarning: scopeWarningFromAgentResult(response) ?? undefined,
          }),
        );
        emitSuggestionResult({
          filePath,
          status: 'ready',
          message: response.agent_result.summary ?? 'Agent 已生成修订建议。',
          assistantSessionId: response.assistant_session_id,
        });
        updateAgentStatus('waiting');
        return;
      }

      const reviewSummary = reviewReportSummary(response);
      if (reviewSummary) {
        const reviewReportForMarkers = reviewReportFromMessage(response);
        const resultFilePath = filePathFromAgentResult(response);
        const currentFilePath = resultFilePath
          ? projectPathRef.current
            ? resolveProjectRelativePath(projectPathRef.current, resultFilePath)
            : null
          : currentFileRef.current;
        setLastReviewReport(reviewReportForMarkers);
        setLastReviewReportFile(currentFilePath);
        if (currentFilePath)
          emitReviewIssues(currentFilePath, reviewIssuesFromReport(reviewReportForMarkers));
        setMessages((prev) => [...prev, { role: 'assistant', content: reviewSummary }]);
        updateAgentStatus('completed');
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response.agent_result.summary ?? '这轮已经完成。' },
      ]);
      updateAgentStatus(nextStatus);
    },
    [
      assistantSessionIdRef,
      currentFileRef,
      draftNonceRef,
      lastContextBundle,
      onAssistantSessionChange,
      projectPathRef,
      runStartConversationKeyRef,
      setAgentBusy,
      setAgentRun,
      setConversationTitle,
      setLastReviewReport,
      setLastReviewReportFile,
      setMessages,
      updateAgentStatus,
    ],
  );

  const applyResumeDiagnostic = useCallback(
    (diagnostic: Record<string, unknown>) => {
      const display = displayFromResumeDiagnostic(diagnostic);
      const resumeStep: AgentStep = {
        id: 'resume',
        title: '恢复本轮',
        tool: 'agent.runtime.resume',
        status: display.status === 'failed' ? 'failed' : 'waiting',
        detail: display.message,
      };
      setAgentRun((run) => {
        if (!run) return run;
        const exists = run.steps.some((step) => step.id === resumeStep.id);
        return {
          ...run,
          status: display.status,
          steps: exists
            ? run.steps.map((step) => (step.id === resumeStep.id ? resumeStep : step))
            : [...run.steps, resumeStep],
        };
      });
      setAgentBusy(false);
      setMessages((prev) => [...prev, { role: 'assistant', content: display.message }]);
    },
    [setAgentBusy, setAgentRun, setMessages],
  );

  return {
    updateAgentStep,
    updateAgentStatus,
    refreshAgentRunRecovery,
    applyResumedAgentResult,
    applyResumeDiagnostic,
  };
}
