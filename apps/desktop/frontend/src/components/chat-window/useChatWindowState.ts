import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChatTextStream } from './useChatTextStream';

import type { AssistantSessionRecord } from '../../lib/api-client';
import { EDITOR_AUTHOR_VIEW_EVENT, type EditorAuthorViewDetail } from '../../lib/assistant-events';
import type { ContextBundle, SemanticFile } from '../../lib/project-context';
import type { AgentRunRecoveryDisplay } from './recovery';
import { conversationKey } from './session-guard';
import type {
  AgentRun,
  ChapterBrief,
  ChatWindowProps,
  Message,
  PendingRepairCommand,
  RetryRequest,
  ReviewReport,
} from './types';
import { basename, relativePath } from './path-utils';

let draftNonceCounter = 0;

export function nextDraftNonce(): string {
  draftNonceCounter += 1;
  return `draft-${draftNonceCounter}`;
}

export function useChatWindowState({
  projectPath,
  currentFile,
  assistantSessionId,
}: Pick<ChatWindowProps, 'projectPath' | 'currentFile' | 'assistantSessionId'>) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const textStream = useChatTextStream(setMessages);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [chapterBrief, setChapterBrief] = useState<ChapterBrief | null>(null);
  const [agentRunRecovery, setAgentRunRecovery] = useState<AgentRunRecoveryDisplay | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [pendingRepairCommand, setPendingRepairCommand] = useState<PendingRepairCommand | null>(
    null,
  );
  const [conversationTitle, setConversationTitle] = useState('新的创作会话');
  const [lastReviewReport, setLastReviewReport] = useState<ReviewReport | null>(null);
  const [lastReviewReportFile, setLastReviewReportFile] = useState<string | null>(null);
  const [explicitContextPaths, setExplicitContextPaths] = useState<string[]>([]);
  const [contextCandidates, setContextCandidates] = useState<SemanticFile[]>([]);
  const [contextCandidatesLoading, setContextCandidatesLoading] = useState(false);
  const [contextCandidatesError, setContextCandidatesError] = useState<string | null>(null);
  const [contextCandidatesRetry, setContextCandidatesRetry] = useState(0);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [sessionLoadRetry, setSessionLoadRetry] = useState(0);
  const [assistantSessions, setAssistantSessions] = useState<AssistantSessionRecord[]>([]);
  const [lastContextBundle, setLastContextBundle] = useState<ContextBundle | null>(null);
  const [missingContextPaths, setMissingContextPaths] = useState<string[]>([]);

  const projectName = projectPath ? basename(projectPath) : null;
  const contextRef = currentFile ? relativePath(projectPath, currentFile) : null;
  const contextRefRef = useRef<string | null>(contextRef);
  const currentFileRef = useRef<string | null>(currentFile);
  // 编辑器广播的作者当前视图（光标 + 选区）。用 ref 而非 state：它每 200ms 可能变一次，
  // 进 state 会让整个对话面板跟着作者移动光标重渲染。
  const authorViewRef = useRef<EditorAuthorViewDetail | null>(null);
  const projectPathRef = useRef<string | null>(projectPath);
  const agentRunIdRef = useRef<string | null>(null);
  const assistantSessionIdRef = useRef<number | null>(assistantSessionId ?? null);
  const previousAssistantSessionIdRef = useRef<number | null>(assistantSessionId ?? null);
  const selfPersistedSessionIdRef = useRef<number | null>(null);
  const [initialDraftNonce] = useState(nextDraftNonce);
  const draftNonceRef = useRef(initialDraftNonce);
  const runStartConversationKeyRef = useRef(
    conversationKey(projectPath, assistantSessionId ?? null, initialDraftNonce),
  );

  // layout effect：这些 ref 是提交期的归属判据（会话 id / 项目路径）。若放在被动 effect 里，
  // 同一 React 批内切会话后在跑的 await 恢复时会读到旧 ref，把旧资料拼进新会话请求。
  useLayoutEffect(() => {
    contextRefRef.current = contextRef;
    currentFileRef.current = currentFile;
    if (projectPathRef.current !== projectPath) textStream.reset();
    projectPathRef.current = projectPath;
    assistantSessionIdRef.current = assistantSessionId ?? null;
  });

  useEffect(() => {
    const onAuthorView = (event: Event) => {
      const detail = (event as CustomEvent<EditorAuthorViewDetail>).detail;
      if (detail) authorViewRef.current = detail;
    };
    window.addEventListener(EDITOR_AUTHOR_VIEW_EVENT, onAuthorView);
    return () => window.removeEventListener(EDITOR_AUTHOR_VIEW_EVENT, onAuthorView);
  }, []);

  return {
    input,
    setInput,
    messages,
    setMessages,
    textStream,
    agentRun,
    setAgentRun,
    chapterBrief,
    setChapterBrief,
    agentRunRecovery,
    setAgentRunRecovery,
    agentBusy,
    setAgentBusy,
    retryRequest,
    setRetryRequest,
    pendingRepairCommand,
    setPendingRepairCommand,
    conversationTitle,
    setConversationTitle,
    lastReviewReport,
    setLastReviewReport,
    lastReviewReportFile,
    setLastReviewReportFile,
    explicitContextPaths,
    setExplicitContextPaths,
    contextCandidates,
    setContextCandidates,
    contextCandidatesLoading,
    setContextCandidatesLoading,
    contextCandidatesError,
    setContextCandidatesError,
    contextCandidatesRetry,
    setContextCandidatesRetry,
    contextPickerOpen,
    setContextPickerOpen,
    sessionLoadError,
    setSessionLoadError,
    sessionLoadRetry,
    setSessionLoadRetry,
    assistantSessions,
    setAssistantSessions,
    lastContextBundle,
    setLastContextBundle,
    missingContextPaths,
    setMissingContextPaths,
    projectName,
    contextRef,
    contextRefRef,
    currentFileRef,
    authorViewRef,
    projectPathRef,
    agentRunIdRef,
    assistantSessionIdRef,
    previousAssistantSessionIdRef,
    selfPersistedSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
  };
}

export type ChatWindowState = ReturnType<typeof useChatWindowState>;
