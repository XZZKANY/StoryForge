import { useCallback, useEffect, useMemo, useRef } from 'react';

import { flushActiveEditorToDisk } from '../../lib/assistant-events';
import { requestCrossChapterConsistency } from '../../lib/api-client';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { formatCrossChapterFindings, resolveChapterRefs, type ChapterRef } from './cross-chapter';
import { deriveConversationTitle } from './conversation-utils';
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
      } finally {
        setAgentBusy(false);
      }
    },
    [agentBusy, projectPathRef, setAgentBusy, setMessages],
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
      await runAuthorAgent(instruction);
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
