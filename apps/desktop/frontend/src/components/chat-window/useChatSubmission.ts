import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  PATCH_REJECTED_EVENT,
  flushActiveEditorToDisk,
  type PatchRejection,
} from '../../lib/assistant-events';
import { requestCrossChapterConsistency } from '../../lib/api-client';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { formatCrossChapterFindings, resolveChapterRefs, type ChapterRef } from './cross-chapter';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import { emitToast } from '../../lib/toast';
import { useConversationScope } from './useConversationScope';
import { buildRejectionPrompt, deriveConversationTitle } from './conversation-utils';
import type { ChatWindowProps } from './types';
import type { ChatWindowState } from './useChatWindowState';
import type { RunAuthorAgent } from './useRunAuthorAgent';

export type QueuedChatMessage = {
  id: number;
  content: string;
};

type QueuedChatMessageEntry = QueuedChatMessage & { scope: number };

export function useChatSubmission(
  state: ChatWindowState,
  runAuthorAgent: RunAuthorAgent,
  {
    projectPath,
    assistantSessionId,
    pendingInitialPrompt,
    onPendingInitialPromptConsumed,
  }: Pick<
    ChatWindowProps,
    'projectPath' | 'assistantSessionId' | 'pendingInitialPrompt' | 'onPendingInitialPromptConsumed'
  >,
) {
  const {
    agentBusy,
    setAgentBusy,
    setMessages,
    projectPathRef,
    assistantSessionIdRef,
    draftNonceRef,
    input,
    setInput,
    messages,
    setConversationTitle,
    contextCandidates,
  } = state;

  const { scope, isCurrentScope } = useConversationScope(
    projectPath,
    assistantSessionId ?? null,
    state,
  );
  // Deliberately one pending instruction, not an automatic multi-run FIFO.
  const queuedRef = useRef<QueuedChatMessageEntry | null>(null);
  const nextQueueIdRef = useRef(0);
  const [queuedMessage, setQueuedMessage] = useState<QueuedChatMessageEntry | null>(null);
  const sendingRef = useRef<object | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const clearQueuedMessages = useCallback(() => {
    queuedRef.current = null;
    setQueuedMessage(null);
  }, []);
  const removeQueuedMessage = useCallback((id: number) => {
    if (queuedRef.current?.id !== id) return;
    queuedRef.current = null;
    setQueuedMessage(null);
  }, []);
  useEffect(() => {
    if (queuedRef.current && queuedRef.current.scope !== scope) clearQueuedMessages();
  }, [scope, clearQueuedMessages]);
  useEffect(
    () => () => {
      queuedRef.current = null;
    },
    [],
  );

  const runCrossChapterConsistency = useCallback(
    async (instruction: string, refs: ChapterRef[]) => {
      if (!isCurrentScope()) return;
      if (agentBusy) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '这轮还在整理，稍后再发跨章检查。' },
        ]);
        return;
      }
      const names = refs.map((item) => item.name);
      // 跨章检查也置忙：禁用 composer + 让上面的 agentBusy 守卫真正拦住并发再提交（此前只提示不置忙）。
      setAgentBusy(true);
      // 跨章检查数十秒且无 AbortController，捕获起跑会话身份；期间作者切会话则结果不写回当前会话（UF-09）。
      const runStartConversationKey = conversationKey(
        projectPathRef.current,
        assistantSessionIdRef.current,
        draftNonceRef.current,
      );
      const isForActiveSession = () =>
        isCurrentScope() &&
        isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          runStartConversationKey,
        );
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `跨章一致性检查中…(${names.join(' / ')})` },
      ]);
      try {
        const project = projectPathRef.current;
        if (!project) throw new Error('当前项目已关闭，无法读取跨章上下文。');
        const chapters: { name: string; content: string }[] = [];
        for (const ref of refs) {
          await flushActiveEditorToDisk(ref.path);
          if (!isForActiveSession()) return;
          const content = await TauriFileSystem.readProjectFile(project, ref.path);
          if (!isForActiveSession()) return;
          chapters.push({ name: ref.name, content });
        }
        const result = await requestCrossChapterConsistency({ chapters, focus: instruction });
        if (!isForActiveSession()) return; // 切会话：不写回当前会话；finally 仍释放 agentBusy
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: formatCrossChapterFindings(result.findings, names, result.model),
          },
        ]);
      } catch (error) {
        if (!isForActiveSession()) return; // 切会话：不写回当前会话；finally 仍释放 agentBusy
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `跨章检查失败：${error instanceof Error ? error.message : String(error)}`,
          },
        ]);
      } finally {
        setAgentBusy(false);
      }
    },
    [
      agentBusy,
      assistantSessionIdRef,
      draftNonceRef,
      isCurrentScope,
      projectPathRef,
      setAgentBusy,
      setMessages,
    ],
  );

  const awaitingDecision = Boolean(state.chapterBrief) || state.agentRun?.status === 'waiting';
  const submitInstruction = useCallback(
    async (value: string, fromComposer = false, decisionResolved = false) => {
      const instruction = value.trim();
      if (!instruction || !projectPath || !isCurrentScope()) return;
      const preserveInstruction = () => {
        if (!fromComposer)
          setInput((draft) =>
            draft.trim() === instruction ? draft : draft ? `${draft}\n\n${instruction}` : value,
          );
      };
      if (awaitingDecision && !decisionResolved) {
        preserveInstruction();
        emitToast('先处理当前待确认内容，再发下一条；待发消息和草稿已保留。', { tone: 'info' });
        return;
      }
      const clearSubmittedDraft = () => {
        if (fromComposer) setInput((current) => (current === value ? '' : current));
      };
      if (agentBusy) {
        if (queuedRef.current?.scope === scope) {
          preserveInstruction();
          emitToast('已有一条待发送消息。请先取消它，或保留当前草稿稍后发送。', { tone: 'info' });
          return;
        }
        const entry = { id: ++nextQueueIdRef.current, content: instruction, scope };
        queuedRef.current = entry;
        setQueuedMessage(entry);
        clearSubmittedDraft();
        return;
      }
      // Claim synchronously; React's busy state alone does not guard same-frame submits.
      if (sendingRef.current) {
        preserveInstruction();
        return;
      }
      const claim = {};
      sendingRef.current = claim;
      setSubmitting(true);
      if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
      setMessages((prev) => [...prev, { role: 'user', content: instruction }]);
      clearSubmittedDraft();
      try {
        const chapterRefs = resolveChapterRefs(instruction, contextCandidates);
        if (chapterRefs.length >= 2) {
          await runCrossChapterConsistency(instruction, chapterRefs);
        } else {
          await runAuthorAgent(instruction, undefined, chapterWritingIntent(instruction));
        }
      } finally {
        if (sendingRef.current === claim) {
          sendingRef.current = null;
          setSubmitting(false);
        }
      }
    },
    [
      agentBusy,
      awaitingDecision,
      contextCandidates,
      isCurrentScope,
      messages.length,
      projectPath,
      runAuthorAgent,
      runCrossChapterConsistency,
      scope,
      setConversationTitle,
      setInput,
      setMessages,
    ],
  );
  const handleSubmit = useCallback(
    () => submitInstruction(input, true),
    [input, submitInstruction],
  );
  const handleComposerSubmit = useCallback(
    (value: string) => submitInstruction(value),
    [submitInstruction],
  );

  // Keep the pending instruction visible through a patch/brief decision. Cancellation or
  // navigation before this microtask claims it wins; a new run never clears a newer draft.
  useEffect(() => {
    if (
      agentBusy ||
      submitting ||
      awaitingDecision ||
      !queuedMessage ||
      queuedMessage.scope !== scope
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (
        cancelled ||
        !isCurrentScope() ||
        queuedRef.current !== queuedMessage ||
        sendingRef.current
      )
        return;
      queuedRef.current = null;
      setQueuedMessage(null);
      void handleComposerSubmit(queuedMessage.content);
    });
    return () => {
      cancelled = true;
    };
  }, [
    agentBusy,
    submitting,
    awaitingDecision,
    handleComposerSubmit,
    isCurrentScope,
    queuedMessage,
    scope,
  ]);

  /**
   * 作者否掉一版并说了「该怎么改」时，把这句话当成一次真实的作者发言发出去。
   *
   * 走 handleComposerSubmit 而不是另起传输：它既进 UI 消息列表，也由后端落进
   * assistant_messages，于是自动进下一轮 prompt 的历史窗口——一行后端代码都不用改。
   * 没给方向就不发，否则每次拒绝都要烧一轮 BYO-key 去读一句「我没要」。
   */
  useEffect(() => {
    const onPatchRejected = (event: Event) => {
      const rejection = (event as CustomEvent<PatchRejection>).detail;
      if (!rejection?.direction.trim()) return;
      if (
        state.agentRun?.status === 'waiting' &&
        !state.agentRun.steps.some((step) => step.patchId === rejection.patchId)
      )
        return;
      // The controls listener settles this exact patch in the same event. Do not use the
      // previous render's waiting flag to discard the author's explicit revision direction.
      void submitInstruction(buildRejectionPrompt(rejection), false, true);
    };
    window.addEventListener(PATCH_REJECTED_EVENT, onPatchRejected);
    return () => window.removeEventListener(PATCH_REJECTED_EVENT, onPatchRejected);
  }, [state.agentRun, submitInstruction]);

  const userMessageHistory = useMemo(
    () => messages.filter((message) => message.role === 'user').map((message) => message.content),
    [messages],
  );

  const pendingPromptFiredRef = useRef(false);
  useEffect(() => {
    if (!pendingInitialPrompt || !projectPath || agentBusy || awaitingDecision) return;
    if (pendingPromptFiredRef.current) return;
    pendingPromptFiredRef.current = true;
    onPendingInitialPromptConsumed?.();
    void handleComposerSubmit(pendingInitialPrompt);
  }, [
    agentBusy,
    awaitingDecision,
    handleComposerSubmit,
    onPendingInitialPromptConsumed,
    pendingInitialPrompt,
    projectPath,
  ]);

  return {
    handleSubmit,
    handleComposerSubmit,
    userMessageHistory,
    queuedMessages: queuedMessage?.scope === scope ? [queuedMessage] : [],
    conversationScope: scope,
    removeQueuedMessage,
    clearQueuedMessages,
  };
}

function chapterWritingIntent(text: string): 'chapter.write' | undefined {
  if (/重写|改写|修改|修订|润色/.test(text)) return undefined;
  return /写一章|写第[一二三四五六七八九十百零〇两\d]+章|起草第[一二三四五六七八九十百零〇两\d]+章|生成第[一二三四五六七八九十百零〇两\d]+章/.test(
    text,
  )
    ? 'chapter.write'
    : undefined;
}
