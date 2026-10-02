import { executionOutcomeFromResult } from '../../lib/api/execution-outcome';
import { statusFromAgentResult } from './resumed-result';
import { useCallback } from 'react';
import { useExternalAgentConversation } from './useExternalAgentConversation';
import { useAgentRunAdmission } from './useAgentRunAdmission';

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
  type AgentSocketMessage,
} from '../../lib/api-client';
import {
  detectLocalConversationAction,
  type LocalConversationAction,
} from '../../lib/local-conversation-action';
import { buildContextBundle } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/tauri-fs';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import {
  writingContextFromAgentResult,
  filePathFromAgentResult,
  writableFilePatch,
  issueIdsFromAgentResult,
  modelFromToolTrace,
  repairPatchApproval,
  resolveProposedPatchFilePath,
} from './agent-result';
import { appendExplicitContextFiles } from './context-files';
import { useRunResultMetadata } from './useRunResultMetadata';
import { extractContextReferences } from './path-utils';
import { buildStableAgentRequestPayload } from './request-payload';
import {
  reviewIssuesFromReport,
  reviewReportFromMessage,
  reviewReportSummary,
  scopeWarningFromAgentResult,
} from './review';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import { stepsFromAgentResult } from './agent-step-mapping';
import { chapterBriefFromAgentResult } from './chapter-brief';
import type { AgentRunStatus, ChatWindowProps, RunAuthorAgent } from './types';
import type { ChatWindowState } from './useChatWindowState';
export type { RunAuthorAgent } from './types';
export {
  markWritingRunSubscriptionLost,
  startWritingRunProjectionSubscription,
  WRITING_RUN_SUBSCRIPTION_LOST_REASON,
} from './writing-run';

