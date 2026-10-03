import { executionOutcomeFromResult } from '../../lib/api/execution-outcome';
import { useCallback, useEffect, useRef } from 'react';

import {
  emitFileSuggestion,
  emitReviewIssues,
  emitSuggestionResult,
} from '../../lib/assistant-events';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import { getAgentRunSavePoints, type AgentResultMessage } from '../../lib/api-client';
import { resolveProjectRelativePath } from '../../lib/project-context';
import {
  writingContextFromAgentResult,
  filePathFromAgentResult,
  writableFilePatch,
  issueIdsFromAgentResult,
  modelFromToolTrace,
  resolveProposedPatchFilePath,
} from './agent-result';
import { chapterBriefFromAgentResult } from './chapter-brief';
import { titleFromSystemJobs } from './conversation-utils';
import {
  buildAgentRunRecoveryDisplay,
  checkpointResumeFromDiagnostic,
  recoveryDisplayFromCheckpoint,
} from './recovery';
import {
  reviewIssuesFromReport,
  reviewReportFromMessage,
  reviewReportSummary,
  scopeWarningFromAgentResult,
} from './review';
import {
  checkpointResumeFromResult,
  displayFromResumeDiagnostic,
  statusFromAgentResult,
  textSettlementFromAgentResult,
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
    textStream,
    setAgentRun,
    agentRun,
    selfPersistedSessionIdRef,
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
    setChapterBrief,
  } = state;

  const recoveryRevision = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
      setAgentRun((run) =>
        run
          ? { ...run, status: status === 'completed' && run.executionOutcome ? 'failed' : status }
          : run,
      );
      setAgentBusy(status === 'running');
    },
    [setAgentBusy, setAgentRun],
  );

  const refreshAgentRunRecovery = useCallback(
    async (runId: string) => {
      const revision = ++recoveryRevision.current;
      const scope = conversationKey(
        projectPathRef.current,
        assistantSessionIdRef.current,
        draftNonceRef.current,
      );
      const active = () =>
        alive.current &&
        revision === recoveryRevision.current &&
        agentRunIdRef.current === runId &&
        scope ===
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          );
      try {
        const projection = await getAgentRunSavePoints(runId);
        if (projection.run_id !== runId) throw new Error('恢复状态归属不匹配。');
        if (active()) {
          setAgentRunRecovery(buildAgentRunRecoveryDisplay(projection));
        }
      } catch {
        if (active()) {
          setAgentRunRecovery((current) => {
            const checkpoint = current?.checkpointResume;
            if (!checkpoint) return null;
            if (!checkpoint.canResume) return current;
            return recoveryDisplayFromCheckpoint({
              ...checkpoint,
              canResume: false,
              message: '恢复：暂时无法核对检查点状态；不会自动重放，请稍后核对本轮。',
            });
          });
        }
      }
    },
    [agentRunIdRef, projectPathRef, assistantSessionIdRef, draftNonceRef, setAgentRunRecovery],
  );

  const applyResumedAgentResult = useCallback(
    (response: AgentResultMessage) => {
      const recoveringDraft =
        agentRun !== null &&
        assistantSessionIdRef.current === null &&
        agentRun.id === response.run_id &&
        agentRun.sessionId === response.session_id &&
        agentRun.deliveryUnknown?.scope ===
          conversationKey(projectPathRef.current, null, draftNonceRef.current);
      if (
        !recoveringDraft &&
        !isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          conversationKey(projectPathRef.current, response.assistant_session_id, ''),
        )
      ) {
        return;
      }
      if (recoveringDraft) selfPersistedSessionIdRef.current = response.assistant_session_id;
      assistantSessionIdRef.current = response.assistant_session_id;
      runStartConversationKeyRef.current = conversationKey(
        projectPathRef.current,
        response.assistant_session_id,
        '',
      );
      onAssistantSessionChange?.(response.assistant_session_id);
      const systemTitle = titleFromSystemJobs(response);
      if (systemTitle) setConversationTitle(systemTitle);

      const nextStatus = statusFromAgentResult(response);
      const settleText = (content: string, append = true) =>
        textStream.settle(
          response.run_id,
          textSettlementFromAgentResult(response, content),
          nextStatus,
          append,
        );
      setChapterBrief(chapterBriefFromAgentResult(response));
      recoveryRevision.current += 1;
      const checkpoint = checkpointResumeFromResult(response);
      if (nextStatus === 'paused' && checkpoint) {
        setAgentRunRecovery(recoveryDisplayFromCheckpoint(checkpoint));
      }
      setAgentRun((run) =>
        run
          ? {
              ...run,
              status: nextStatus,
              deliveryUnknown: undefined,
              executionOutcome: executionOutcomeFromResult(response) ?? undefined,
              steps: stepsFromResumedAgentResult(response),
            }
          : run,
      );
      setAgentBusy(false);

      const proposed = writableFilePatch(response);
      if (proposed) {
        const writingContext = writingContextFromAgentResult(
          response,
          lastContextBundle?.files.map((file) => file.relativePath) ?? [],
        );
        const filePath = resolveProposedPatchFilePath(projectPathRef.current, proposed.file_path);
        if (!filePath) {
          const message = 'Agent 返回的修订目标不在当前项目内，已阻止写回。';
          textStream.settle(response.run_id, { kind: 'diagnostic', detail: message }, 'failed');
          emitSuggestionResult({
            filePath: proposed.file_path,
            status: 'error',
            message,
            assistantSessionId: response.assistant_session_id,
          });
          updateAgentStatus('failed');
          return;
        }
        settleText(response.agent_result.summary ?? '已生成待确认修订。', false);
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
            contextFiles: writingContext.contextFiles,
            knowledgeEntries: writingContext.knowledgeEntries,
            scopeWarning: scopeWarningFromAgentResult(response) ?? undefined,
            requiresConfirmation: proposed.requires_confirmation,
            runId: response.run_id ?? undefined,
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
        settleText(reviewSummary);
        updateAgentStatus(nextStatus);
        return;
      }

      settleText(response.agent_result.summary ?? '这轮已经完成。');
      updateAgentStatus(nextStatus);
    },
    [
      textStream,
      agentRun,
      selfPersistedSessionIdRef,
      assistantSessionIdRef,
      currentFileRef,
      draftNonceRef,
      lastContextBundle,
      onAssistantSessionChange,
      projectPathRef,
      runStartConversationKeyRef,
      setAgentBusy,
      setAgentRun,
      setAgentRunRecovery,
      setChapterBrief,
      setConversationTitle,
      setLastReviewReport,
      setLastReviewReportFile,
      updateAgentStatus,
    ],
  );

  const applyResumeDiagnostic = useCallback(
    (diagnostic: Record<string, unknown>) => {
      recoveryRevision.current += 1;
      const display = displayFromResumeDiagnostic(diagnostic);
      const checkpoint = checkpointResumeFromDiagnostic(diagnostic);
      if (checkpoint) setAgentRunRecovery(recoveryDisplayFromCheckpoint(checkpoint));
      const resumeStep: AgentStep = {
        id: 'resume',
        title: '恢复本轮',
        tool: 'agent.runtime.resume',
        status:
          display.status === 'failed'
            ? 'failed'
            : display.status === 'stopped'
              ? 'completed'
              : 'waiting',
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
      setAgentBusy(display.executionPending === true);
      setMessages((prev) => [...prev, { role: 'assistant', content: display.message }]);
    },
    [setAgentBusy, setAgentRun, setAgentRunRecovery, setMessages],
  );

  return {
    updateAgentStep,
    updateAgentStatus,
    refreshAgentRunRecovery,
    applyResumedAgentResult,
    applyResumeDiagnostic,
  };
}
