import { useCallback } from 'react';

import {
  emitAcceptCurrentFileSuggestion,
  emitExportCurrentFile,
  emitFileSuggestion,
  emitReviewIssues,
  emitSuggestionResult,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import { extractAgentRoleMentions, mapAgentRoleMentionsToHints } from '../../lib/agent-roles';
import {
  isAgentErrorMessage,
  isAgentResultMessage,
  sendAgentUserMessage,
  subscribeWritingRunEvents,
  type AgentSocketMessage,
} from '../../lib/api-client';
import {
  detectLocalConversationAction,
  type LocalConversationAction,
} from '../../lib/local-conversation-action';
import { buildContextBundle } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/tauri-fs';
import {
  filePathFromAgentResult,
  fileRevisionPatch,
  issueIdsFromAgentResult,
  modelFromToolTrace,
  repairPatchApproval,
  resolveProposedPatchFilePath,
} from './agent-result';
import { appendExplicitContextFiles } from './context-files';
import { titleFromSystemJobs } from './conversation-utils';
import { extractContextReferences } from './path-utils';
import { buildStableAgentRequestPayload } from './request-payload';
import {
  reviewIssuesFromReport,
  reviewReportFromMessage,
  reviewReportSummary,
  scopeWarningFromAgentResult,
} from './review';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import { applyWritingRunEventProjection, writingRunIdFromResult } from './writing-run';
import { stepsFromAgentResult } from './agent-step-mapping';
import type { ChatWindowProps } from './types';
import type { ChatWindowState } from './useChatWindowState';

export type RunAuthorAgent = (
  goal: string,
  action?: LocalConversationAction,
  intent?: 'file.revise',
) => Promise<void>;

export function useRunAuthorAgent(
  state: ChatWindowState,
  applyAgentStreamEvent: (message: AgentSocketMessage) => void,
  updateAgentStatus: (status: 'running' | 'waiting' | 'completed' | 'failed') => void,
  refreshAgentRunRecovery: (runId: string) => Promise<void>,
  onAssistantSessionChange: ChatWindowProps['onAssistantSessionChange'],
): RunAuthorAgent {
  const {
    agentBusy,
    setMessages,
    projectPathRef,
    currentFileRef,
    contextRefRef,
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    setAgentBusy,
    setRetryRequest,
    setAgentRunRecovery,
    setPendingRepairCommand,
    setAgentRun,
    explicitContextPaths,
    setLastContextBundle,
    setMissingContextPaths,
    projectName,
    lastReviewReport,
    selfPersistedSessionIdRef,
    setConversationTitle,
    unsubscribeWritingRunRef,
    setWritingRunProjection,
    setLastReviewReport,
    setLastReviewReportFile,
  } = state;

  return useCallback(
    async (
      goal: string,
      action: LocalConversationAction = detectLocalConversationAction(goal),
      intent?: 'file.revise',
    ) => {
      if (agentBusy) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '这轮还在整理。我先把当前读取、修订或确认收口，再接新的问题。',
          },
        ]);
        return;
      }

      const writebackOnly = action === 'file.writeback';
      const exportOnly = action === 'file.export';
      const project = projectPathRef.current;
      const file = currentFileRef.current;
      const ref = contextRefRef.current;
      const requiresCurrentFile = writebackOnly || exportOnly || intent === 'file.revise';
      if (!project) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: writebackOnly
              ? '当前没有待写回的修订。'
              : '我需要先知道这是哪个项目。打开本地项目目录后，我们就可以直接围绕稿件聊。',
          },
        ]);
        return;
      }
      if (requiresCurrentFile && (!file || !ref)) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              writebackOnly || intent === 'file.revise'
                ? '当前没有可写回或可定向修订的稿件。要改某一章，先在编辑器里打开那份正文；如果只是讨论项目，直接问我就行。'
                : '导出需要先在编辑器里打开一份当前稿。',
          },
        ]);
        return;
      }

      if (writebackOnly) {
        emitAcceptCurrentFileSuggestion();
        return;
      }
      if (exportOnly) {
        try {
          if (file) await flushActiveEditorToDisk(file);
          emitExportCurrentFile();
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `导出前保存失败：${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        }
        return;
      }

      const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      agentRunIdRef.current = runId;
      const runStartConversationKey = conversationKey(
        assistantSessionIdRef.current,
        draftNonceRef.current,
      );
      runStartConversationKeyRef.current = runStartConversationKey;
      setAgentBusy(true);
      setRetryRequest(null);
      setAgentRunRecovery(null);
      setPendingRepairCommand(null);
      setAgentRun({
        id: runId,
        sessionId: runId,
        goal,
        status: 'running',
        steps: [],
      });

      try {
        let content: string | null = null;
        if (file && ref) {
          await flushActiveEditorToDisk(file);
          content = await TauriFileSystem.readProjectFile(project, file);
        }

        const contextRefs = Array.from(
          new Set([...explicitContextPaths, ...extractContextReferences(goal)]),
        );
        const appendedContext = await appendExplicitContextFiles(
          await buildContextBundle({
            projectPath: project,
            currentFile: file,
            pinnedFiles: explicitContextPaths,
          }),
          project,
          contextRefs,
        );
        const contextBundle = appendedContext.bundle;
        setLastContextBundle(contextBundle);
        setMissingContextPaths(appendedContext.missingPaths);
        if (appendedContext.missingPaths.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `这些 @上下文没有读到：${appendedContext.missingPaths.join('、')}。我会继续用已选上下文处理这一轮。`,
            },
          ]);
        }

        const payload = buildStableAgentRequestPayload({
          projectPath: project,
          currentFile: file,
          content,
          instruction: goal,
          projectName,
          assistantSessionId: assistantSessionIdRef.current,
          contextBundle,
          reviewReport: lastReviewReport,
        });
        const agentRoleMentions = extractAgentRoleMentions(goal);
        const agentRoleHints = mapAgentRoleMentionsToHints(agentRoleMentions);
        const response = await sendAgentUserMessage({
          sessionId: runId,
          runId,
          stream: true,
          assistantSessionId: assistantSessionIdRef.current,
          userMessage: goal,
          intent,
          args: payload,
          agentRoleHints,
          agentRoleMentions,
          onEvent: applyAgentStreamEvent,
        });

        const runSuperseded = agentRunIdRef.current !== runId;
        const sessionSwitched = !isRunResultForActiveSession(
          conversationKey(assistantSessionIdRef.current, draftNonceRef.current),
          runStartConversationKey,
        );
        if (runSuperseded || sessionSwitched) {
          if (!runSuperseded) setAgentBusy(false);
          return;
        }

        if (isAgentErrorMessage(response)) {
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent });
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `这轮没跑通：${response.detail}` },
          ]);
          void refreshAgentRunRecovery(response.run_id ?? runId);
          return;
        }

        if (!isAgentResultMessage(response)) {
          const detail = `Agent 返回了暂不支持的消息：${response.type}`;
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent });
          setMessages((prev) => [...prev, { role: 'assistant', content: detail }]);
          void refreshAgentRunRecovery(runId);
          return;
        }

        const persistedDraftSession = assistantSessionIdRef.current === null;
        assistantSessionIdRef.current = response.assistant_session_id;
        runStartConversationKeyRef.current = conversationKey(response.assistant_session_id, '');
        if (persistedDraftSession) {
          selfPersistedSessionIdRef.current = response.assistant_session_id;
        }
        onAssistantSessionChange?.(response.assistant_session_id);
        const systemTitle = titleFromSystemJobs(response);
        if (systemTitle) setConversationTitle(systemTitle);
        const startedWritingRunId = writingRunIdFromResult(response);
        if (startedWritingRunId !== null) {
          unsubscribeWritingRunRef.current?.();
          setWritingRunProjection({
            writingRunId: startedWritingRunId,
            status: 'running',
            currentChapterIndex: null,
            totalChapters: null,
            completedCount: null,
            latestEvent: 'started',
            failureReason: null,
          });
          void subscribeWritingRunEvents(
            startedWritingRunId,
            (event) =>
              setWritingRunProjection((current) => applyWritingRunEventProjection(current, event)),
            () =>
              setWritingRunProjection((current) =>
                current
                  ? {
                      ...current,
                      latestEvent: 'error',
                      failureReason: '写作任务进度订阅失败',
                    }
                  : current,
              ),
          )
            .then((unsubscribe) => {
              unsubscribeWritingRunRef.current = unsubscribe;
            })
            .catch(() => {
              setWritingRunProjection((current) =>
                current
                  ? {
                      ...current,
                      latestEvent: 'error',
                      failureReason: '写作任务进度订阅失败',
                    }
                  : current,
              );
            });
        }

        const agentSteps = stepsFromAgentResult(response);
        void refreshAgentRunRecovery(response.run_id ?? runId);
        setAgentRun((run) =>
          run
            ? {
                ...run,
                status: response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
                steps: [
                  ...agentSteps,
                  ...(response.agent_result.requires_user_confirmation
                    ? [
                        {
                          id: 'approval',
                          title: '等待作者确认',
                          tool: 'author.approval',
                          status: 'waiting' as const,
                          detail: '等待作者在编辑器里确认 diff',
                        },
                      ]
                    : []),
                ],
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
              userIntent: goal,
              assistantSessionId: response.assistant_session_id,
              issueIds: issueIdsFromAgentResult(response),
              contextFiles: contextBundle.files.map((file) => file.relativePath),
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

        const repairProposal = repairPatchApproval(response);
        if (repairProposal) {
          setPendingRepairCommand(repairProposal.command);
          setMessages((prev) => [...prev, { role: 'assistant', content: repairProposal.summary }]);
          updateAgentStatus(
            response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
          );
          return;
        }

        const reviewSummary = reviewReportSummary(response);
        if (reviewSummary) {
          const reviewReportForMarkers = reviewReportFromMessage(response);
          const reviewedFile = filePathFromAgentResult(response) ?? file;
          setLastReviewReport(reviewReportForMarkers);
          setLastReviewReportFile(reviewedFile);
          if (reviewedFile) {
            emitReviewIssues(reviewedFile, reviewIssuesFromReport(reviewReportForMarkers));
          }
          setMessages((prev) => [...prev, { role: 'assistant', content: reviewSummary }]);
          updateAgentStatus('completed');
          return;
        }

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: response.agent_result.summary ?? '这轮已经完成。' },
        ]);
        updateAgentStatus(
          response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
        );
      } catch (error) {
        const runSuperseded = agentRunIdRef.current !== runId;
        const sessionSwitched = !isRunResultForActiveSession(
          conversationKey(assistantSessionIdRef.current, draftNonceRef.current),
          runStartConversationKey,
        );
        if (runSuperseded || sessionSwitched) {
          if (!runSuperseded) setAgentBusy(false);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        updateAgentStatus('failed');
        setRetryRequest({ goal, action, intent });
        setMessages((prev) => [...prev, { role: 'assistant', content: `这轮没跑通：${message}` }]);
      }
    },
    [
      agentBusy,
      agentRunIdRef,
      applyAgentStreamEvent,
      assistantSessionIdRef,
      contextRefRef,
      currentFileRef,
      draftNonceRef,
      explicitContextPaths,
      lastReviewReport,
      onAssistantSessionChange,
      projectName,
      projectPathRef,
      refreshAgentRunRecovery,
      runStartConversationKeyRef,
      selfPersistedSessionIdRef,
      setAgentBusy,
      setAgentRun,
      setAgentRunRecovery,
      setConversationTitle,
      setLastContextBundle,
      setLastReviewReport,
      setLastReviewReportFile,
      setMessages,
      setMissingContextPaths,
      setPendingRepairCommand,
      setRetryRequest,
      setWritingRunProjection,
      unsubscribeWritingRunRef,
      updateAgentStatus,
    ],
  );
}
