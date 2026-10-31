import { executionOutcomeFromResult } from '../../lib/api/execution-outcome';
import {
  checkpointResumeFromResult,
  statusFromAgentResult,
  textSettlementFromAgentResult,
} from './resumed-result';
import { useCallback } from 'react';
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
import { buildContextBundle, resolveProjectRelativePath } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/tauri-fs';
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import { permissionForRun } from '../../lib/write-batch-grant';
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
  RetryRequest,
  RunAuthorAgent,
  RunAuthorAgentOptions,
  RunAuthorAgentOutcome,
} from './types';
import type { ChatWindowState } from './useChatWindowState';
export type { RunAuthorAgent } from './types';

const NOT_DISPATCHED: RunAuthorAgentOutcome = { kind: 'not_dispatched' };

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
    ): Promise<RunAuthorAgentOutcome> => {
      const scope = conversationKey(
        projectPathRef.current,
        assistantSessionIdRef.current,
        draftNonceRef.current,
      );
      if (rejectBlockedAdmission(scope)) return NOT_DISPATCHED;
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
              ? '当前没有待写进文件的修订。'
              : '我需要先知道这是哪部作品。打开本地作品文件夹后，我们就可以直接围绕正文聊。',
          },
        ]);
        return NOT_DISPATCHED;
      }
      if (requiresCurrentFile && (!file || !ref)) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              writebackOnly || intent === 'file.revise' || intent === 'chapter.polish'
                ? '当前没有打开可修订的文件。要改某一章，先在编辑器里打开那份正文；如果只是讨论这部作品，直接问我就行。'
                : '导出需要先在编辑器里打开一份当前稿。',
          },
        ]);
        return NOT_DISPATCHED;
      }
      if (writebackOnly) {
        emitAcceptCurrentFileSuggestion();
        return NOT_DISPATCHED;
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
        return NOT_DISPATCHED;
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
      const unsettled: RunAuthorAgentOutcome = { kind: 'unsettled', runId };
      const settled = (
        proposal: Extract<RunAuthorAgentOutcome, { kind: 'settled' }>['proposal'] = null,
      ): RunAuthorAgentOutcome => ({ kind: 'settled', runId, proposal });
      // 批量写章的一次性授权只在这里换档：其余一律送作者存的档位（lib/write-batch-grant.ts）。
      const runPermissionProfile = permissionForRun({
        stored: agentPermissionProfile,
        projectPath: project,
        intent,
        targetFilePath: options.targetFilePath,
        grant: options.writeBatchGrant,
      });
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
        permissionProfile: runPermissionProfile,
        startedAt: Date.now(),
      });
      setChapterBrief(null);
      const retryRequest: RetryRequest = {
        goal,
        action,
        intent,
        options: {
          ...options,
          // 重试是作者自己点的一轮，不带批量的授权。
          writeBatchGrant: undefined,
          explicitContextPaths: options.explicitContextPaths?.slice(),
        },
        excludedKnowledgeIds: excludedKnowledgeIds.slice(),
        currentFile: options.targetFilePath || options.planFallback ? undefined : file,
      };
      try {
        let content: string | null = null;
        // 新章节不把当前编辑器当目标正文；已保存的当前文件仍可作为普通项目参考。
        if (file && ref && !options.targetFilePath && !options.planFallback) {
          await flushActiveEditorToDisk(file);
          content = await TauriFileSystem.readProjectFile(project, file);
        }
        const contextFile = options.targetFilePath
          ? resolveProjectRelativePath(project, options.targetFilePath)
          : options.planFallback
            ? null
            : file;
        // 只排除另行携带的目标正文，不能漏掉起草新章时恰好打开的设定或上一章。
        const currentRelative = contextFile ? relativePath(project, contextFile) : null;
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
            currentFile: contextFile,
            pinnedFiles: [...explicitContextPaths, ...requestedContextPaths],
          }),
          project,
          contextRefs,
        );
        if (abandonIfTaskMoved()) return unsettled;
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
        if (abandonIfTaskMoved()) return unsettled;
        const response = await sendAgentUserMessage({
          sessionId: runId,
          runId,
          stream: true,
          assistantSessionId,
          userMessage: goal,
          intent,
          permissionProfile: runPermissionProfile,
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

        if (!ownsRun()) {
          // 归属判据用 claim 而非 active()：切会话会让 active() 为 false，那样 busy 永不归位；
          // claim 已被更新的 run 接管时才不动作，避免误清新 run 的 busy。
          if (isClaimedBy(runId)) setAgentBusy(false);
          return unsettled;
        }

        if (isAgentErrorMessage(response)) {
          updateAgentStatus('failed');
          setRetryRequest(retryRequest);
          settleDiagnostic(`这轮没跑通：${response.detail}`);
          void refreshAgentRunRecovery(response.run_id ?? runId);
          return settled();
        }

        if (!isAgentResultMessage(response)) {
          const detail = `AI 返回了暂不支持的消息：${response.type}`;
          updateAgentStatus('failed');
          setRetryRequest(retryRequest);
          settleDiagnostic(detail);
          void refreshAgentRunRecovery(runId);
          return settled();
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
          const proposalFile = emitProposedPatchOutcome({
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
          return settled(
            proposalFile === null
              ? null
              : {
                  patchId: proposed.id,
                  filePath: proposalFile,
                  requiresConfirmation: proposed.requires_confirmation !== false,
                },
          );
        }

        const repairProposal = repairPatchApproval(response);
        if (repairProposal) {
          setPendingRepairCommand(repairProposal.command);
          settleText(repairProposal.summary);
          // P1-2：无 approval_command 时接受按钮静默无效，waiting 成死路，仅有真批准路径才置。
          const allowsWaiting =
            repairProposal.command && response.agent_result.requires_user_confirmation;
          updateAgentStatus(allowsWaiting ? 'waiting' : resultStatus);
          return settled();
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
          return settled();
        }

        // 首次模型调用已明确失败且没有工具执行；部分完成/检查点恢复不能当成整轮重放。
        const loop = response.agent_result.chat_loop;
        const noToolCalls =
          loop === undefined ||
          (loop !== null &&
            typeof loop === 'object' &&
            'tool_call_count' in loop &&
            loop.tool_call_count === 0);
        if (
          resultStatus === 'failed' &&
          executionOutcome?.status === 'failed' &&
          executionOutcome.code === 'provider_error' &&
          response.tool_trace.length === 0 &&
          noToolCalls &&
          !responseChapterBrief &&
          !checkpointResumeFromResult(response)
        )
          setRetryRequest(retryRequest);
        settleText(response.agent_result.summary ?? '这轮已经完成。');
        // P1-2：纯文本总结无真批准路径，waiting 会让作者卡死在空按钮上；仅 chapterBrief 例外。
        updateAgentStatus(responseChapterBrief ? 'waiting' : resultStatus);
        return settled();
      } catch (error) {
        if (!ownsRun()) {
          // 归属判据用 claim 而非 active()：切会话会让 active() 为 false，那样 busy 永不归位；
          // claim 已被更新的 run 接管时才不动作，避免误清新 run 的 busy。
          if (isClaimedBy(runId)) setAgentBusy(false);
          return unsettled;
        }
        if (retainUnknown(error, runStartConversationKey, runId, retryRequest)) {
          textStream.hold(runId, 'unknown');
          return unsettled;
        }
        const message = error instanceof Error ? error.message : String(error);
        updateAgentStatus('failed');
        setRetryRequest(retryRequest);
        settleDiagnostic(`这轮没跑通：${message}`);
        return settled();
      } finally {
        releaseClaim(runId);
      }
    },
    [
      textStream,
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
