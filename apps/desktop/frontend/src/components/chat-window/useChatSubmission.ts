import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  PATCH_REJECTED_EVENT,
  flushActiveEditorToDisk,
  type PatchRejection,
} from '../../lib/assistant-events';
import { requestCrossChapterConsistency } from '../../lib/api-client';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { formatCrossChapterFindings, resolveChapterRefs, type ChapterRef } from './cross-chapter';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import { buildRejectionPrompt, deriveConversationTitle } from './conversation-utils';
import type { ChatWindowProps, Message } from './types';
import type { ChatWindowState } from './useChatWindowState';
import type { RunAuthorAgent } from './useRunAuthorAgent';

export function useChatSubmission(
  state: ChatWindowState,
  runAuthorAgent: RunAuthorAgent,
  {
    projectPath,
    pendingInitialPrompt,
    onPendingInitialPromptConsumed,
  }: Pick<
    ChatWindowProps,
    'projectPath' | 'pendingInitialPrompt' | 'onPendingInitialPromptConsumed'
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
      // 跨章检查也置忙：禁用 composer + 让上面的 agentBusy 守卫真正拦住并发再提交（此前只提示不置忙）。
      setAgentBusy(true);
      // 跨章检查数十秒且无 AbortController，捕获起跑会话身份；期间作者切会话则结果不写回当前会话（UF-09）。
      const runStartConversationKey = conversationKey(
        projectPathRef.current,
        assistantSessionIdRef.current,
        draftNonceRef.current,
      );
      const isForActiveSession = () =>
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
          const content = await TauriFileSystem.readProjectFile(project, ref.path);
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
    [agentBusy, assistantSessionIdRef, draftNonceRef, projectPathRef, setAgentBusy, setMessages],
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
    await runAuthorAgent(instruction, undefined, chapterWritingIntent(instruction));
  }, [
    contextCandidates,
    input,
    messages.length,
    projectPath,
    runAuthorAgent,
    runCrossChapterConsistency,
    setConversationTitle,
    setInput,
    setMessages,
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
      await runAuthorAgent(instruction, undefined, chapterWritingIntent(instruction));
    },
    [
      contextCandidates,
      messages.length,
      projectPath,
      runAuthorAgent,
      runCrossChapterConsistency,
      setConversationTitle,
      setMessages,
    ],
  );

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
      void handleComposerSubmit(buildRejectionPrompt(rejection));
    };
    window.addEventListener(PATCH_REJECTED_EVENT, onPatchRejected);
    return () => window.removeEventListener(PATCH_REJECTED_EVENT, onPatchRejected);
  }, [handleComposerSubmit]);

  const userMessageHistory = useMemo(
    () => messages.filter((message) => message.role === 'user').map((message) => message.content),
    [messages],
  );

  const pendingPromptFiredRef = useRef(false);
  useEffect(() => {
    if (!pendingInitialPrompt || !projectPath || agentBusy) return;
    if (pendingPromptFiredRef.current) return;
    pendingPromptFiredRef.current = true;
    onPendingInitialPromptConsumed?.();
    void handleComposerSubmit(pendingInitialPrompt);
  }, [
    agentBusy,
    handleComposerSubmit,
    onPendingInitialPromptConsumed,
    pendingInitialPrompt,
    projectPath,
  ]);

  return { handleSubmit, handleComposerSubmit, userMessageHistory };
}

function chapterWritingIntent(text: string): 'chapter.write' | undefined {
  if (/重写|改写|修改|修订|润色/.test(text)) return undefined;
  return /写一章|写第[一二三四五六七八九十百零〇两\d]+章|起草第[一二三四五六七八九十百零〇两\d]+章|生成第[一二三四五六七八九十百零〇两\d]+章/.test(
    text,
  )
    ? 'chapter.write'
    : undefined;
}
