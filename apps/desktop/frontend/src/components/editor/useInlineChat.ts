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
import { prefersReducedMotion } from '../../lib/motion';
import { resolveContinueAnchorLine } from '../../lib/inline-continue';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';

// diff 动作条要展示的汇总（锚定处增删行 + 被丢弃的别处改动数）。
type InlineDiffActions = {
  addedLines: number;
  removedLines: number;
  hunkCount: number;
  droppedOffAnchor: number;
};

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
/** revise=改锚定文本（Ctrl+K）；continue=在光标处往下续写（Ctrl+Shift+K）。 */
type InlineMode = 'revise' | 'continue';

type InlineSession = {
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
  const registeredRef = useRef(false);
  // 快捷键命令只注册一次；用 ref 持有最新的 open 闭包，命令回调始终调到当前实现。
  const openRef = useRef<(mode?: InlineMode) => void>(() => {});

  const teardown = useCallback(() => {
    const editor = editorRef.current;
    const session = sessionRef.current;
    if (!session) return;
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
    sessionRef.current = null;
  }, [editorRef]);

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
    (message: string) => {
      const host = editorRef.current?.getContainerDomNode?.()?.parentElement ?? null;
      if (!host) {
        setSuggestionStatus(message);
        return;
      }
      // 每次建一个新元素（避免 mutate 从 ref 取出的旧节点）。
      toastRef.current?.remove();
      const toast = document.createElement('div');
      toast.className = 'sf-inline-toast';
      toast.textContent = message;
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
    if (sessionRef.current !== session) return;
    if (bailIfStale()) return;
    teardown();

    try {
      await writeAcceptedSuggestion(suggestion, path, previous, next);
      // writeAcceptedSuggestion 内部 setValue 会把光标重置到第 1 行；停回刚改的地方，
      // 免得下一次 Ctrl+K 又锚到开头。
      editor.setPosition({ lineNumber: anchorLine, column: 1 });
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchorLine);
      }
      flashStatus(isContinue ? '续写已写回当前文件' : '行间修订已写回当前文件');
    } catch (error) {
      flashStatus(`接受失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [editorRef, filePathRef, flashStatus, playAcceptSettle, teardown, writeAcceptedSuggestion]);

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
              onAccept: () => void applyAccepted(),
              onReject: () => {
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
    [applyAccepted, editorRef, flashStatus, teardown],
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
      const instruction = userInstruction.trim();
      // 续写允许空指令（留空 = 就接着写）；修订必须说清改什么。
      if (!instruction && session.mode !== 'continue') return;

      const before = editor.getValue();
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
        const stream = swapZoneToStreaming(editor, session, anchorLine, cancelLoading);
        try {
          const result = await streamContinueProse({
            filePath: path,
            content: before,
            cursorLine: anchorLine,
            instruction: instruction || null,
            projectRoot: projectPathRef.current,
            assistantSessionId: sessionIdRef.current,
            signal: controller.signal,
            onDelta: (text) => {
              if (sessionRef.current !== session) return;
              stream.append(text);
            },
          });
          if (sessionRef.current !== session || filePathRef.current !== path) return;
          detachLoadingEsc();
          sessionIdRef.current = result.assistantSessionId;
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
          if (sessionRef.current !== session) return;
          teardown();
          flashStatus(`续写失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      swapZoneToLoading(editor, session, cancelLoading);

      // 长章节只送锚点附近的窗口：整章发出去既按整章计费，也正是模型 drift 的来源。
      const window = planInlineReviseWindow(before, session.anchor);

      try {
        const result = await reviseFileContent({
          filePath: path,
          content: window.text,
          instruction: buildInlineReviseInstruction({
            anchorText: session.anchor.text,
            isSelection: session.anchor.isSelection,
            userInstruction: instruction,
            isExcerpt: !window.isWholeDocument,
          }),
          projectName,
          projectRoot: projectPathRef.current,
          assistantSessionId: sessionIdRef.current,
          signal: controller.signal,
        });
        // 用户可能在等待期间关了会话/切了文件。
        if (sessionRef.current !== session || filePathRef.current !== path) return;
        // 进 diff 前摘掉 loading 的 Esc 处理，避免与 renderDiff 装的重复。
        detachLoadingEsc();
        sessionIdRef.current = result.assistantSessionId;
        session.model = result.model;
        // 拼回整文再交给 renderDiff：夹紧、陈旧判定与写回一律仍以整文件为单位。
        renderDiff(before, spliceInlineReviseWindow(before, window, result.after));
      } catch (error) {
        // 已取消（abort→teardown 已跑，sessionRef 清空）或切走：不再报失败。
        if (sessionRef.current !== session) return;
        teardown();
        flashStatus(`AI 修订失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [
      cancelLoading,
      editorRef,
      filePathRef,
      flashStatus,
      projectName,
      projectPathRef,
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
        onSend: (value) => void send(value),
        onCancel: () => {
          teardown();
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
      // 把锚定行滚进视野：接受后 setValue 会把光标重置到第 1 行，若作者已滚到别处，
      // 输入泡会锚在光标（第 1 行）弹到「别处」——这里确保它总在眼前。
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchor.startLine);
      }
      // Monaco 把 zone DOM 挂上、布局后：①量真实高度撑满 zone，不裁气泡；②聚焦输入框
      //（rAF 二次兜底，布局期 Monaco 有时会把焦点抢回编辑器，单次 setTimeout 会「打不了字」）。
      const focusInput = () => dom.textarea.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
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
    [editorRef, filePathRef, flashStatus, projectPathRef, send, teardown],
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

  // 卸载时清掉 toast 与其计时器。
  useEffect(() => {
    return () => clearToast();
  }, [clearToast]);
}

// ---- 命令式 DOM 构造（仅在 Ctrl+K 流程中运行，测试不触达） ----

function buildInputZoneDom(
  anchor: InlineAnchor,
  mode: InlineMode,
  handlers: { onSend: (value: string) => void; onCancel: () => void },
): { container: HTMLElement; textarea: HTMLTextAreaElement } {
  const container = document.createElement('div');
  container.className = 'sf-inline-chat';
  // 拦掉冒泡，别让 Monaco 把 view zone 里的点击当成移动光标而把焦点从输入框抢走。
  container.addEventListener('mousedown', (event) => event.stopPropagation());

  const head = document.createElement('div');
  head.className = 'sf-inline-chat__head';
  const lineLabel =
    anchor.startLine === anchor.endLine
      ? `第 ${anchor.startLine} 行`
      : `第 ${anchor.startLine}–${anchor.endLine} 行`;
  head.textContent =
    mode === 'continue'
      ? `续写 · ${lineLabel} 之后 · 接着往下写一段`
      : `行间对话 · ${lineLabel} · 只改这附近，不整段重写`;

  const textarea = document.createElement('textarea');
  textarea.className = 'sf-inline-chat__textarea';
  textarea.rows = 1;
  textarea.placeholder =
    mode === 'continue'
      ? '直接回车＝就接着写；也可给个方向：转到冲突 / 慢下来 / 换个视角…'
      : '对这段说点什么：收紧节奏 / 换个意象 / 口吻更冷…';

  let composing = false;
  textarea.addEventListener('compositionstart', () => {
    composing = true;
  });
  textarea.addEventListener('compositionend', () => {
    composing = false;
  });
  textarea.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      handlers.onSend(textarea.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handlers.onCancel();
    }
  });

  const hint = document.createElement('div');
  hint.className = 'sf-inline-chat__hint';
  hint.textContent =
    mode === 'continue'
      ? 'Enter 开始写 · Shift+Enter 换行 · Esc 关闭'
      : 'Enter 发送 · Shift+Enter 换行 · Esc 关闭';

  container.append(head, textarea, hint);
  return { container, textarea };
}

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
): { append: (text: string) => void } {
  const dom = document.createElement('div');
  dom.className = 'sf-inline-diff-zone sf-inline-diff-zone--streaming';
  try {
    dom.style.fontFamily = editor.getOption(monaco.editor.EditorOption.fontInfo).fontFamily;
  } catch {
    /* 字体拿不到就用继承值，不值得为此中断续写。 */
  }

  const body = document.createElement('div');
  body.className = 'sf-inline-diff-line';
  const bar = document.createElement('div');
  bar.className = 'sf-inline-diff-actions';
  const label = document.createElement('span');
  label.className = 'sf-inline-diff-note';
  label.textContent = '正在续写…';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'sf-inline-btn-reject';
  cancel.textContent = '取消 (Esc)';
  cancel.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  });
  bar.append(label, cancel);
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
  });

  let pending = false;
  const relayout = () => {
    pending = false;
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
): void {
  const zoneId = session.zoneIds[0];
  if (!zoneId) return;
  // 简化处理：重建 zone 内容为 loading 行（保留同一 afterLineNumber）+ 取消键，长请求不再干等。
  editor.changeViewZones((accessor) => {
    accessor.removeZone(zoneId);
    const dom = document.createElement('div');
    dom.className = 'sf-inline-chat sf-inline-chat--loading';
    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = '正在请求 AI 修订…';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sf-inline-btn-reject';
    cancel.textContent = '取消 (Esc)';
    cancel.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    });
    dom.append(label, cancel);
    const id = accessor.addZone({
      afterLineNumber: session.anchor.endLine,
      heightInPx: 40,
      domNode: dom,
    });
    session.zoneIds = [id];
  });
}

type IntraLineSeg = ReturnType<typeof intraLineChangeRange>;

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

function buildDiffZoneDom(
  hunk: LineDiffHunk,
  summaryForActions: InlineDiffActions | null,
  fontFamily: string,
  seg: IntraLineSeg | null,
  handlers: { onAccept: () => void; onReject: () => void },
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'sf-inline-diff-zone';
  // 内联覆盖 CSS 的 mono 栈：贴编辑器正文字体，绿新行与红旧行字形/字宽一致。
  container.style.fontFamily = fontFamily;
  // 同输入框：拦掉 mousedown，避免点接受/弃用时 Monaco 抢焦点。
  container.addEventListener('mousedown', (event) => event.stopPropagation());

  const highlightNew =
    seg !== null && hunk.newLines.length === 1 && seg.newEndCol > seg.newStartCol;
  for (const line of hunk.newLines) {
    const row = document.createElement('div');
    row.className = 'sf-inline-diff-line';
    if (highlightNew && seg && line.length > 0) {
      // 只把真正改动的中段包成高亮 span，前后逐字保留（对齐红旧行的句内高亮，E22）。
      const start = seg.newStartCol - 1;
      const end = seg.newEndCol - 1;
      if (start > 0) row.append(document.createTextNode(line.slice(0, start)));
      const hi = document.createElement('span');
      hi.className = 'sf-inline-diff-new-seg';
      hi.textContent = line.slice(start, end);
      row.append(hi);
      if (end < line.length) row.append(document.createTextNode(line.slice(end)));
      container.append(row);
      continue;
    }
    row.textContent = line.length > 0 ? line : ' ';
    container.append(row);
  }

  if (summaryForActions) {
    const actions = document.createElement('div');
    actions.className = 'sf-inline-diff-actions';

    // 走 mousedown + preventDefault：抢在 Monaco 的鼠标处理（移光标/夺焦点）之前触发，
    // 否则点击会先被编辑器吞掉，表现为「接受只能用快捷键、点不动」。
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'sf-inline-btn-accept';
    accept.textContent = '接受 (Alt+Enter)';
    accept.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onAccept();
    });

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'sf-inline-btn-reject';
    reject.textContent = '弃用 (Esc)';
    reject.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onReject();
    });

    const note = document.createElement('span');
    note.className = 'sf-inline-diff-note';
    const noteParts = [`+${summaryForActions.addedLines} / -${summaryForActions.removedLines}`];
    if (summaryForActions.hunkCount > 1) noteParts.push(`共 ${summaryForActions.hunkCount} 处`);
    if (summaryForActions.droppedOffAnchor > 0) {
      noteParts.push(`已忽略别处 ${summaryForActions.droppedOffAnchor} 处`);
    }
    note.textContent = noteParts.join(' · ');

    actions.append(accept, reject, note);
    container.append(actions);
  }

  return container;
}
