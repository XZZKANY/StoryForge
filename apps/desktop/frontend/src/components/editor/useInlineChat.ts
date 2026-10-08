/**
 * 编辑器内的两种就地 AI 交互，共用同一套 view zone / 接受写回机制：
 *
 * - **Ctrl+K 行间对话**（revise）：改锚定文本。单发 /assistant/revise（整文件进出），
 *   把 before/after 夹到锚定行画成「旧行红标 + 新行绿块」。指令必填。
 * - **Ctrl+Shift+K 光标处续写**（continue）：在光标处接着往下写一段。走 SSE
 *   /assistant/continue 逐块吐字，落定后按 planCursorInsertion 画成纯新增绿块。
 *   指令可留空（＝就接着写）；不设「空行拒绝」闸，因为光标停在段末空行正是续写的起手式。
 *
 * 两者都收敛到 useSuggestionWriteback 的 writeAcceptedSuggestion（同一套快照 + 写盘 +
 * 闭环 + 分支）。纯逻辑在 lib/inline-chat.ts 与 lib/inline-continue.ts 已单测；这里只做
 * Monaco view zone / decoration 的命令式生命周期。
 *
 * 红线不破：后端只出建议、不写盘，落盘仍走作者确认后的守卫写回。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as monaco from 'monaco-editor';

import { reviseFileContent } from '../../lib/api-client';
import { streamContinueProse } from '../../lib/api/assistant';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import type { RevisionLoopResult } from '../../lib/author-loop';
import { allowsAuthoringActions, readAgentPermissionProfile } from '../../lib/agent-permission';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import {
  buildInlineReviseInstruction,
  inlineSettleDurationMs,
  intraLineChangeRange,
  isInlineEditStale,
  planAnchoredInlineDiff,
  planCursorInsertion,
  planInlineReviseWindow,
  spliceInlineReviseWindow,
  type AnchoredInlineDiff,
  type InlineAnchor,
  type LineDiffHunk,
} from '../../lib/inline-chat';
import {
  buildDiffZoneDom,
  buildInlineToast,
  buildInputZoneDom,
  buildLoadingZoneDom,
  buildPendingActionsDom,
  type InlineDiffActions,
  type InlineMode,
  type IntraLineSeg,
} from './inline-chat-dom';
import { prefersReducedMotion } from '../../lib/motion';
import { resolveContinueAnchorLine } from '../../lib/inline-continue';
import { loadInlineContinueContext } from '../../lib/inline-continue-context';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';

type WriteAcceptedSuggestion = (
  suggestion: AssistantFileSuggestion,
  path: string,
  previous: string,
  nextContent: string,
  overrides?: { summary?: string; note?: string },
) => Promise<RevisionLoopResult>;

type UseInlineChatParams = {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  editorReady: boolean;
  filePath: string | null;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  projectName: string | null;
  writeAcceptedSuggestion: WriteAcceptedSuggestion;
  setSuggestionStatus: (status: string) => void;
};

type InlinePhase = 'input' | 'loading' | 'diff';

type InlineSession = {
  editor: monaco.editor.IStandaloneCodeEditor;
  textModel: monaco.editor.ITextModel;
  modelVersion: number;
  projectPath: string;
  filePath: string;
  accessibleZoneHost: { node: HTMLElement; originalHidden: string | null } | null;
  mode: InlineMode;
  phase: InlinePhase;
  anchor: InlineAnchor;
  zoneIds: string[];
  /** 落位动效要给绿块加 class，故除 id 外还留一份 DOM 引用。 */
  zoneDoms: HTMLElement[];
  decorations: monaco.editor.IEditorDecorationsCollection | null;
  keydownHandler: ((event: KeyboardEvent) => void) | null;
  // loading 阶段的 revise 请求控制器：Esc / 取消键 abort 掉在途请求（E16）。
  abortController: AbortController | null;
  capturedBefore: string;
  resultAfter: string;
  userInstruction: string;
  model: string;
  /** 接受后光标停靠的 1-based 行；续写要停在新段末尾而非锚定行。 */
  caretLineAfterAccept: number;
  /**
   * 已进入接受流程。落位动效把 teardown 推到 await 之后，这段时间里 zone 还挂着、
   * sessionRef 还在，接受键与 Alt+Enter 都还能再次触发——没有这道闸就会写两次盘。
   * （改前 teardown 是同步先跑的，第二次触发天然被 sessionRef 为空挡住。）
   */
  accepting: boolean;
};

