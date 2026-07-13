import { useEffect, useRef, useState } from 'react';

import type { AssistantSessionRecord } from '../../lib/api-client';
import type { ContextBundle, SemanticFile } from '../../lib/project-context';
import type { AgentRunRecoveryDisplay } from './recovery';
import { conversationKey } from './session-guard';
import type {
  AgentRun,
  ChatWindowProps,
  Message,
  PendingRepairCommand,
  RetryRequest,
  ReviewReport,
  WritingRunProjection,
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
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
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
  const previousAssistantSessionIdRef = useRef<number | null>(assistantSessionId ?? null);
  const selfPersistedSessionIdRef = useRef<number | null>(null);
  const [initialDraftNonce] = useState(nextDraftNonce);
  const draftNonceRef = useRef(initialDraftNonce);
  const runStartConversationKeyRef = useRef(
    conversationKey(assistantSessionId ?? null, initialDraftNonce),
  );
  const unsubscribeWritingRunRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    contextRefRef.current = contextRef;
    currentFileRef.current = currentFile;
    projectPathRef.current = projectPath;
    assistantSessionIdRef.current = assistantSessionId ?? null;
  });

  useEffect(
    () => () => {
      unsubscribeWritingRunRef.current?.();
      unsubscribeWritingRunRef.current = null;
    },
    [],
  );

  return {
    input,
    setInput,
    messages,
    setMessages,
    agentRun,
    setAgentRun,
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
    writingRunProjection,
    setWritingRunProjection,
    projectName,
    contextRef,
    contextRefRef,
    currentFileRef,
    projectPathRef,
    agentRunIdRef,
    assistantSessionIdRef,
    previousAssistantSessionIdRef,
    selfPersistedSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    unsubscribeWritingRunRef,
  };
}

export type ChatWindowState = ReturnType<typeof useChatWindowState>;
