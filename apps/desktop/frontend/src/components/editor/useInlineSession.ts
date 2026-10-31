import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import { allowsAuthoringActions, readAgentPermissionProfile } from '../../lib/agent-permission';
import { inlineSettleDurationMs } from '../../lib/inline-chat';
import { prefersReducedMotion } from '../../lib/motion';
import { buildInlineToast, type InlineMode } from './inline-chat-dom';
import type { InlineSession, WriteAcceptedSuggestion } from './inline-chat-session';

// 行间会话的所有者：当前会话与会话 id、归属守卫、收场 teardown、右下角 toast、接受落位动效。

export type UseInlineChatParams = {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  editorReady: boolean;
  filePath: string | null;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  projectName: string | null;
  writeAcceptedSuggestion: WriteAcceptedSuggestion;
  setSuggestionStatus: (status: string) => void;
};

export function useInlineSession({
  editorRef,
  filePathRef,
  projectPathRef,
  setSuggestionStatus,
}: UseInlineChatParams) {
  const sessionRef = useRef<InlineSession | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  // 会话 id 属于哪个项目：编辑器常驻、切项目不卸载，必须能识别旧项目的 id 并丢弃。
  const sessionIdProjectRef = useRef<string | null>(null);
  const registeredRef = useRef(false);
  // 快捷键命令只注册一次；用 ref 持有最新的 open 闭包，命令回调始终调到当前实现。
  const openRef = useRef<(mode?: InlineMode) => void>(() => {});

  const matchesSessionTarget = useCallback(
    (session: InlineSession) =>
      editorRef.current === session.editor &&
      session.editor.getModel() === session.textModel &&
      filePathRef.current === session.filePath &&
      projectPathRef.current === session.projectPath,
    [editorRef, filePathRef, projectPathRef],
  );
  const isSessionActive = useCallback(
    (session: InlineSession) => sessionRef.current === session && matchesSessionTarget(session),
    [matchesSessionTarget],
  );

  const teardown = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const editor = session.editor;
    session.abortController?.abort();
    if (session.keydownHandler) {
      document.removeEventListener('keydown', session.keydownHandler, true);
    }
    editor?.getContainerDomNode?.()?.classList.remove('sf-inline-accepting');
    session.decorations?.clear();
    if (editor && session.zoneIds.length > 0 && typeof editor.changeViewZones === 'function') {
      editor.changeViewZones((accessor) => {
        for (const id of session.zoneIds) accessor.removeZone(id);
      });
    }
    const zoneHost = session.accessibleZoneHost;
    if (zoneHost && zoneHost.node.getAttribute('aria-hidden') === 'false') {
      if (zoneHost.originalHidden === null) zoneHost.node.removeAttribute('aria-hidden');
      else zoneHost.node.setAttribute('aria-hidden', zoneHost.originalHidden);
    }
    // zone 拆掉后焦点会无家可归（回落 body）；只有焦点确实曾在 zone 里时才归还编辑器——
    // 否则换文件等路径会把焦点从作者正在用的别处（文件树/查找框）抢走。
    const focusWasInZone =
      document.activeElement instanceof Node &&
      session.zoneDoms.some((dom) => dom.contains(document.activeElement));
    sessionRef.current = null;
    if (focusWasInZone && matchesSessionTarget(session) && typeof editor.focus === 'function') {
      editor.focus();
    }
  }, [matchesSessionTarget]);

  // 行间的状态是「转瞬即逝的操作反馈」，不该像面板那样赖在编辑器顶栏（丑）。
  // 改成编辑器右下角的小 toast，几秒自动消失。拿不到宿主时退回顶栏状态。
  const statusTimerRef = useRef<number | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const clearToast = useCallback(() => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    toastRef.current?.remove();
  }, []);
  const flashStatus = useCallback(
    (message: string, tone: 'polite' | 'assertive' = 'polite') => {
      const host = editorRef.current?.getContainerDomNode?.()?.parentElement ?? null;
      if (!host) {
        setSuggestionStatus(message);
        return;
      }
      // 每次建一个新元素（避免 mutate 从 ref 取出的旧节点）。
      toastRef.current?.remove();
      const toast = buildInlineToast(message, tone);
      host.appendChild(toast);
      toastRef.current = toast;
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = window.setTimeout(() => {
        toast.remove();
        if (toastRef.current === toast) toastRef.current = null;
        statusTimerRef.current = null;
      }, 3200);
    },
    [editorRef, setSuggestionStatus],
  );

  const qualifySession = useCallback(
    (session: InlineSession) => {
      if (sessionRef.current !== session) return false;
      if (!matchesSessionTarget(session)) {
        teardown();
        return false;
      }
      if (session.textModel.getVersionId() !== session.modelVersion) {
        teardown();
        flashStatus('文件已变化，请重新发起行间操作');
        return false;
      }
      if (!allowsAuthoringActions(readAgentPermissionProfile(session.projectPath))) {
        teardown();
        flashStatus('本作品已切换为只读，行间操作已取消');
        return false;
      }
      return true;
    },
    [flashStatus, matchesSessionTarget, teardown],
  );

  // 接受不该是硬切换：先让红旧行褪去、绿块卸掉「待定」的绿并轻微下沉，作者才看得见
  // 改动落在哪一行，随后才 teardown + 写回。降低动效偏好下时长为 0，直接落地。
  const playAcceptSettle = useCallback(
    async (session: InlineSession) => {
      const container = editorRef.current?.getContainerDomNode?.() ?? null;
      container?.classList.add('sf-inline-accepting');
      for (const dom of session.zoneDoms) dom.classList.add('sf-inline-diff-zone--settling');
      const duration = inlineSettleDurationMs(prefersReducedMotion());
      if (duration > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, duration));
      }
    },
    [editorRef],
  );

  return {
    sessionRef,
    sessionIdRef,
    sessionIdProjectRef,
    registeredRef,
    openRef,
    matchesSessionTarget,
    isSessionActive,
    teardown,
    clearToast,
    flashStatus,
    qualifySession,
    playAcceptSettle,
  };
}

export type InlineSessionState = ReturnType<typeof useInlineSession>;