function editorLineHeight(editor: monaco.editor.IStandaloneCodeEditor): number {
  try {
    const height = editor.getOption(monaco.editor.EditorOption.lineHeight);
    return typeof height === 'number' && height > 0 ? height : 22;
  } catch {
    return 22;
  }
}

/**
 * 会话 id 只在同一项目内沿用；项目变了就丢弃，防止新项目的请求把消息写进旧项目的会话
 * （后端只按 id 取会话，前端不拦就会跨项目复用）。
 */
export function inlineSessionIdForProject(
  sessionId: number | null,
  sessionProject: string | null,
  projectPath: string | null,
): number | null {
  return sessionProject === projectPath ? sessionId : null;
}

export function useInlineChat({
  editorRef,
  editorReady,
  filePath,
  filePathRef,
  projectPathRef,
  projectName,
  writeAcceptedSuggestion,
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
        flashStatus('稿件已变化，请重新发起行间操作');
        return false;
      }
      if (!allowsAuthoringActions(readAgentPermissionProfile(session.projectPath))) {
        teardown();
        flashStatus('本项目已切换为只读，行间操作已取消');
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

  const applyAccepted = useCallback(async () => {
    const editor = editorRef.current;
    const session = sessionRef.current;
    const path = filePathRef.current;
    if (!editor || !session || session.phase !== 'diff' || !path) return;
    if (session.accepting) return;
    if (!qualifySession(session)) return;
    session.accepting = true;

    const isContinue = session.mode === 'continue';
    const bailIfStale = () => {
      if (!isInlineEditStale(session.capturedBefore, editor.getValue())) return false;
      teardown();
      flashStatus(
        isContinue
          ? '文件已变化，续写已取消，请重新发起 Ctrl+Shift+K'
          : '文件已变化，行间修订已取消，请重新发起 Ctrl+K',
      );
      return true;
    };
    if (bailIfStale()) return;

    const suggestion = createRemoteFileSuggestion({
      filePath: path,
      before: session.capturedBefore,
      after: session.resultAfter,
      summary: isContinue
        ? `光标处续写：${session.userInstruction || '接着往下写'}`
        : `行间修订：${session.userInstruction || '按指令润色锚定文本'}`,
      model: session.model,
      userIntent: session.userInstruction || (isContinue ? '光标处续写' : '行间对话修订'),
      assistantSessionId: sessionIdRef.current,
    });
    const previous = session.capturedBefore;
    const next = session.resultAfter;
    const anchorLine = session.caretLineAfterAccept;

    await playAcceptSettle(session);
    // 落位这段时间里 Esc / 切文件可能已经把会话收掉，作者也可能又敲了字——
    // 所以写回前把两件事都再验一遍（比改前只在入口验一次更严）。
    if (!qualifySession(session)) return;
    if (bailIfStale()) return;
    teardown();

    try {
      const writeback = await writeAcceptedSuggestion(suggestion, path, previous, next);
      if (!matchesSessionTarget(session)) return;
      // writeAcceptedSuggestion 内部 setValue 会把光标重置到第 1 行；停回刚改的地方，
      // 免得下一次 Ctrl+K 又锚到开头。
      editor.setPosition({ lineNumber: anchorLine, column: 1 });
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchorLine);
      }
      flashStatus(
        writeback.writebackWarning ??
          (isContinue ? '续写已写回当前文件' : '行间修订已写回当前文件'),
      );
    } catch (error) {
      if (!matchesSessionTarget(session)) return;
      flashStatus(
        `接受失败：${error instanceof Error ? error.message : String(error)}`,
        'assertive',
      );
    }
  }, [
    editorRef,
    filePathRef,
    flashStatus,
    matchesSessionTarget,
    playAcceptSettle,
    qualifySession,
    teardown,
    writeAcceptedSuggestion,
  ]);

  // 把已算好的插入 / 修订计划画成红标 + 绿块 + 动作条。revise 与 continue 共用这一段，
  // 差别只在计划怎么来：前者把整文件修订夹到锚定行，后者直接构造纯新增。
  const renderPlan = useCallback(
    (before: string, plan: AnchoredInlineDiff) => {
      const editor = editorRef.current;
      const session = sessionRef.current;
      const model = editor?.getModel();
      if (!editor || !session || !model) return;

      // 先撤输入 zone，再画 diff。
      if (session.zoneIds.length > 0) {
        editor.changeViewZones((accessor) => {
          for (const id of session.zoneIds) accessor.removeZone(id);
        });
        session.zoneIds = [];
      }
      session.phase = 'diff';
      session.capturedBefore = before;
      // 接受只写夹到锚定处的改动，模型 drift 到别处的一律不带上。
      session.resultAfter = plan.clampedAfter;
      // 续写接受后光标停在新段末尾（接着往下打字），修订则停回锚定行。
      const lastHunk = plan.hunks[plan.hunks.length - 1];
      session.caretLineAfterAccept =
        session.mode === 'continue' && lastHunk
          ? lastHunk.afterLineNumber + lastHunk.newLines.length
          : session.anchor.startLine;

      const actions: InlineDiffActions = {
        addedLines: plan.addedLines,
        removedLines: plan.removedLines,
        hunkCount: plan.hunks.length,
        droppedOffAnchor: plan.droppedOffAnchor,
      };

      // 旧行红标：整行淡背景作上下文；单行替换再叠一层句内高亮，只标真正改动的字（E22）。
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      for (const hunk of plan.hunks) {
        if (hunk.removedStartLine === null || hunk.removedEndLine === null) continue;
        decorations.push({
          range: new monaco.Range(hunk.removedStartLine, 1, hunk.removedEndLine, 1),
          options: { isWholeLine: true, className: 'sf-inline-diff-old' },
        });
        const seg = intraLineHunkSeg(model, hunk);
        if (seg && seg.oldEndCol > seg.oldStartCol) {
          decorations.push({
            range: new monaco.Range(
              hunk.removedStartLine,
              seg.oldStartCol,
              hunk.removedStartLine,
              seg.oldEndCol,
            ),
            options: { className: 'sf-inline-diff-old-seg' },
          });
        }
      }
      session.decorations = editor.createDecorationsCollection(decorations);

      // 绿色新增块 + 动作条（挂在最后一个 hunk 的 zone 上，落在 diff 底部）。
      const lineHeight = editorLineHeight(editor);
      // 绿色新增块的字体跟随编辑器实际解析出的字体（CJK 2:1 栈），与红色旧行同栈，改字比对不再错位。
      const editorFontFamily = editor.getOption(monaco.editor.EditorOption.fontInfo).fontFamily;
      const hostIndex = plan.hunks.length - 1;
      const diffZones: Array<{ id: string; zone: monaco.editor.IViewZone; dom: HTMLElement }> = [];
      // 动作条挂在 host zone 上；diff 画完后焦点要落进去，先记住它。
      let hostDom: HTMLElement | null = null;
      editor.changeViewZones((accessor) => {
        plan.hunks.forEach((hunk, index) => {
          const isHost = index === hostIndex;
          if (hunk.newLines.length === 0 && !isHost) return;
          const dom = buildDiffZoneDom(
            hunk,
            isHost ? actions : null,
            editorFontFamily,
            intraLineHunkSeg(model, hunk),
            {
              onAccept: () => {
                if (isSessionActive(session)) void applyAccepted();
              },
              onReject: () => {
                if (!isSessionActive(session)) return;
                const wasContinue = sessionRef.current?.mode === 'continue';
                teardown();
                flashStatus(wasContinue ? '已弃用这段续写' : '已弃用行间修订');
              },
            },
          );
          // 初值估算；长行折行 / 动作条换行都会撑高，随后按真实高度重排，避免裁掉。
          const heightInPx =
            Math.max(hunk.newLines.length, hunk.newLines.length === 0 ? 0 : 1) * lineHeight +
            (isHost ? 44 : 10);
          const zone: monaco.editor.IViewZone = {
            afterLineNumber: hunk.afterLineNumber,
            heightInPx: Math.max(heightInPx, isHost ? 52 : lineHeight),
            domNode: dom,
          };
          const id = accessor.addZone(zone);
          session.zoneIds.push(id);
          session.zoneDoms.push(dom);
          diffZones.push({ id, zone, dom });
          if (isHost) hostDom = dom;
        });
      });
      // 布局后量真实高度撑满各 zone，绿块/动作条不被裁。
      window.requestAnimationFrame(() => {
        if (sessionRef.current !== session || !editorRef.current) return;
        editorRef.current.changeViewZones((accessor) => {
          for (const { id, zone, dom } of diffZones) {
            const measured = dom.offsetHeight;
            if (measured > 0 && measured + 8 !== zone.heightInPx) {
              zone.heightInPx = measured + 8;
              accessor.layoutZone(id);
            }
          }
        });
      });

      // 键盘：Alt+Enter 接受、Esc 弃用。挂 document（捕获期）而非编辑器容器——
      // 输入框撤掉后焦点已不在编辑器里，挂容器会收不到事件。
      const handler = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        if (event.key === 'Enter' && event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          void applyAccepted();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          const wasContinue = sessionRef.current?.mode === 'continue';
          teardown();
          flashStatus(wasContinue ? '已弃用这段续写' : '已弃用行间修订');
        }
      };
      document.addEventListener('keydown', handler, true);
      session.keydownHandler = handler;

      // 输入/loading zone 已拆，焦点此刻回落 body；移进动作条（接受键），键盘与读屏都有锚点。
      // 只做一次，不随后续变化反复搬焦点——流式输出期间搬焦点会造成读屏轰炸。
      const focusActions = () => {
        if (sessionRef.current !== session) return;
        hostDom?.querySelector('button')?.focus({ preventScroll: true });
      };
      // rAF 二次兜底：布局期 Monaco 有时会把焦点抢回编辑器（同输入框的聚焦处理）。
      window.requestAnimationFrame(() => {
        focusActions();
        window.requestAnimationFrame(focusActions);
      });

      if (session.mode === 'continue') {
        flashStatus(
          `续写建议已就绪：约 ${plan.clampedAfter.length - before.length} 字，Alt+Enter 接受`,
        );
        return;
      }
      const droppedNote =
        plan.droppedOffAnchor > 0 ? `（已忽略别处 ${plan.droppedOffAnchor} 处改动）` : '';
      flashStatus(`行间修订建议已就绪：+${plan.addedLines} / -${plan.removedLines}${droppedNote}`);
    },
    [applyAccepted, editorRef, flashStatus, isSessionActive, teardown],
  );

  const renderDiff = useCallback(
    (before: string, after: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const plan = planAnchoredInlineDiff(before, after, {
        startLine: session.anchor.startLine,
        endLine: session.anchor.endLine,
      });
      if (plan.isNoop) {
        teardown();
        flashStatus(
          plan.droppedOffAnchor > 0
            ? 'AI 的改动落在选定处之外，已忽略；换个更具体的说法再试 Ctrl+K'
            : '行间对话：AI 没有提出改动',
        );
        return;
      }
      renderPlan(before, plan);
    },
    [flashStatus, renderPlan, teardown],
  );

  // E16：loading 期间取消——abort 在途请求 + 收场 + 提示；Esc 与 loading 区「取消」键都走这里。
  const cancelLoading = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.phase !== 'loading') return;
    const wasContinue = session.mode === 'continue';
    session.abortController?.abort();
    teardown();
    flashStatus(wasContinue ? '已取消续写' : '已取消行间修订');
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
        // 已取消（abort→teardown 已跑，sessionRef 清空）或切走：不再报失败。
        if (!qualifySession(session)) return;
        teardown();
        flashStatus(
          `AI 修订失败：${error instanceof Error ? error.message : String(error)}`,
          'assertive',
        );
      }
    },
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

  const open = useCallback(
    (mode: InlineMode = 'revise') => {
      const editor = editorRef.current;
      if (!editor || typeof editor.changeViewZones !== 'function') return;
      const project = projectPathRef.current;
      const path = filePathRef.current;
      // 切项目后旧会话 id 必须失效：open 是每次 Ctrl+K / Ctrl+Shift+K 的入口，此刻读到的是
      // 当前项目，能可靠判断 id 是否属于本项目。
      sessionIdRef.current = inlineSessionIdForProject(
        sessionIdRef.current,
        sessionIdProjectRef.current,
        project,
      );
      if (!project || !path) {
        flashStatus(
          mode === 'continue'
            ? '先在编辑器里打开一份稿件，再用 Ctrl+Shift+K 续写'
            : '先在编辑器里打开一个文件，再用 Ctrl+K 行间对话',
        );
        return;
      }
      if (isReadOnlyDerivedProjectPath(path)) {
        flashStatus(
          mode === 'continue' ? '派生缓存为只读，不能续写' : '派生缓存为只读，不能行间修订',
        );
        return;
      }
      // 这两条走 /api/assistant/*，不经 AgentRun 的权限 gate；「只读」档要名副其实，
      // 就必须在这里挡住发起。读的是 localStorage 现值而不是缓存 prop：这是授权判定，
      // 要用作者此刻的选择，不是上一次渲染时的。
      if (!allowsAuthoringActions(readAgentPermissionProfile(project))) {
        flashStatus(
          mode === 'continue'
            ? '本项目是只读档，Agent 不产生改动；要续写请先在对话框把档位调开'
            : '本项目是只读档，Agent 不产生改动；要改稿请先在对话框把档位调开',
        );
        return;
      }
      const model = editor.getModel();
      if (!model) return;

      teardown();

      const selection = editor.getSelection();
      const anchor: InlineAnchor =
        selection && !selection.isEmpty()
          ? {
              startLine: selection.startLineNumber,
              endLine: selection.endLineNumber,
              text: model.getValueInRange(selection),
              isSelection: true,
            }
          : {
              startLine: selection?.startLineNumber ?? 1,
              endLine: selection?.startLineNumber ?? 1,
              text: model.getLineContent(selection?.startLineNumber ?? 1),
              isSelection: false,
            };

      // 段落间空行（网文极常见）没选中就按 Ctrl+K，锚定取整行 = 空串 → 模型多半 no-op、白等一趟。
      // 续写不设这道闸：光标停在段末空行按键，正是续写最典型的起手式。
      if (mode !== 'continue' && !anchor.isSelection && anchor.text.trim() === '') {
        flashStatus('先选中要改的文字，再用 Ctrl+K 行间对话');
        return;
      }

      const session: InlineSession = {
        editor,
        textModel: model,
        modelVersion: model.getVersionId(),
        projectPath: project,
        filePath: path,
        accessibleZoneHost: null,
        mode,
        phase: 'input',
        anchor,
        zoneIds: [],
        zoneDoms: [],
        decorations: null,
        keydownHandler: null,
        abortController: null,
        capturedBefore: '',
        resultAfter: '',
        userInstruction: '',
        model: '',
        caretLineAfterAccept: anchor.startLine,
        accepting: false,
      };
      sessionRef.current = session;

      const dom = buildInputZoneDom(anchor, mode, {
        onSend: (value) => {
          if (isSessionActive(session)) void send(value);
          else if (sessionRef.current === session) teardown();
        },
        onCancel: () => {
          if (sessionRef.current === session) teardown();
        },
      });
      // 先给一个够用的初值，随后按真实高度重排——写死高度会把气泡底边裁掉（「不是完整的气泡」）。
      const inputZone: monaco.editor.IViewZone = {
        afterLineNumber: anchor.endLine,
        heightInPx: 120,
        domNode: dom.container,
      };
      let inputZoneId = '';
      editor.changeViewZones((accessor) => {
        inputZoneId = accessor.addZone(inputZone);
        session.zoneIds.push(inputZoneId);
      });
      // Monaco hides view zones from its code-reader by default. Our zones are
      // interactive author UI; child aria-label cannot override a hidden ancestor.
      const zoneHost = dom.container.closest<HTMLElement>('.view-zones');
      if (zoneHost) {
        session.accessibleZoneHost = {
          node: zoneHost,
          originalHidden: zoneHost.getAttribute('aria-hidden'),
        };
        zoneHost.setAttribute('aria-hidden', 'false');
      }
      // zoneDoms 除落位动效外也用于 teardown 的焦点归还判断，输入泡同样登记。
      session.zoneDoms.push(dom.container);
      // 把锚定行滚进视野：接受后 setValue 会把光标重置到第 1 行，若作者已滚到别处，
      // 输入泡会锚在光标（第 1 行）弹到「别处」——这里确保它总在眼前。
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchor.startLine);
      }
      // Monaco 把 zone DOM 挂上、布局后：①量真实高度撑满 zone，不裁气泡；②聚焦输入框
      //（rAF 二次兜底，布局期 Monaco 有时会把焦点抢回编辑器，单次 setTimeout 会「打不了字」）。
      const focusInput = () => {
        if (isSessionActive(session) && session.phase === 'input')
          dom.textarea.focus({ preventScroll: true });
      };
      window.requestAnimationFrame(() => {
        if (!isSessionActive(session) || session.phase !== 'input') return;
        const measured = dom.container.offsetHeight;
        if (measured > 0 && editorRef.current && sessionRef.current === session) {
          // offsetHeight 不含外边距，补上 margin(4+6) 再留一点余量。
          inputZone.heightInPx = measured + 14;
          editorRef.current.changeViewZones((accessor) => accessor.layoutZone(inputZoneId));
        }
        focusInput();
        window.requestAnimationFrame(focusInput);
      });
    },
    [editorRef, filePathRef, flashStatus, isSessionActive, projectPathRef, send, teardown],
  );

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Ctrl+K（改锚定文本）/ Ctrl+Shift+K（光标处续写）各注册一次。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || registeredRef.current) return;
    registeredRef.current = true;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => openRef.current('revise'));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK, () =>
      openRef.current('continue'),
    );
  }, [editorReady, editorRef]);

  // 输入阶段：光标移出锚定行即拆除（点到别的行就是「不改这儿了」）。仅限 input 阶段——
  // diff 阶段点「接受/弃用」按钮会顺带移光标，若此时拆除会话，点击就落空（接受只能用快捷键）。
  // diff 阶段的收尾交给按钮 / Esc / 切文件。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || typeof editor.onDidChangeCursorPosition !== 'function') return;
    const disposable = editor.onDidChangeCursorPosition((event) => {
      const session = sessionRef.current;
      if (!session || session.phase !== 'input') return;
      const line = event.position.lineNumber;
      if (line < session.anchor.startLine || line > session.anchor.endLine) teardown();
    });
    return () => disposable.dispose();
  }, [editorReady, editorRef, teardown]);

  // 换文件时拆掉进行中的行间会话，避免 zone/decoration 残留到新文件。
  useEffect(() => {
    return () => teardown();
  }, [filePath, teardown]);

  // Project/model refs can change while the editor remains mounted, including
  // a same-file projection. Every committed render rechecks the captured owner.
  useEffect(() => {
    const session = sessionRef.current;
    if (session && !matchesSessionTarget(session)) teardown();
  });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor) return;
    const qualifyCurrent = () => {
      const session = sessionRef.current;
      if (session) qualifySession(session);
    };
    const modelSubscription = editor.onDidChangeModel?.(qualifyCurrent);
    const contentSubscription = editor.onDidChangeModelContent?.(qualifyCurrent);
    return () => {
      modelSubscription?.dispose();
      contentSubscription?.dispose();
    };
  }, [editorReady, editorRef, qualifySession]);

  // 卸载时清掉 toast 与其计时器。
  useEffect(() => {
    return () => clearToast();
  }, [clearToast]);
}