export function useRunAuthorAgent(
  state: ChatWindowState,
  applyAgentStreamEvent: (message: AgentSocketMessage) => void,
  updateAgentStatus: (status: AgentRunStatus) => void,
  refreshAgentRunRecovery: (runId: string) => Promise<void>,
  onAssistantSessionChange: ChatWindowProps['onAssistantSessionChange'],
  agentPermissionProfile: AgentPermissionProfile,
): RunAuthorAgent {
  const adoptResultMetadata = useRunResultMetadata(state, onAssistantSessionChange);
  const { coordinator: externalWriteback, handleWaiting } = useExternalAgentConversation(
    state,
    updateAgentStatus,
    refreshAgentRunRecovery,
    onAssistantSessionChange,
  );
  const {
    setMessages,
    projectPathRef,
    currentFileRef,
    contextRefRef,
    authorViewRef,
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    setAgentBusy,
    setRetryRequest,
    setAgentRunRecovery,
    setPendingRepairCommand,
    setAgentRun,
    setChapterBrief,
    explicitContextPaths,
    setLastContextBundle,
    setMissingContextPaths,
    projectName,
    lastReviewReport,
    setLastReviewReport,
    setLastReviewReportFile,
  } = state;
  const { rejectBlockedAdmission, claimRun, retainUnknown, releaseClaim } =
    useAgentRunAdmission(state);
  return useCallback(
    async (
      goal: string,
      action: LocalConversationAction = detectLocalConversationAction(goal),
      intent?: 'file.revise' | 'chapter.write' | 'chapter.polish',
      excludedKnowledgeIds: string[] = [],
      options: { useMainModel?: boolean; targetFilePath?: string } = {},
    ) => {
      const scope = conversationKey(
        projectPathRef.current,
        assistantSessionIdRef.current,
        draftNonceRef.current,
      );
      if (rejectBlockedAdmission(scope)) return;
      if (projectPathRef.current && externalWriteback?.hasPending(projectPathRef.current)) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '原运行仍有连续修订待办，请先核对或处理，不能另起一轮写回。',
          },
        ]);
        return;
      }
      const writebackOnly = action === 'file.writeback';
      const exportOnly = action === 'file.export';
      const project = projectPathRef.current;
      const file = currentFileRef.current;
      const ref = contextRefRef.current;
      const requiresCurrentFile =
        writebackOnly || exportOnly || intent === 'file.revise' || intent === 'chapter.polish';
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
              writebackOnly || intent === 'file.revise' || intent === 'chapter.polish'
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
      const active = claimRun(scope, runId);
      agentRunIdRef.current = runId;
      const runStartConversationKey = conversationKey(
        projectPathRef.current,
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
        permissionProfile: agentPermissionProfile,
      });
      setChapterBrief(null);
      try {
        let content: string | null = null;
        // 显式起草目标（下一章）指向尚不存在的文件：不刷盘、不读当前稿。
        if (file && ref && !options.targetFilePath) {
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
        contextBundle.excludedKnowledgeIds = excludedKnowledgeIds;
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
          authorView: authorViewRef.current,
          targetFilePath: options.targetFilePath,
        });
        if (intent === 'chapter.polish') {
          payload.style_instruction = goal;
          payload.use_main_model = options.useMainModel === true;
        }
        const agentRoleMentions = extractAgentRoleMentions(goal);
        const agentRoleHints = mapAgentRoleMentionsToHints(agentRoleMentions);
        const externalNegotiated =
          !intent &&
          !!file &&
          content !== null &&
          !!externalWriteback &&
          (await externalWriteback.negotiate());
        const response = await sendAgentUserMessage({
          ...(externalNegotiated ? { executionProtocol: 'external_writeback_v1' } : {}),
          sessionId: runId,
          runId,
          stream: true,
          assistantSessionId: assistantSessionIdRef.current,
          userMessage: goal,
          intent,
          permissionProfile: agentPermissionProfile,
          args: payload,
          agentRoleHints,
          agentRoleMentions,
          onEvent: applyAgentStreamEvent,
        });

        const runSuperseded = agentRunIdRef.current !== runId;
        const sessionSwitched = !isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          runStartConversationKey,
        );
        if (
          await handleWaiting(response, {
            negotiated: externalNegotiated,
            project,
            runId,
            owned: active() && !runSuperseded && !sessionSwitched,
          })
        )
          return;
        if (!active() || runSuperseded || sessionSwitched) {
          if (active() && !runSuperseded) setAgentBusy(false);
          return;
        }

        if (isAgentErrorMessage(response)) {
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent, useMainModel: options.useMainModel });
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
          setRetryRequest({ goal, action, intent, useMainModel: options.useMainModel });
          setMessages((prev) => [...prev, { role: 'assistant', content: detail }]);
          void refreshAgentRunRecovery(runId);
          return;
        }

        adoptResultMetadata(response);

        const executionOutcome = executionOutcomeFromResult(response);
        const resultStatus = statusFromAgentResult(response);
        const agentSteps = stepsFromAgentResult(response);
        const responseChapterBrief = chapterBriefFromAgentResult(response);
        const proposed = writableFilePatch(response);
        if (externalNegotiated && proposed)
          throw new Error('连续协议返回了旧写回补丁，已阻止重复投递');
        setChapterBrief(responseChapterBrief);
        void refreshAgentRunRecovery(response.run_id ?? runId);
        setAgentRun((run) =>
          run
            ? {
                ...run,
                status: resultStatus,
                executionOutcome: executionOutcome ?? undefined,
                steps: [
                  ...agentSteps,
                  ...(response.agent_result.requires_user_confirmation
                    ? [
                        {
                          id: 'approval',
                          title: '等待作者确认',
                          tool: 'author.approval',
                          status: 'waiting' as const,
                          detail: responseChapterBrief
                            ? '等待作者确认 Chapter Brief'
                            : '等待作者在编辑器里确认 diff',
                          filePath: proposed?.file_path,
                          patchId: proposed?.id,
                        },
                      ]
                    : []),
                ],
              }
            : run,
        );
        setAgentBusy(false);

        if (proposed) {
          const writingContext = writingContextFromAgentResult(
            response,
            contextBundle.files.map((file) => file.relativePath),
          );
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
              contextFiles: writingContext.contextFiles,
              knowledgeEntries: writingContext.knowledgeEntries,
              scopeWarning: scopeWarningFromAgentResult(response) ?? undefined,
              requiresConfirmation: proposed.requires_confirmation,
              runId: response.run_id ?? runId,
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
          // P1-2：无 approval_command 时接受按钮静默无效，waiting 成死路，仅有真批准路径才置。
          const allowsWaiting =
            repairProposal.command && response.agent_result.requires_user_confirmation;
          updateAgentStatus(allowsWaiting ? 'waiting' : resultStatus);
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
          updateAgentStatus(resultStatus);
          return;
        }

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: response.agent_result.summary ?? '这轮已经完成。' },
        ]);
        // P1-2：纯文本总结无真批准路径，waiting 会让作者卡死在空按钮上；仅 chapterBrief 例外。
        updateAgentStatus(responseChapterBrief ? 'waiting' : resultStatus);
      } catch (error) {
        const runSuperseded = agentRunIdRef.current !== runId;
        const sessionSwitched = !isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          runStartConversationKey,
        );
        if (!active() || runSuperseded || sessionSwitched) {
          if (active() && !runSuperseded) setAgentBusy(false);
          return;
        }
        if (
          retainUnknown(error, runStartConversationKey, runId, {
            goal,
            action,
            intent,
            useMainModel: options.useMainModel,
          })
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        updateAgentStatus('failed');
        setRetryRequest({ goal, action, intent, useMainModel: options.useMainModel });
        setMessages((prev) => [...prev, { role: 'assistant', content: `这轮没跑通：${message}` }]);
      } finally {
        releaseClaim(runId);
      }
    },
    [
      externalWriteback,
      handleWaiting,
      adoptResultMetadata,
      rejectBlockedAdmission,
      claimRun,
      retainUnknown,
      releaseClaim,
      agentPermissionProfile,
      agentRunIdRef,
      applyAgentStreamEvent,
      assistantSessionIdRef,
      authorViewRef,
      contextRefRef,
      currentFileRef,
      draftNonceRef,
      explicitContextPaths,
      lastReviewReport,
      projectName,
      projectPathRef,
      refreshAgentRunRecovery,
      runStartConversationKeyRef,
      setAgentBusy,
      setAgentRun,
      setAgentRunRecovery,
      setChapterBrief,
      setLastContextBundle,
      setLastReviewReport,
      setLastReviewReportFile,
      setMessages,
      setMissingContextPaths,
      setPendingRepairCommand,
      setRetryRequest,
      updateAgentStatus,
    ],
  );
}
