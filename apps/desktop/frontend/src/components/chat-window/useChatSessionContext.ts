import { useCallback, useEffect } from 'react';

import { getAssistantSession, listAssistantSessions } from '../../lib/api-client';
import {
  buildProjectIndex,
  normalizeProjectKnowledgePath,
  readProjectKnowledgeSelection,
  reconcileProjectKnowledgeSelection,
  writeProjectKnowledgeSelection,
} from '../../lib/project-context';
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
    setChapterBrief,
    setWritingRunProjection,
    setRetryRequest,
    setMessages,
    setConversationTitle,
    setLastReviewReport,
    setLastReviewReportFile,
    explicitContextPaths,
    setExplicitContextPaths,
    setAgentRunRecovery,
    setSessionLoadError,
    sessionLoadRetry,
    setAssistantSessions,
    setContextCandidates,
    contextCandidates,
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
      setChapterBrief(null);
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
      setMissingContextPaths([]);
      setAgentRunRecovery(null);
      setChapterBrief(null);
      setSessionLoadError(null);
    } else if (!preservesCurrentConversation) {
      setMessages([]);
      setConversationTitle(`会话 #${assistantSessionId}`);
      setLastReviewReport(null);
      setLastReviewReportFile(null);
      setExplicitContextPaths([]);
      setMissingContextPaths([]);
      setAgentRunRecovery(null);
      setChapterBrief(null);
      setSessionLoadError(null);
    }
  }, [
    assistantSessionId,
    draftNonceRef,
    previousAssistantSessionIdRef,
    projectPath,
    selfPersistedSessionIdRef,
    setAgentRun,
    setChapterBrief,
    setAgentRunRecovery,
    setConversationTitle,
    setExplicitContextPaths,
    setLastReviewReport,
    setLastReviewReportFile,
    setMessages,
    setMissingContextPaths,
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
      setExplicitContextPaths([]);
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
        const candidates = index.files.filter(
          (file) => file.kind !== 'export' && file.kind !== 'quality',
        );
        const storedKnowledge = readProjectKnowledgeSelection(projectPath);
        const restoredKnowledge = reconcileProjectKnowledgeSelection(storedKnowledge, candidates);
        writeProjectKnowledgeSelection(projectPath, restoredKnowledge.selected);
        setContextCandidates(candidates);
        setExplicitContextPaths((current) => {
          const kindByPath = new Map(
            candidates.map((file) => [file.relativePath.toLocaleLowerCase(), file.kind]),
          );
          const storedKeys = new Set(storedKnowledge.map((path) => path.toLocaleLowerCase()));
          const temporary = current.filter((path) => {
            const key = path.replace(/\\/g, '/').toLocaleLowerCase();
            return kindByPath.get(key) !== 'knowledge' && !storedKeys.has(key);
          });
          return [...temporary, ...restoredKnowledge.selected].slice(-12);
        });
        setMissingContextPaths(restoredKnowledge.missing);
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
    assistantSessionId,
    projectPath,
    setContextCandidates,
    setContextCandidatesError,
    setContextCandidatesLoading,
    setExplicitContextPaths,
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
    // draft→draft「新建会话」时 assistantSessionId 恒为 null、上面 keyed-on-assistantSessionId 的
    // 重置 effect 不重跑，必须显式清空本地对话视图，否则旧（未持久化的失败）消息残留到新 draft（UF-10）。
    setMessages([]);
    setConversationTitle('新的创作会话');
    setLastReviewReport(null);
    setLastReviewReportFile(null);
    const restoredKnowledge = reconcileProjectKnowledgeSelection(
      readProjectKnowledgeSelection(projectPath ?? ''),
      contextCandidates,
    );
    setExplicitContextPaths(restoredKnowledge.selected);
    setMissingContextPaths(restoredKnowledge.missing);
    setAgentRunRecovery(null);
    setSessionLoadError(null);
    onAssistantSessionChange?.(null);
  }, [
    draftNonceRef,
    contextCandidates,
    onAssistantSessionChange,
    projectPath,
    setAgentRunRecovery,
    setConversationTitle,
    setExplicitContextPaths,
    setLastReviewReport,
    setLastReviewReportFile,
    setMessages,
    setMissingContextPaths,
    setSessionLoadError,
  ]);

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
      const storedKnowledge = projectPath ? readProjectKnowledgeSelection(projectPath) : [];
      const normalizedPath = normalizeProjectKnowledgePath(path)?.toLocaleLowerCase();
      const wasStored = storedKnowledge.some(
        (storedPath) => storedPath.toLocaleLowerCase() === normalizedPath,
      );
      setExplicitContextPaths((prev) => {
        const next = prev.includes(path)
          ? prev.filter((item) => item !== path)
          : [...prev, path].slice(-12);
        const candidateKind = contextCandidates.find(
          (file) => file.relativePath === path || file.path === path,
        )?.kind;
        if ((candidateKind === 'knowledge' || wasStored) && projectPath) {
          const selectedKeys = new Set(
            next
              .map((selectedPath) =>
                normalizeProjectKnowledgePath(selectedPath)?.toLocaleLowerCase(),
              )
              .filter((key): key is string => Boolean(key)),
          );
          const knowledgePaths = [
            ...storedKnowledge.filter((storedPath) =>
              selectedKeys.has(storedPath.toLocaleLowerCase()),
            ),
            ...next.filter((selectedPath) =>
              contextCandidates.some(
                (file) =>
                  file.kind === 'knowledge' &&
                  (file.relativePath === selectedPath || file.path === selectedPath),
              ),
            ),
          ];
          writeProjectKnowledgeSelection(projectPath, knowledgePaths);
        }
        return next;
      });
      if (wasStored && explicitContextPaths.includes(path)) {
        setMissingContextPaths((missing) =>
          missing.filter((item) => item.toLocaleLowerCase() !== normalizedPath),
        );
      }
    },
    [
      contextCandidates,
      explicitContextPaths,
      projectPath,
      setExplicitContextPaths,
      setMissingContextPaths,
    ],
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
