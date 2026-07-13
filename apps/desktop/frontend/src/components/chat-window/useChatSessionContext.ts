import { useCallback, useEffect } from 'react';

import { getAssistantSession, listAssistantSessions } from '../../lib/api-client';
import { buildProjectIndex } from '../../lib/project-context';
import { compactConversationMessages } from './conversation-utils';
import { shouldResetRunPanels } from './session-switch';
import type { ChatWindowProps } from './types';
import { nextDraftNonce, type ChatWindowState } from './useChatWindowState';

export function useChatSessionContext(
  state: ChatWindowState,
  {
    projectPath,
    currentFile,
    assistantSessionId,
    onAssistantSessionChange,
  }: Pick<
    ChatWindowProps,
    'projectPath' | 'currentFile' | 'assistantSessionId' | 'onAssistantSessionChange'
  >,
) {
  const {
    previousAssistantSessionIdRef,
    selfPersistedSessionIdRef,
    draftNonceRef,
    setAgentRun,
    setWritingRunProjection,
    setRetryRequest,
    setMessages,
    setConversationTitle,
    setLastReviewReport,
    setLastReviewReportFile,
    setExplicitContextPaths,
    setAgentRunRecovery,
    setSessionLoadError,
    sessionLoadRetry,
    setAssistantSessions,
    setContextCandidates,
    setContextCandidatesLoading,
    setContextCandidatesError,
    contextCandidatesRetry,
    setLastContextBundle,
    setMissingContextPaths,
    setContextPickerOpen,
    lastReviewReportFile,
    setSessionLoadRetry,
    setContextCandidatesRetry,
  } = state;

  useEffect(() => {
    const nextSessionId = assistantSessionId ?? null;
    const preservesCurrentConversation = selfPersistedSessionIdRef.current === nextSessionId;
    if (shouldResetRunPanels(nextSessionId, selfPersistedSessionIdRef.current)) {
      setAgentRun(null);
      setWritingRunProjection(null);
      setRetryRequest(null);
    } else {
      selfPersistedSessionIdRef.current = null;
    }
    if (previousAssistantSessionIdRef.current !== null && nextSessionId === null) {
      draftNonceRef.current = nextDraftNonce();
    }
    previousAssistantSessionIdRef.current = nextSessionId;
    if (!assistantSessionId) {
      setMessages([]);
      setConversationTitle('新的创作会话');
      setLastReviewReport(null);
      setLastReviewReportFile(null);
      setExplicitContextPaths([]);
      setAgentRunRecovery(null);
      setSessionLoadError(null);
    } else if (!preservesCurrentConversation) {
      setMessages([]);
      setConversationTitle(`会话 #${assistantSessionId}`);
      setLastReviewReport(null);
      setLastReviewReportFile(null);
      setExplicitContextPaths([]);
      setAgentRunRecovery(null);
      setSessionLoadError(null);
    }
  }, [
    assistantSessionId,
    draftNonceRef,
    previousAssistantSessionIdRef,
    selfPersistedSessionIdRef,
    setAgentRun,
    setAgentRunRecovery,
    setConversationTitle,
    setExplicitContextPaths,
    setLastReviewReport,
    setLastReviewReportFile,
    setMessages,
    setRetryRequest,
    setSessionLoadError,
    setWritingRunProjection,
  ]);

  useEffect(() => {
    if (!assistantSessionId) return;
    let cancelled = false;
    setSessionLoadError(null);
    void getAssistantSession(assistantSessionId)
      .then((session) => {
        if (cancelled) return;
        setConversationTitle(session.title.replace(/^IDE Agent:\s*/, '') || '新的创作会话');
        setMessages(compactConversationMessages(session.messages));
      })
      .catch((error) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setSessionLoadError(`会话 #${assistantSessionId} 加载失败：${detail}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    assistantSessionId,
    sessionLoadRetry,
    setConversationTitle,
    setMessages,
    setSessionLoadError,
  ]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void listAssistantSessions({ projectPath, limit: 20 })
      .then((records) => {
        if (!cancelled) setAssistantSessions(records);
      })
      .catch(() => {
        if (!cancelled) setAssistantSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [assistantSessionId, projectPath, setAssistantSessions]);

  useEffect(() => {
    if (!projectPath) {
      setContextCandidates([]);
      setContextCandidatesLoading(false);
      setContextCandidatesError(null);
      setLastContextBundle(null);
      setMissingContextPaths([]);
      setContextPickerOpen(false);
      return;
    }
    let cancelled = false;
    setContextCandidates([]);
    setContextCandidatesLoading(true);
    setContextCandidatesError(null);
    void buildProjectIndex(projectPath)
      .then((index) => {
        if (cancelled) return;
        setContextCandidates(
          index.files.filter((file) => file.kind !== 'export' && file.kind !== 'quality'),
        );
        setContextCandidatesLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setContextCandidatesError(`上下文索引读取失败：${detail}`);
        setContextCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    contextCandidatesRetry,
    projectPath,
    setContextCandidates,
    setContextCandidatesError,
    setContextCandidatesLoading,
    setContextPickerOpen,
    setLastContextBundle,
    setMissingContextPaths,
  ]);

  useEffect(() => {
    setLastContextBundle(null);
    setMissingContextPaths([]);
    setContextPickerOpen(false);
    if (lastReviewReportFile && currentFile && lastReviewReportFile !== currentFile) {
      setLastReviewReport(null);
      setLastReviewReportFile(null);
    }
  }, [
    currentFile,
    lastReviewReportFile,
    setContextPickerOpen,
    setLastContextBundle,
    setLastReviewReport,
    setLastReviewReportFile,
    setMissingContextPaths,
  ]);

  const handleSelectSession = useCallback(
    (id: number) => {
      if (id === (assistantSessionId ?? null)) return;
      onAssistantSessionChange?.(id);
    },
    [assistantSessionId, onAssistantSessionChange],
  );

  const handleNewSession = useCallback(() => {
    draftNonceRef.current = nextDraftNonce();
    onAssistantSessionChange?.(null);
  }, [draftNonceRef, onAssistantSessionChange]);

  const retryAssistantSessionLoad = useCallback(() => {
    setSessionLoadRetry((attempt) => attempt + 1);
  }, [setSessionLoadRetry]);

  const retryContextCandidates = useCallback(() => {
    setContextCandidatesRetry((attempt) => attempt + 1);
  }, [setContextCandidatesRetry]);

  const addExplicitContext = useCallback(() => {
    setContextPickerOpen((open) => !open);
  }, [setContextPickerOpen]);

  const togglePinnedContext = useCallback(
    (path: string) => {
      setExplicitContextPaths((prev) =>
        prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path].slice(-12),
      );
    },
    [setExplicitContextPaths],
  );

  return {
    handleSelectSession,
    handleNewSession,
    retryAssistantSessionLoad,
    retryContextCandidates,
    addExplicitContext,
    togglePinnedContext,
  };
}