// ---- Monaco 装配辅助（zone 增删 / 高度重排）；zone DOM 的声明式构造在 inline-chat-dom.ts ----

/**
 * 续写的流式区：把逐块到达的正文即时画在落点下方，让作者看到笔在动。
 *
 * 这里显示的是**原始增量**，仅供观感——最终以 done.text 重新算插入计划再渲染成绿块。
 * 高度重排按帧节流：每个 token 都 layoutZone 会让编辑器整页抖动。
 */
function swapZoneToStreaming(
  editor: monaco.editor.IStandaloneCodeEditor,
  session: InlineSession,
  anchorLine: number,
  onCancel: () => void,
  isActive: () => boolean,
): { append: (text: string) => void } {
  const dom = document.createElement('div');
  dom.className = 'sf-inline-diff-zone sf-inline-diff-zone--streaming';
  dom.setAttribute('role', 'group');
  dom.setAttribute('aria-label', '行间续写进行中');
  try {
    dom.style.fontFamily = editor.getOption(monaco.editor.EditorOption.fontInfo).fontFamily;
  } catch {
    /* 字体拿不到就用继承值，不值得为此中断续写。 */
  }

  const body = document.createElement('div');
  body.className = 'sf-inline-diff-line';
  body.setAttribute('aria-hidden', 'true');
  const { bar, cancel } = buildPendingActionsDom('正在续写…', onCancel);
  dom.append(body, bar);

  let zoneId = '';
  const zone: monaco.editor.IViewZone = {
    afterLineNumber: anchorLine,
    heightInPx: 60,
    domNode: dom,
  };
  editor.changeViewZones((accessor) => {
    for (const id of session.zoneIds) accessor.removeZone(id);
    zoneId = accessor.addZone(zone);
    session.zoneIds = [zoneId];
    session.zoneDoms = [dom];
  });

  // 输入 zone 已随上面的重建撤掉，焦点移到「取消」：loading 期间唯一可用的操作得让
  // 键盘/读屏摸得到（rAF 等 Monaco 把 zone 挂上再抢，否则会落空或被编辑器夺回）。
  focusWhenSettled(cancel, isActive);

  let pending = false;
  const relayout = () => {
    pending = false;
    if (!isActive()) return;
    const measured = dom.offsetHeight;
    if (measured <= 0 || measured + 8 === zone.heightInPx) return;
    zone.heightInPx = measured + 8;
    editor.changeViewZones((accessor) => accessor.layoutZone(zoneId));
  };

  return {
    append: (text: string) => {
      body.textContent = `${body.textContent ?? ''}${text}`;
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(relayout);
    },
  };
}

