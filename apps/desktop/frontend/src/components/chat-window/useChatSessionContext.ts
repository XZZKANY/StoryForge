import { useCallback, useEffect, useRef } from 'react';

import { getAssistantSession, listAssistantSessions } from '../../lib/api-client';
import {
  buildProjectIndex,
  normalizeProjectKnowledgePath,
  readProjectKnowledgeSelection,
  reconcileProjectKnowledgeSelection,
  writeProjectKnowledgeSelection,
} from '../../lib/project-context';
import { compactConversationMessages } from './conversation-utils';
import {
  leaveSessionConfirmText,
  pendingDecisionOnLeave,
  shouldResetRunPanels,
} from './session-switch';
import type { ChatWindowProps } from './types';
import { emitToast } from '../../lib/toast';
import { nextDraftNonce, type ChatWindowState } from './useChatWindowState';
import {
  useExternalWaits,
  useExternalWritebackCoordinator,
} from '../app/ExternalWritebackProvider';

/** 切会话/新建前的确认入口：与 AppDialog.confirm 同形，未接线时守卫降级为阻止 + toast。 */
export type SessionLeaveGuard = {
  confirmLeave?: (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
};

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
  leaveGuard: SessionLeaveGuard = {},
) {
  const {
    textStream,
    previousAssistantSessionIdRef,
    selfPersistedSessionIdRef,
    draftNonceRef,
    agentRun,
    chapterBrief,
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
    agentRunIdRef,
    agentBusy,
  } = state;
  const externalWriteback = useExternalWritebackCoordinator();
  const externalWaits = useExternalWaits(externalWriteback);
  const reloadedExternalCompletion = useRef('');
  useEffect(() => {
    // A cold wait has no page-local result callback. Reload durable history, never
    // invent a reply or replay a request. Live runs retain their existing callback.
    if (!projectPath || !assistantSessionId || agentRun || agentBusy) return;
    const completed = externalWaits.filter(
      (view) =>
        view.project === projectPath &&
        view.frame.assistant_session_id === assistantSessionId &&
        view.phase === 'finished' &&
        view.result,
    );
    if (!completed.length) return;
    const completion = JSON.stringify([
      projectPath,
      assistantSessionId,
      completed.map((view) => view.key).sort(),
    ]);
    if (reloadedExternalCompletion.current === completion) return;
    reloadedExternalCompletion.current = completion;
    setSessionLoadRetry((value) => value + 1);
  }, [projectPath, assistantSessionId, externalWaits, agentRun, agentBusy, setSessionLoadRetry]);

  useEffect(() => {
    const nextSessionId = assistantSessionId ?? null;
    const preservesCurrentConversation = selfPersistedSessionIdRef.current === nextSessionId;
    if (!preservesCurrentConversation) textStream.reset();
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
    textStream,
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
    const originalRunId = agentRunIdRef.current;
    const originalTextRevision = textStream.revision();
    setSessionLoadError(null);
    void getAssistantSession(assistantSessionId)
      .then((session) => {
        if (cancelled || agentRunIdRef.current !== originalRunId) return;
        if (session.id !== assistantSessionId) throw new Error('返回的会话归属不匹配');
        setConversationTitle(session.title.replace(/^IDE Agent:\s*/, '') || '新的创作会话');
        const ownsLiveWait = externalWriteback
          ?.getSnapshot()
          .some(
            (view) =>
              originalRunId !== null &&
              view.frame.run_id === originalRunId &&
              view.project === projectPath &&
              view.frame.assistant_session_id === assistantSessionId &&
              view.phase !== 'finished',
          );
        // While waiting, the API has not persisted the completed conversation yet.
        // Its empty history must not erase the page-local original user request.
        if (
          !ownsLiveWait &&
          !textStream.hasPending(originalRunId) &&
          originalTextRevision === textStream.revision()
        )
          setMessages((current) =>
            // A same-batch settlement may precede this GET. Keep the current
            // page's projection (including an unpersisted interrupted fragment).
            // Navigation clears messages, so cold history remains authoritative.
            current.some((message) => message.stream?.runId === originalRunId)
              ? current
              : compactConversationMessages(session.messages),
          );
      })
      .catch((error) => {
        if (cancelled || agentRunIdRef.current !== originalRunId) return;
        const detail = error instanceof Error ? error.message : String(error);
        setSessionLoadError(`会话 #${assistantSessionId} 加载失败：${detail}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    assistantSessionId,
    projectPath,
    externalWriteback,
    agentRunIdRef,
    sessionLoadRetry,
    textStream,
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

  // 有待确认内容（补丁 waiting / 章纲）时切会话、新建会撤掉对话区决策条，与发新消息的
  // awaitingConfirm 口径一致：先经作者确认才放行；返回 null 表示无待确认、可直接执行。
  const confirmLeave = leaveGuard.confirmLeave;
  const confirmPendingLeave = useCallback(
    (action: 'switch' | 'new'): Promise<boolean> | null => {
      const pending = pendingDecisionOnLeave(agentRun, chapterBrief);
      if (!pending) return null;
      if (!confirmLeave) {
        emitToast(`先处理当前待确认内容，再${action === 'new' ? '新建' : '切换'}会话。`, {
          tone: 'info',
        });
        return Promise.resolve(false);
      }
      return confirmLeave({
        title: action === 'new' ? '新建会话？' : '切换会话？',
        message: leaveSessionConfirmText(pending, action),
        confirmLabel: action === 'new' ? '仍要新建' : '仍要切换',
        cancelLabel: '留在这里',
      });
    },
    [agentRun, chapterBrief, confirmLeave],
  );

  const handleSelectSession = useCallback(
    (id: number) => {
      if (id === (assistantSessionId ?? null)) return;
      const confirmation = confirmPendingLeave('switch');
      if (!confirmation) {
        onAssistantSessionChange?.(id);
        return;
      }
      void confirmation.then((confirmed) => {
        if (confirmed) onAssistantSessionChange?.(id);
      });
    },
    [assistantSessionId, confirmPendingLeave, onAssistantSessionChange],
  );

  // 返回是否真正完成了切换：调用方藉此决定要不要同步清理排队消息等派生态。
  const handleNewSession = useCallback((): boolean | Promise<boolean> => {
    const startNewSession = () => {
      textStream.reset();
      draftNonceRef.current = nextDraftNonce();
      // draft→draft 时 assistantSessionId 仍为 null，session effect 不会重跑；显式清掉
      // 旧 run/brief/projection，避免总览把上一轮活动错投影到新会话。
      setAgentRun(null);
      setChapterBrief(null);
      setWritingRunProjection(null);
      setRetryRequest(null);
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
      return true;
    };
    const confirmation = confirmPendingLeave('new');
    if (!confirmation) return startNewSession();
    return confirmation.then((confirmed) => (confirmed ? startNewSession() : false));
  }, [
    textStream,
    confirmPendingLeave,
    draftNonceRef,
    contextCandidates,
    onAssistantSessionChange,
    projectPath,
    setAgentRun,
    setAgentRunRecovery,
    setChapterBrief,
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
