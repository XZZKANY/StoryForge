import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { loadProjectSetupFacts, type ProjectSetupFacts } from '../../lib/api/project-setup';
import { useAsyncEffect } from '../../lib/async-guards';
import { AUTHOR_LOOP_RESULT_EVENT, type AuthorLoopResult } from '../../lib/assistant-events';
import type { HandoffChapter } from '../../lib/chapter-handoff';
import { composerHint } from '../../lib/composer-hint';
import { relativePathInsideProject } from '../../lib/project-context';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import type { Message } from './types';
import type { ChatWindowState } from './useChatWindowState';

type AcceptedMark = { relativePath: string; seq: number; scope: number; userTurns: number };

function lastCompleteAssistantText(messages: readonly Message[]): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return null;
  return last.stream && last.stream.phase !== 'complete' ? null : last.content;
}

/**
 * 输入框「下一句」提示的接线：刚接受记在这里，立项事实在开会话、接受成功、一轮结束时各读一次，
 * 规则全在 `lib/composer-hint.ts`。
 */
export function useComposerHint({
  state,
  projectPath,
  assistantSessionId,
  scope,
  chapters,
}: {
  state: ChatWindowState;
  projectPath: string | null;
  assistantSessionId: number | null;
  /** 会话生命周期（切会话 / 新建 / 换作品都会变）。 */
  scope: number;
  chapters: ReadonlyArray<HandoffChapter> | null;
}): string | null {
  const { messages, agentBusy, agentRun } = state;
  const { projectPathRef, assistantSessionIdRef, draftNonceRef, runStartConversationKeyRef } =
    state;
  const userTurns = messages.filter((message) => message.role === 'user').length;
  const liveRef = useRef({ scope, userTurns });
  useLayoutEffect(() => {
    liveRef.current = { scope, userTurns };
  });
  const [accepted, setAccepted] = useState<AcceptedMark | null>(null);
  const acceptSeqRef = useRef(0);

  // 与对话里「已写进…」同一个写回成功信号、同一个会话归属判断。
  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<AuthorLoopResult>).detail;
      if (result?.status !== 'completed' || result.action !== 'revision_accepted') return;
      const project = projectPathRef.current;
      const ours = result.runId
        ? result.projectPath === project &&
          result.assistantSessionId === assistantSessionIdRef.current
        : isRunResultForActiveSession(
            conversationKey(project, assistantSessionIdRef.current, draftNonceRef.current),
            runStartConversationKeyRef.current,
          );
      const relativePath = project ? relativePathInsideProject(project, result.filePath) : null;
      if (!ours || !relativePath) return;
      acceptSeqRef.current += 1;
      setAccepted({ relativePath, seq: acceptSeqRef.current, ...liveRef.current });
    };
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onResult);
    return () => window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onResult);
  }, [assistantSessionIdRef, draftNonceRef, projectPathRef, runStartConversationKeyRef]);

  const justAccepted =
    accepted && accepted.scope === scope && accepted.userTurns === userTurns ? accepted : null;

  const factsKey = projectPath
    ? [
        projectPath,
        scope,
        justAccepted?.seq ?? 0,
        `${agentRun?.id ?? ''}:${agentRun?.status ?? ''}`,
      ].join('\u0000')
    : null;
  const [facts, setFacts] = useState<{ key: string; facts: ProjectSetupFacts | null } | null>(null);
  useAsyncEffect(
    (isCurrent) => {
      if (!factsKey || !projectPath || agentBusy) return;
      loadProjectSetupFacts(projectPath).then(
        (loaded) => {
          if (isCurrent()) setFacts({ key: factsKey, facts: loaded });
        },
        // 读不出就不给依赖立项的那几条提示；不报错打扰作者。
        () => undefined,
      );
    },
    [agentBusy, factsKey, projectPath],
  );

  return composerHint({
    running: agentBusy,
    newSession: !assistantSessionId && messages.length === 0,
    lastAssistantText: lastCompleteAssistantText(messages),
    justAcceptedPath: justAccepted?.relativePath ?? null,
    setup: facts?.key === factsKey ? facts.facts : null,
    chapters,
  });
}
