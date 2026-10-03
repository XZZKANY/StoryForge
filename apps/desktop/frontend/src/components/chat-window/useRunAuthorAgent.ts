import { executionOutcomeFromResult } from '../../lib/api/execution-outcome';
import { statusFromAgentResult, textSettlementFromAgentResult } from './resumed-result';
import { useCallback } from 'react';
import { useExternalAgentConversation } from './useExternalAgentConversation';
import { useAgentRunAdmission } from './useAgentRunAdmission';

import {
  emitAcceptCurrentFileSuggestion,
  emitExportCurrentFile,
  emitReviewIssues,
  flushActiveEditorToDisk,
} from '../../lib/assistant-events';
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
import { filePathFromAgentResult, writableFilePatch, repairPatchApproval } from './agent-result';
import { appendExplicitContextFiles } from './context-files';
import { useRunResultMetadata } from './useRunResultMetadata';
import { extractContextReferences, relativePath } from './path-utils';
import { buildStableAgentRequestPayload } from './request-payload';
import { reviewIssuesFromReport, reviewReportFromMessage, reviewReportSummary } from './review';
import { conversationKey, createRunDispatchIdentity } from './session-guard';
import { approvalStepFromAgentResult, stepsFromAgentResult } from './agent-step-mapping';
import { emitProposedPatchOutcome } from './proposed-patch-outcome';
import { chapterBriefFromAgentResult } from './chapter-brief';
import type {
  AgentRunStatus,
  ChatWindowProps,
  RunAuthorAgent,
  RunAuthorAgentOptions,
} from './types';
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
  const { textStream } = state;
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
  const { rejectBlockedAdmission, claimRun, retainUnknown, isClaimedBy, releaseClaim } =
    useAgentRunAdmission(state);
  return useCallback(
    async (
      goal: string,
      action: LocalConversationAction = detectLocalConversationAction(goal),
      intent?: 'file.revise' | 'chapter.write' | 'chapter.polish',
      excludedKnowledgeIds: string[] = [],
      options: RunAuthorAgentOptions = {},
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
      const task = createRunDispatchIdentity({
        runId,
        active,
        agentRunId: () => agentRunIdRef.current,
        projectPath: () => projectPathRef.current,
        assistantSessionId: () => assistantSessionIdRef.current,
        draftNonce: () => draftNonceRef.current,
        isClaimedBy,
        releaseClaim,
        clearBusy: () => setAgentBusy(false),
      });
      const { assistantSessionId, ownsRun, abandonIfTaskMoved, runStartConversationKey } = task;
      runStartConversationKeyRef.current = runStartConversationKey;
      const settleDiagnostic = (detail: string) =>
        textStream.settle(runId, { kind: 'diagnostic', detail }, 'failed');
      textStream.begin(runId, ownsRun);
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
        // 显式起草目标或计划回退（下一章）指向尚不存在的文件：不刷盘、不读当前稿。
        if (file && ref && !options.targetFilePath && !options.planFallback) {
          await flushActiveEditorToDisk(file);
          content = await TauriFileSystem.readProjectFile(project, file);
        }
        // 当前打开稿已在 bundle 的 currentFile 里；再当 pinned 会被 eligible 过滤掉并假报「没有读到」。
        const currentRelative = file && project ? relativePath(project, file) : null;
        const requestedContextPaths = (options.explicitContextPaths ?? []).filter(
          (path) => path !== currentRelative,
        );
        const contextRefs = Array.from(
          new Set([
            ...explicitContextPaths,
            ...requestedContextPaths,
            ...extractContextReferences(goal),
          ]),
        );
        const appendedContext = await appendExplicitContextFiles(
          await buildContextBundle({
            projectPath: project,
            currentFile: file,
            pinnedFiles: [...explicitContextPaths, ...requestedContextPaths],
          }),
          project,
          contextRefs,
        );
        if (abandonIfTaskMoved()) return;
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
          // 计划回退：不带 current_file/file_path，让后端 resolve_target(None) 走连载计划回退。
          currentFile: options.planFallback ? null : file,
          content: options.planFallback ? null : content,
          instruction: goal,
          projectName,
          assistantSessionId,
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
        // 协商只决定协议，不决定归属：协商期间切走同样撤权，不发出本轮请求。
        if (abandonIfTaskMoved()) return;
        const response = await sendAgentUserMessage({
          ...(externalNegotiated ? { executionProtocol: 'external_writeback_v1' } : {}),
          sessionId: runId,
          runId,
          stream: true,
          assistantSessionId,
          userMessage: goal,
          intent,
          permissionProfile: agentPermissionProfile,
          args: payload,
          agentRoleHints,
          agentRoleMentions,
          onStreamDetached: () => {
            if (ownsRun()) textStream.hold(runId, 'unknown');
          },
          onEvent: (event) => {
            if (ownsRun()) applyAgentStreamEvent(event);
          },
        });

        const waiting = await handleWaiting(response, {
          negotiated: externalNegotiated,
          project,
          runId,
          owned: ownsRun(),
        });
        // 等待帧（含外部写回）在已切走时会跳过它自己的 busy 归位；这里补上，否则新会话永久 busy。
        if (!ownsRun() && isClaimedBy(runId)) setAgentBusy(false);
        if (waiting) return;
        if (!ownsRun()) {
          // 归属判据用 claim 而非 active()：切会话会让 active() 为 false，那样 busy 永不归位；
          // claim 已被更新的 run 接管时才不动作，避免误清新 run 的 busy。
          if (isClaimedBy(runId)) setAgentBusy(false);
          return;
        }

        if (isAgentErrorMessage(response)) {
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent, useMainModel: options.useMainModel });
          settleDiagnostic(`这轮没跑通：${response.detail}`);
          void refreshAgentRunRecovery(response.run_id ?? runId);
          return;
        }

        if (!isAgentResultMessage(response)) {
          const detail = `Agent 返回了暂不支持的消息：${response.type}`;
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent, useMainModel: options.useMainModel });
          settleDiagnostic(detail);
          void refreshAgentRunRecovery(runId);
          return;
        }

        adoptResultMetadata(response);

        const executionOutcome = executionOutcomeFromResult(response);
        const resultStatus = statusFromAgentResult(response);
        const settleText = (content: string, append = true) => {
          const text = textSettlementFromAgentResult(response, content);
          textStream.settle(runId, text, resultStatus, append);
        };
        const agentSteps = stepsFromAgentResult(response);
        const responseChapterBrief = chapterBriefFromAgentResult(response);
        const proposed = writableFilePatch(response);
        if (externalNegotiated && proposed)
          throw new Error('连续协议返回了旧写回补丁，已阻止重复投递');
        setChapterBrief(responseChapterBrief);
        void refreshAgentRunRecovery(response.run_id ?? runId);
        const approvalSteps = approvalStepFromAgentResult(
          response,
          responseChapterBrief !== null,
          proposed,
        );
        setAgentRun((run) =>
          run
            ? {
                ...run,
                status: resultStatus,
                executionOutcome: executionOutcome ?? undefined,
                steps: [...agentSteps, ...approvalSteps],
              }
            : run,
        );
        setAgentBusy(false);

        if (proposed) {
          emitProposedPatchOutcome({
            response,
            proposed,
            contextRelativePaths: contextBundle.files.map((file) => file.relativePath),
            projectPath: projectPathRef.current,
            goal,
            runId,
            settleDiagnostic,
            settleText,
            updateAgentStatus,
          });
          return;
        }

        const repairProposal = repairPatchApproval(response);
        if (repairProposal) {
          setPendingRepairCommand(repairProposal.command);
          settleText(repairProposal.summary);
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
          settleText(reviewSummary);
          updateAgentStatus(resultStatus);
          return;
        }

        settleText(response.agent_result.summary ?? '这轮已经完成。');
        // P1-2：纯文本总结无真批准路径，waiting 会让作者卡死在空按钮上；仅 chapterBrief 例外。
        updateAgentStatus(responseChapterBrief ? 'waiting' : resultStatus);
      } catch (error) {
        if (!ownsRun()) {
          // 归属判据用 claim 而非 active()：切会话会让 active() 为 false，那样 busy 永不归位；
          // claim 已被更新的 run 接管时才不动作，避免误清新 run 的 busy。
          if (isClaimedBy(runId)) setAgentBusy(false);
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
          textStream.hold(runId, 'unknown');
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        updateAgentStatus('failed');
        setRetryRequest({ goal, action, intent, useMainModel: options.useMainModel });
        settleDiagnostic(`这轮没跑通：${message}`);
      } finally {
        releaseClaim(runId);
      }
    },
    [
      textStream,
      externalWriteback,
      handleWaiting,
      adoptResultMetadata,
      rejectBlockedAdmission,
      claimRun,
      retainUnknown,
      isClaimedBy,
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
