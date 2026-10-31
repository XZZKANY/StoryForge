import { useCallback } from 'react';

import { reviseFileContent } from '../../lib/api-client';
import { streamContinueProse } from '../../lib/api/assistant';
import {
  buildInlineReviseInstruction,
  planCursorInsertion,
  planInlineReviseWindow,
  spliceInlineReviseWindow,
} from '../../lib/inline-chat';
import { resolveContinueAnchorLine } from '../../lib/inline-continue';
import { loadInlineContinueContext } from '../../lib/inline-continue-context';
import { restoreInputZone, swapZoneToLoading, swapZoneToStreaming } from './inline-chat-session';
import type { InlineDiff } from './useInlineDiff';
import type { InlineSessionState, UseInlineChatParams } from './useInlineSession';

// loading 阶段：发出修订（单发）或续写（流式）请求；取消即 abort 在途请求并收场。

export function useInlineRequest(
  { editorRef, filePathRef, projectName }: UseInlineChatParams,
  {
    sessionRef,
    sessionIdRef,
    sessionIdProjectRef,
    isSessionActive,
    teardown,
    flashStatus,
    qualifySession,
  }: InlineSessionState,
  { renderPlan, renderDiff }: InlineDiff,
) {
  // E16：loading 期间取消——abort 在途请求 + 收场 + 提示；Esc 与 loading 区「取消」键都走这里。
  const cancelLoading = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.phase !== 'loading') return;
    const wasContinue = session.mode === 'continue';
    session.abortController?.abort();
    teardown();
    flashStatus(wasContinue ? '已取消续写' : '已取消行间修订');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
  }, [flashStatus, teardown]);

  const send = useCallback(
    async (userInstruction: string) => {
      const editor = editorRef.current;
      const session = sessionRef.current;
      const path = filePathRef.current;
      if (!editor || !session || session.phase !== 'input' || !path) return;
      if (!qualifySession(session)) return;
      const instruction = userInstruction.trim();
      // 续写允许空指令（留空 = 就接着写）；修订必须说清改什么。
      if (!instruction && session.mode !== 'continue') return;

      const before = editor.getValue();
      const window = planInlineReviseWindow(before, session.anchor);
      let reviseInstruction = '';
      if (session.mode !== 'continue') {
        try {
          reviseInstruction = buildInlineReviseInstruction({
            anchorText: session.anchor.text,
            anchorRange: session.anchor,
            windowStartLine: window.startLine,
            isSelection: session.anchor.isSelection,
            userInstruction: instruction,
            isExcerpt: !window.isWholeDocument,
          });
        } catch (error) {
          // 本地预算拒绝不进入 loading，也不拆除作者仍可编辑的输入。
          flashStatus(error instanceof Error ? error.message : String(error), 'assertive');
          return;
        }
      }
      session.phase = 'loading';
      session.userInstruction = instruction;
      const controller = new AbortController();
      session.abortController = controller;
      // loading 阶段挂 Esc → 取消（teardown 摘掉；成功进 diff 前也主动摘，让 renderDiff 装自己的）。
      const onLoadingEsc = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancelLoading();
      };
      session.keydownHandler = onLoadingEsc;
      document.addEventListener('keydown', onLoadingEsc, true);

      const detachLoadingEsc = () => {
        if (session.keydownHandler === onLoadingEsc) {
          document.removeEventListener('keydown', onLoadingEsc, true);
          session.keydownHandler = null;
        }
      };

      if (session.mode === 'continue') {
        const anchorLine = resolveContinueAnchorLine(before, session.anchor.startLine);
        const stream = swapZoneToStreaming(
          editor,
          session,
          anchorLine,
          () => {
            if (isSessionActive(session)) cancelLoading();
          },
          // 模块级函数够不到 sessionRef，活跃守卫以闭包传入。
          () => isSessionActive(session),
        );
        try {
          const projectRoot = session.projectPath;
          const contextBundle = await loadInlineContinueContext(projectRoot, path);
          if (controller.signal.aborted || !qualifySession(session)) return;
          const result = await streamContinueProse({
            filePath: path,
            content: before,
            cursorLine: anchorLine,
            instruction: instruction || null,
            projectRoot,
            contextBundle: contextBundle ?? undefined,
            assistantSessionId: sessionIdRef.current,
            signal: controller.signal,
            onDelta: (text) => {
              if (!qualifySession(session)) return;
              stream.append(text);
            },
          });
          if (!qualifySession(session)) return;
          detachLoadingEsc();
          session.abortController = null;
          sessionIdRef.current = result.assistantSessionId;
          sessionIdProjectRef.current = projectRoot;
          session.model = result.model;
          // 权威结果是 done.text（后端已掐掉重抄的上文、裁到完整句末），不是 delta 的拼接。
          const plan = planCursorInsertion(before, anchorLine, result.text);
          if (plan.isNoop) {
            teardown();
            flashStatus('这一轮没有写出新内容，换个说法再试 Ctrl+Shift+K');
            return;
          }
          renderPlan(before, plan);
        } catch (error) {
          if (!qualifySession(session)) return;
          teardown();
          flashStatus(
            `续写失败：${error instanceof Error ? error.message : String(error)}`,
            'assertive',
          );
        }
        return;
      }

      swapZoneToLoading(
        editor,
        session,
        () => {
          if (isSessionActive(session)) cancelLoading();
        },
        () => isSessionActive(session),
      );

      try {
        const result = await reviseFileContent({
          filePath: path,
          content: window.text,
          instruction: reviseInstruction,
          projectName,
          projectRoot: session.projectPath,
          assistantSessionId: sessionIdRef.current,
          qualityGate: 'polish',
          signal: controller.signal,
        });
        // 用户可能在等待期间关了会话/切了文件。
        if (!qualifySession(session)) return;
        // 进 diff 前摘掉 loading 的 Esc 处理，避免与 renderDiff 装的重复。
        detachLoadingEsc();
        session.abortController = null;
        sessionIdRef.current = result.assistantSessionId;
        sessionIdProjectRef.current = session.projectPath;
        session.model = result.model;
        // 拼回整文再交给 renderDiff：夹紧、陈旧判定与写回一律仍以整文件为单位。
        renderDiff(before, spliceInlineReviseWindow(before, window, result.after));
      } catch (error) {
        // 主动取消、换文件/模型、继续输入后，不得恢复旧指令覆盖新工作。
        if (!qualifySession(session) || controller.signal.aborted) return;
        detachLoadingEsc();
        session.abortController = null;
        restoreInputZone(session, () => isSessionActive(session) && session.phase === 'input');
        flashStatus(
          `AI 修订失败（指令已保留，可修改后手动重试）：${error instanceof Error ? error.message : String(error)}`,
          'assertive',
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
    [
      cancelLoading,
      editorRef,
      filePathRef,
      flashStatus,
      projectName,
      isSessionActive,
      qualifySession,
      renderDiff,
      renderPlan,
      teardown,
    ],
  );

  return { send };
}
