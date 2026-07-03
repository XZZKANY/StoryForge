/**
 * 对话窗口
 * 显示完整的消息历史流，并驱动 Agent 作者闭环。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AUTHOR_LOOP_RESULT_EVENT,
  emitAcceptCurrentFileSuggestion,
  emitExportCurrentFile,
  emitFileSuggestion,
  emitReviewIssues,
  emitSuggestionResult,
  flushActiveEditorToDisk,
  SUGGESTION_RESULT_EVENT,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../lib/assistant-events';
import { createRemoteFileSuggestion } from '../lib/assistant-suggestions';
import { extractAgentRoleMentions, mapAgentRoleMentionsToHints } from '../lib/agent-roles';
import {
  executeIdeCommand,
  getAssistantSession,
  getAgentRunSavePoints,
  requestCrossChapterConsistency,
  sendAgentControlMessage,
  sendAgentUserMessage,
  subscribeWritingRunEvents,
  isAgentControlAckMessage,
  isAgentErrorMessage,
  isAgentPermissionRequiredMessage,
  isAgentRunStartedMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
  isAgentResultMessage,
  type AgentControlMessageType,
  type AgentResultMessage,
  type AgentSocketMessage,
} from '../lib/api-client';
import {
  detectLocalConversationAction,
  type LocalConversationAction,
} from '../lib/local-conversation-action';
import {
  buildContextBundle,
  buildProjectIndex,
  classifyRelativePath,
  relativeToProject,
  type ContextBundle,
  type ContextBundleFile,
  type SemanticFile,
} from '../lib/project-context';
import { TauriFileSystem } from '../lib/tauri-fs';
import {
  resolveChapterRefs,
  formatCrossChapterFindings,
  type ChapterRef,
} from './chat-window/cross-chapter';
import {
  stepFromAgentPlanEvent,
  stepFromToolTraceEvent,
  stepsFromAgentResult,
} from './chat-window/agent-step-mapping';
import { ComposerBox } from './chat-window/Composer';
import {
  compactConversationMessages,
  deriveConversationTitle,
  titleFromSystemJobs,
} from './chat-window/conversation-utils';
import { runStatusText } from './chat-window/display-utils';
import {
  ConversationHeader,
  AgentRunRecoveryPanel,
  LightweightStatus,
  MessageList,
  WritingRunProgressPanel,
} from './chat-window/panels';
import {
  basename,
  extractContextReferences,
  joinProjectPath,
  looksAbsolutePath,
  relativePath,
} from './chat-window/path-utils';
import { buildStableAgentRequestPayload } from './chat-window/request-payload';
import { buildAgentRunRecoveryDisplay, type AgentRunRecoveryDisplay } from './chat-window/recovery';
import {
  extractIssueScopeFromInstruction,
  reviewIssuesFromReport,
  reviewReportFromMessage,
  reviewReportSummary,
  scopeWarningFromAgentResult,
} from './chat-window/review';
import type {
  AgentRun,
  AgentRunControlHandlers,
  AgentStep,
  ChatWindowProps,
  ContextAppendResult,
  Message,
  RetryRequest,
  ReviewReport,
  StableAgentRequestPayload,
  WritingRunProjection,
} from './chat-window/types';
import {
  displayFromResumeDiagnostic,
  statusFromAgentResult,
  stepsFromResumedAgentResult,
} from './chat-window/resumed-result';
import { applyWritingRunEventProjection, writingRunIdFromResult } from './chat-window/writing-run';

export {
  AgentRunRecoveryPanel,
  applyWritingRunEventProjection,
  buildAgentRunRecoveryDisplay,
  buildStableAgentRequestPayload,
  extractIssueScopeFromInstruction,
  filePathFromAgentResult,
  repairPatchApproval,
  reviewIssuesFromReport,
  scopeWarningFromAgentResult,
  displayFromResumeDiagnostic,
  shouldApplyAgentControlAck,
  statusFromAgentResult,
  stepsFromResumedAgentResult,
  WritingRunProgressPanel,
  writingRunIdFromResult,
};
export type { StableAgentRequestPayload };

function fileRevisionPatch(message: AgentResultMessage): {
  id?: string;
  file_path: string;
  before: string;
  after: string;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'file_revision') return null;
  if (
    typeof patch.file_path === 'string' &&
    typeof patch.before === 'string' &&
    typeof patch.after === 'string'
  ) {
    return {
      id: typeof patch.id === 'string' ? patch.id : undefined,
      file_path: patch.file_path,
      before: patch.before,
      after: patch.after,
    };
  }
  return null;
}

function repairPatchApproval(message: AgentResultMessage): {
  summary: string;
  command: { command_id: string; args: Record<string, unknown> } | null;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'repair_patch') return null;
  const repair =
    patch.repair_patch && typeof patch.repair_patch === 'object'
      ? (patch.repair_patch as Record<string, unknown>)
      : {};
  const targetSpan = typeof repair.target_span === 'string' ? repair.target_span : '';
  const replacement = typeof repair.replacement_text === 'string' ? repair.replacement_text : '';
  const reason = typeof repair.reason === 'string' ? repair.reason : '';
  const rawCommand = patch.approval_command;
  const command =
    rawCommand &&
    typeof rawCommand === 'object' &&
    typeof (rawCommand as { command_id?: unknown }).command_id === 'string'
      ? {
          command_id: (rawCommand as { command_id: string }).command_id,
          args:
            (rawCommand as { args?: unknown }).args &&
            typeof (rawCommand as { args?: unknown }).args === 'object'
              ? (rawCommand as { args: Record<string, unknown> }).args
              : {},
        }
      : null;
  const lines = [
    targetSpan || replacement
      ? `章节修复建议：将「${targetSpan}」替换为「${replacement}」。`
      : '章节修复建议已生成。',
    reason,
    command
      ? `点击「批准」将执行 ${command.command_id} 完成写回。`
      : '该补丁缺少可执行的批准命令，暂时无法从对话内写回。',
  ];
  return { summary: lines.filter(Boolean).join('\n'), command };
}

function filePathFromAgentResult(message: AgentResultMessage): string | null {
  const patch = fileRevisionPatch(message);
  if (patch) return patch.file_path;
  const report = reviewReportFromMessage(message);
  const filePath = report?.file_path;
  return typeof filePath === 'string' && filePath.trim() ? filePath : null;
}

function shouldApplyAgentControlAck(
  activeRunId: string | null,
  requestedRunId: string,
  ackRunId?: string,
): boolean {
  return activeRunId === requestedRunId && (!ackRunId || ackRunId === requestedRunId);
}

function modelFromToolTrace(message: AgentResultMessage): string {
  for (const trace of message.tool_trace) {
    const model = trace.output_summary?.model;
    if (typeof model === 'string' && model.trim()) return model;
  }
  return 'StoryForge Agent';
}

function issueIdsFromAgentResult(message: AgentResultMessage): string[] {
  const scope = message.agent_result.applied_scope;
  if (!scope || typeof scope !== 'object') return [];
  const ids = (scope as { issue_ids?: unknown }).issue_ids;
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : [];
}

async function appendExplicitContextFiles(
  bundle: ContextBundle,
  projectPath: string,
  explicitPaths: string[],
): Promise<ContextAppendResult> {
  const seen = new Set(bundle.files.map((file) => file.path));
  const seenRelative = new Set(
    bundle.files.map((file) => file.relativePath.replace(/\\/g, '/').toLowerCase()),
  );
  const added: ContextBundleFile[] = [];
  const missingPaths: string[] = [];
  for (const rawPath of explicitPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const path = looksAbsolutePath(trimmed) ? trimmed : joinProjectPath(projectPath, trimmed);
    const relativeCandidate = relativeToProject(projectPath, path);
    if (seen.has(path) || seenRelative.has(relativeCandidate.replace(/\\/g, '/').toLowerCase()))
      continue;
    try {
      const content = await TauriFileSystem.readFile(path);
      added.push({
        path,
        relativePath: relativeCandidate,
        kind: classifyRelativePath(relativeCandidate),
        title: basename(path),
        excerpt: content.trim().slice(0, 1200),
      });
      seen.add(path);
      seenRelative.add(relativeCandidate.replace(/\\/g, '/').toLowerCase());
    } catch {
      missingPaths.push(trimmed);
    }
  }
  if (added.length === 0) {
    return {
      bundle: {
        ...bundle,
        budget: {
          ...bundle.budget,
          missingPinnedFiles: Array.from(
            new Set([...bundle.budget.missingPinnedFiles, ...missingPaths]),
          ),
        },
      },
      missingPaths,
    };
  }
  const files = [...added, ...bundle.files].slice(0, 12);
  const missing = Array.from(new Set([...bundle.budget.missingPinnedFiles, ...missingPaths]));
  return {
    bundle: {
      ...bundle,
      files,
      budget: {
        ...bundle.budget,
        fileCount: files.length,
        charCount: files.reduce((total, file) => total + file.excerpt.length, 0),
        maxFiles: Math.max(bundle.budget.maxFiles, 12),
        truncated: bundle.budget.truncated || added.length + bundle.files.length > files.length,
        pinnedFileCount: Math.min(files.length, bundle.budget.pinnedFileCount + added.length),
        missingPinnedFiles: missing,
      },
    },
    missingPaths: missing,
  };
}

export function ChatWindow({
  projectPath,
  currentFile,
  assistantSessionId,
  pendingInitialPrompt,
  onPendingInitialPromptConsumed,
  layoutMode: _layoutMode = 'normal',
  onCollapse: _onCollapse,
  onFocusOnly: _onFocusOnly,
  onRestoreLayout: _onRestoreLayout,
  onAssistantSessionChange,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentRunRecovery, setAgentRunRecovery] = useState<AgentRunRecoveryDisplay | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  // repair_patch 的批准不是权限放行：必须先执行 approval_command（judge.approve）完成写回。
  const [pendingRepairCommand, setPendingRepairCommand] = useState<{
    command_id: string;
    args: Record<string, unknown>;
  } | null>(null);
  const [conversationTitle, setConversationTitle] = useState('新的创作会话');
  const [lastReviewReport, setLastReviewReport] = useState<ReviewReport | null>(null);
  const [lastReviewReportFile, setLastReviewReportFile] = useState<string | null>(null);
  const [explicitContextPaths, setExplicitContextPaths] = useState<string[]>([]);
  const [contextCandidates, setContextCandidates] = useState<SemanticFile[]>([]);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [lastContextBundle, setLastContextBundle] = useState<ContextBundle | null>(null);
  const [missingContextPaths, setMissingContextPaths] = useState<string[]>([]);
  const [writingRunProjection, setWritingRunProjection] = useState<WritingRunProjection | null>(
    null,
  );

  const projectName = projectPath ? basename(projectPath) : null;
  const contextRef = currentFile ? relativePath(projectPath, currentFile) : null;

  const contextRefRef = useRef<string | null>(contextRef);
  const currentFileRef = useRef<string | null>(currentFile);
  const projectPathRef = useRef<string | null>(projectPath);
  const agentRunIdRef = useRef<string | null>(null);
  const assistantSessionIdRef = useRef<number | null>(assistantSessionId ?? null);
  const unsubscribeWritingRunRef = useRef<(() => void) | null>(null);
  // 每次渲染后把最新值同步到 ref，供 WebSocket / 异步回调读取最新 props，避免闭包读到旧值。
  useEffect(() => {
    contextRefRef.current = contextRef;
    currentFileRef.current = currentFile;
    projectPathRef.current = projectPath;
    assistantSessionIdRef.current = assistantSessionId ?? null;
  });

  useEffect(() => {
    return () => {
      unsubscribeWritingRunRef.current?.();
      unsubscribeWritingRunRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!assistantSessionId) {
      setMessages([]);
      setConversationTitle('新的创作会话');
      setLastReviewReport(null);
      setLastReviewReportFile(null);
      setExplicitContextPaths([]);
      setAgentRunRecovery(null);
      return () => {
        cancelled = true;
      };
    }

    void getAssistantSession(assistantSessionId)
      .then((session) => {
        if (cancelled) return;
        setConversationTitle(session.title.replace(/^IDE Agent:\s*/, '') || '新的创作会话');
        setMessages(compactConversationMessages(session.messages));
      })
      .catch(() => {
        if (!cancelled) onAssistantSessionChange?.(null);
      });

    return () => {
      cancelled = true;
    };
  }, [assistantSessionId, onAssistantSessionChange]);

  useEffect(() => {
    if (!projectPath) {
      setContextCandidates([]);
      setLastContextBundle(null);
      setMissingContextPaths([]);
      setContextPickerOpen(false);
      return;
    }

    let cancelled = false;
    void buildProjectIndex(projectPath)
      .then((index) => {
        if (cancelled) return;
        setContextCandidates(
          index.files.filter((file) => file.kind !== 'export' && file.kind !== 'quality'),
        );
      })
      .catch(() => {
        if (!cancelled) setContextCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    setLastContextBundle(null);
    setMissingContextPaths([]);
    setContextPickerOpen(false);
    if (lastReviewReportFile && currentFile && lastReviewReportFile !== currentFile) {
      setLastReviewReport(null);
      setLastReviewReportFile(null);
    }
  }, [currentFile, lastReviewReportFile]);

  const updateAgentStep = useCallback((stepId: string, patch: Partial<AgentStep>) => {
    setAgentRun((run) => {
      if (!run) return run;
      return {
        ...run,
        steps: run.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      };
    });
  }, []);

  const updateAgentStatus = useCallback((status: AgentRun['status']) => {
    setAgentRun((run) => (run ? { ...run, status } : run));
    setAgentBusy(status === 'running');
  }, []);

  const refreshAgentRunRecovery = useCallback(async (runId: string) => {
    try {
      const projection = await getAgentRunSavePoints(runId);
      if (agentRunIdRef.current === runId) {
        setAgentRunRecovery(buildAgentRunRecoveryDisplay(projection));
      }
    } catch {
      if (agentRunIdRef.current === runId) {
        setAgentRunRecovery(null);
      }
    }
  }, []);

  const applyResumedAgentResult = useCallback(
    (response: AgentResultMessage) => {
      assistantSessionIdRef.current = response.assistant_session_id;
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
        emitFileSuggestion(
          createRemoteFileSuggestion({
            id: proposed.id,
            filePath: proposed.file_path,
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
          filePath: proposed.file_path,
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
          ? looksAbsolutePath(resultFilePath)
            ? resultFilePath
            : projectPathRef.current
              ? joinProjectPath(projectPathRef.current, resultFilePath)
              : resultFilePath
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
    [lastContextBundle, onAssistantSessionChange, updateAgentStatus],
  );

  const applyResumeDiagnostic = useCallback((diagnostic: Record<string, unknown>) => {
    const display = displayFromResumeDiagnostic(diagnostic);
    const resumeStep: AgentStep = {
      id: 'resume',
      title: '恢复 AgentRun',
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
  }, []);

  const addExplicitContext = useCallback(() => {
    setContextPickerOpen((open) => !open);
  }, []);

  const togglePinnedContext = useCallback((path: string) => {
    setExplicitContextPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path].slice(-12),
    );
  }, []);

  const applyAgentStreamEvent = useCallback(
    (message: AgentSocketMessage) => {
      if (isAgentRunStartedMessage(message)) {
        // 步骤树全事件驱动后，run 开始本身不再映射为独立步骤。
        return;
      }
      if (isAgentStepEventMessage(message)) {
        const nextStep = stepFromAgentPlanEvent(
          message.index,
          message.step,
          message.detail,
          message.status,
        );
        setAgentRun((run) => {
          if (!run) return run;
          const exists = run.steps.some((step) => step.id === nextStep.id);
          return {
            ...run,
            steps: exists
              ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
              : [...run.steps, nextStep],
          };
        });
        return;
      }
      if (isAgentToolTraceEventMessage(message)) {
        const nextStep = stepFromToolTraceEvent(message.index, message.trace);
        setAgentRun((run) => {
          if (!run) return run;
          const exists = run.steps.some((step) => step.id === nextStep.id);
          return {
            ...run,
            steps: exists
              ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
              : [...run.steps, nextStep],
          };
        });
        return;
      }
      if (isAgentPermissionRequiredMessage(message)) {
        const nextStep: AgentStep = {
          id: 'permission-required',
          title: '等待权限确认',
          tool: 'permission-gate',
          status: 'waiting',
          detail: message.proposed_patch
            ? '已生成待确认补丁，写回前需要作者批准。'
            : '该步骤需要作者批准后才能继续。',
        };
        setAgentRun((run) => {
          if (!run) return run;
          const exists = run.steps.some((step) => step.id === nextStep.id);
          return {
            ...run,
            status: 'waiting',
            steps: exists
              ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
              : [...run.steps, nextStep],
          };
        });
        setAgentBusy(false);
        void refreshAgentRunRecovery(message.run_id);
        return;
      }
      if (isAgentControlAckMessage(message)) {
        const nextStatus: AgentRun['status'] =
          message.type === 'stop_run' || message.type === 'permission_denied'
            ? 'failed'
            : message.type === 'pause_run'
              ? 'waiting'
              : message.type === 'resume_run'
                ? 'running'
                : 'completed';
        setAgentRun((run) => (run ? { ...run, status: nextStatus } : run));
        setAgentBusy(nextStatus === 'running');
        void refreshAgentRunRecovery(message.run_id);
      }
    },
    [refreshAgentRunRecovery],
  );

  const runAuthorAgent = useCallback(
    async (
      goal: string,
      action: LocalConversationAction = detectLocalConversationAction(goal),
      // 前端已知用户点的是「修订」时显式带上 intent，绕开后端 _detect_intent 关键词分类
      // （「问题/节奏/结构」恰是 file.review 关键词，会把修订指令误判成再次审稿）。
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
                ? '当前没有可写回或可定向修订的稿件。要改某一章，先在右侧打开那份正文；如果只是讨论项目，直接问我就行。'
                : '导出需要先在右侧打开一份当前稿。',
          },
        ]);
        return;
      }

      // 写回确认与导出是纯本地动作：不创建 agent run，直接交给编辑器事件流。
      if (writebackOnly) {
        emitAcceptCurrentFileSuggestion();
        return;
      }
      if (exportOnly) {
        if (file) await flushActiveEditorToDisk(file);
        emitExportCurrentFile();
        return;
      }

      const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      agentRunIdRef.current = runId;
      setAgentBusy(true);
      setRetryRequest(null);
      setAgentRunRecovery(null);
      setPendingRepairCommand(null);
      // 流程树全事件驱动：不预制前端骨架步骤，步骤只来自后端 plan/tool_trace 事件。
      setAgentRun({
        id: runId,
        sessionId: runId,
        goal,
        status: 'running',
        steps: [],
      });

      try {
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

        let content: string | null = null;
        if (file && ref) {
          await flushActiveEditorToDisk(file);
          content = await TauriFileSystem.readFile(file);
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

        assistantSessionIdRef.current = response.assistant_session_id;
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
                          detail: '等待作者在右侧 diff 面板确认',
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
          emitFileSuggestion(
            createRemoteFileSuggestion({
              id: proposed.id,
              filePath: proposed.file_path,
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
            filePath: proposed.file_path,
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
        const message = error instanceof Error ? error.message : String(error);
        updateAgentStatus('failed');
        setRetryRequest({ goal, action });
        setMessages((prev) => [...prev, { role: 'assistant', content: `这轮没跑通：${message}` }]);
      }
    },
    [
      agentBusy,
      applyAgentStreamEvent,
      explicitContextPaths,
      lastReviewReport,
      onAssistantSessionChange,
      projectName,
      updateAgentStatus,
      refreshAgentRunRecovery,
    ],
  );

  const retryLastFailedRun = useCallback(() => {
    if (!retryRequest || agentBusy) return;
    setMessages((prev) => [...prev, { role: 'user', content: `重试：${retryRequest.goal}` }]);
    void runAuthorAgent(retryRequest.goal, retryRequest.action, retryRequest.intent);
  }, [agentBusy, retryRequest, runAuthorAgent]);

  const sendAgentRunControl = useCallback(
    async (type: AgentControlMessageType) => {
      const run = agentRun;
      if (!run) return;
      if (type === 'approve_permission' && pendingRepairCommand) {
        // 修复补丁的「批准」必须先真正执行写回命令，否则补丁停留在未写回状态，
        // run 却被标记完成，作者以为已经改完了。
        try {
          await executeIdeCommand(pendingRepairCommand.command_id, pendingRepairCommand.args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `修复写回失败，补丁仍在等待确认：${message}` },
          ]);
          return;
        }
        setPendingRepairCommand(null);
        setMessages((prev) => [...prev, { role: 'assistant', content: '修复补丁已执行写回。' }]);
      } else if (type === 'deny_permission' && pendingRepairCommand) {
        setPendingRepairCommand(null);
      }
      try {
        const ack = await sendAgentControlMessage({
          sessionId: run.sessionId,
          runId: run.id,
          type,
          payload: { source: 'desktop.timeline' },
        });
        if (
          !shouldApplyAgentControlAck(
            agentRunIdRef.current,
            run.id,
            typeof ack.run_id === 'string' ? ack.run_id : undefined,
          )
        ) {
          return;
        }
        if (isAgentErrorMessage(ack)) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Agent 控制失败：${ack.detail}` },
          ]);
          return;
        }
        applyAgentStreamEvent(ack);
        if (ack.resumed_result && isAgentResultMessage(ack.resumed_result)) {
          applyResumedAgentResult(ack.resumed_result);
          void refreshAgentRunRecovery(ack.run_id);
          return;
        }
        if (ack.resume_diagnostic) {
          applyResumeDiagnostic(ack.resume_diagnostic);
          void refreshAgentRunRecovery(ack.run_id);
          return;
        }
        if (type === 'approve_permission') {
          updateAgentStep('permission-required', {
            status: 'completed',
            detail: '作者已批准权限请求。',
          });
          updateAgentStatus('completed');
        } else if (type === 'deny_permission') {
          updateAgentStep('permission-required', {
            status: 'failed',
            detail: '作者已拒绝权限请求。',
          });
          updateAgentStatus('failed');
        } else if (type === 'pause_run') {
          updateAgentStatus('waiting');
        } else if (type === 'resume_run') {
          updateAgentStatus('running');
        } else if (type === 'stop_run') {
          updateAgentStatus('failed');
        }
      } catch (error) {
        if (agentRunIdRef.current !== run.id) return;
        const message = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Agent 控制失败：${message}` },
        ]);
      }
    },
    [
      agentRun,
      applyAgentStreamEvent,
      applyResumeDiagnostic,
      applyResumedAgentResult,
      pendingRepairCommand,
      refreshAgentRunRecovery,
      updateAgentStatus,
      updateAgentStep,
    ],
  );

  const agentRunControls: AgentRunControlHandlers = {
    onApprovePermission: () => void sendAgentRunControl('approve_permission'),
    onDenyPermission: () => void sendAgentRunControl('deny_permission'),
    onPauseRun: () => void sendAgentRunControl('pause_run'),
    onResumeRun: () => void sendAgentRunControl('resume_run'),
    onStopRun: () => void sendAgentRunControl('stop_run'),
  };

  // 右侧 Editor 回传真实修订结果
  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      if (!result) return;
      const ref = result.filePath ? relativePath(projectPathRef.current, result.filePath) : null;
      const content =
        result.status === 'ready'
          ? `已生成对 \`${ref ?? result.filePath}\` 的 AI 修订，请在右侧查看 diff，可接受、拒绝或保存旁注。`
          : `AI 修订失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'ready' ? 'waiting' : 'failed',
          detail: result.status === 'ready' ? '等待作者在右侧 diff 面板确认' : result.message,
        });
        updateAgentStatus(result.status === 'ready' ? 'waiting' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onResult);
  }, [updateAgentStatus, updateAgentStep]);

  useEffect(() => {
    const onAuthorLoopResult = (event: Event) => {
      const result = (event as CustomEvent<AuthorLoopResult>).detail;
      if (!result) return;
      const ref = relativePath(projectPathRef.current, result.filePath);
      const content =
        result.status === 'completed'
          ? result.action === 'exported'
            ? `作者闭环已完成：\`${ref}\` 已导出为交付稿。\n${result.artifactPath ?? result.message}`
            : `作者闭环已完成：\`${ref}\` 已写回正文，并生成闭环记录。\n${result.recordPath ?? result.message}`
          : `作者闭环失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'completed' ? 'completed' : 'failed',
          detail: result.artifactPath ?? result.recordPath ?? result.message,
        });
        updateAgentStatus(result.status === 'completed' ? 'completed' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
    return () => window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
  }, [updateAgentStatus, updateAgentStep]);

  const runCrossChapterConsistency = useCallback(
    async (instruction: string, refs: ChapterRef[]) => {
      if (agentBusy) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '这轮还在整理，稍后再发跨章检查。' },
        ]);
        return;
      }
      const names = refs.map((item) => item.name);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `跨章一致性检查中…(${names.join(' / ')})` },
      ]);
      try {
        const chapters: { name: string; content: string }[] = [];
        for (const ref of refs) {
          await flushActiveEditorToDisk(ref.path);
          const content = await TauriFileSystem.readFile(ref.path);
          chapters.push({ name: ref.name, content });
        }
        const result = await requestCrossChapterConsistency({ chapters, focus: instruction });
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: formatCrossChapterFindings(result.findings, names, result.model),
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `跨章检查失败：${error instanceof Error ? error.message : String(error)}`,
          },
        ]);
      }
    },
    [agentBusy],
  );

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !projectPath) return;

    const instruction = input.trim();
    if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
    const userMessage: Message = { role: 'user', content: instruction };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    const chapterRefs = resolveChapterRefs(instruction, contextCandidates);
    if (chapterRefs.length >= 2) {
      await runCrossChapterConsistency(instruction, chapterRefs);
      return;
    }
    await runAuthorAgent(instruction);
  }, [
    input,
    messages.length,
    projectPath,
    contextCandidates,
    runAuthorAgent,
    runCrossChapterConsistency,
  ]);

  const handleComposerSubmit = useCallback(
    async (value: string) => {
      const instruction = value.trim();
      if (!instruction || !projectPath) return;
      if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
      setMessages((prev) => [...prev, { role: 'user', content: instruction }]);
      const chapterRefs = resolveChapterRefs(instruction, contextCandidates);
      if (chapterRefs.length >= 2) {
        await runCrossChapterConsistency(instruction, chapterRefs);
        return;
      }
      await runAuthorAgent(instruction);
    },
    [messages.length, projectPath, contextCandidates, runAuthorAgent, runCrossChapterConsistency],
  );

  // 欢迎页首条 prompt：项目就绪后自动发出一次，避免作者重复输入。
  const pendingPromptFiredRef = useRef(false);
  useEffect(() => {
    if (!pendingInitialPrompt || !projectPath || agentBusy) return;
    if (pendingPromptFiredRef.current) return;
    pendingPromptFiredRef.current = true;
    onPendingInitialPromptConsumed?.();
    void handleComposerSubmit(pendingInitialPrompt);
  }, [
    pendingInitialPrompt,
    projectPath,
    agentBusy,
    handleComposerSubmit,
    onPendingInitialPromptConsumed,
  ]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <ConversationHeader title={conversationTitle} />

      <MessageList
        messages={messages}
        projectName={projectName}
        currentFileLabel={contextRef}
        disabled={!projectPath || agentBusy}
        onSubmit={handleComposerSubmit}
        agentRun={agentRun}
        agentRunRecovery={agentRunRecovery}
        writingRunProjection={writingRunProjection}
        explicitContextPaths={explicitContextPaths}
        contextCandidates={contextCandidates}
        contextPickerOpen={contextPickerOpen}
        lastContextBundle={lastContextBundle}
        missingContextPaths={missingContextPaths}
        onAddContext={addExplicitContext}
        onTogglePinnedContext={togglePinnedContext}
        agentRunControls={agentRunControls}
      />

      {runStatusText(agentRun) && (
        <LightweightStatus
          text={runStatusText(agentRun) ?? ''}
          retryVisible={agentRun?.status === 'failed' && retryRequest !== null && !agentBusy}
          onRetry={retryLastFailedRun}
        />
      )}

      {messages.length > 0 && (
        <ComposerBox
          value={input}
          disabled={!projectPath}
          busy={agentBusy}
          currentFileLabel={contextRef}
          explicitContextPaths={explicitContextPaths}
          onAddContext={addExplicitContext}
          onChange={setInput}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