function swapZoneToLoading(
  editor: monaco.editor.IStandaloneCodeEditor,
  session: InlineSession,
  onCancel: () => void,
  isActive: () => boolean,
): void {
  const zoneId = session.zoneIds[0];
  if (!zoneId) return;
  // 简化处理：重建 zone 内容为 loading 行（保留同一 afterLineNumber）+ 取消键，长请求不再干等。
  const { dom, cancel } = buildLoadingZoneDom(onCancel);
  editor.changeViewZones((accessor) => {
    accessor.removeZone(zoneId);
    const id = accessor.addZone({
      afterLineNumber: session.anchor.endLine,
      heightInPx: 40,
      domNode: dom,
    });
    session.zoneIds = [id];
    session.zoneDoms = [dom];
  });

  // 同流式区：输入 zone 没了，焦点落到「取消」这个唯一可用操作上。
  focusWhenSettled(cancel, isActive);
}

// rAF 二次兜底：布局期 Monaco 有时会把焦点抢回编辑器（同输入框的聚焦处理）。
function focusWhenSettled(element: HTMLElement, isActive: () => boolean): void {
  const focus = () => {
    if (isActive()) element.focus({ preventScroll: true });
  };
  window.requestAnimationFrame(() => {
    focus();
    window.requestAnimationFrame(focus);
  });
}

// 单行替换（一旧行→一新行）才做句内高亮；多行 hunk / 纯增删回退整行铺色。
function intraLineHunkSeg(
  model: monaco.editor.ITextModel,
  hunk: LineDiffHunk,
): IntraLineSeg | null {
  if (
    hunk.removedStartLine === null ||
    hunk.removedStartLine !== hunk.removedEndLine ||
    hunk.newLines.length !== 1
  ) {
    return null;
  }
  return intraLineChangeRange(model.getLineContent(hunk.removedStartLine), hunk.newLines[0]);
}
