/**
 * 行间对话（Ctrl+K）：编辑聚焦下在光标/选区处就地改稿的 Cursor Cmd+K 式交互。
 *
 * 流程：Ctrl+K → 光标行下方 view zone 里输入一句指令 → 单发 /assistant/revise（整文件进出）
 * → 把返回的 before/after 画成「旧行红标 + 新行绿块」内联 diff + 接受/弃用动作条
 * → 接受收敛到 useSuggestionWriteback 的 writeAcceptedSuggestion（同一套快照 + 写盘 + 闭环 + 分支）。
 *
 * 纯逻辑（指令构造、hunk→行级 diff 映射、陈旧判定）在 lib/inline-chat.ts 已单测；这里只做 Monaco
 * view zone / decoration 的命令式生命周期。红线不破：后端只出建议，落盘仍走作者确认后的守卫写回。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as monaco from 'monaco-editor';

import { reviseFileContent } from '../../lib/api-client';
import { createRemoteFileSuggestion } from '../../lib/assistant-suggestions';
import type { RevisionLoopResult } from '../../lib/author-loop';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import {
  buildInlineReviseInstruction,
  intraLineChangeRange,
  isInlineEditStale,
  planAnchoredInlineDiff,
  type InlineAnchor,
  type LineDiffHunk,
} from '../../lib/inline-chat';
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

type InlineSession = {
  phase: InlinePhase;
  anchor: InlineAnchor;
  zoneIds: string[];
  decorations: monaco.editor.IEditorDecorationsCollection | null;
  keydownHandler: ((event: KeyboardEvent) => void) | null;
  // loading 阶段的 revise 请求控制器：Esc / 取消键 abort 掉在途请求（E16）。
  abortController: AbortController | null;
  capturedBefore: string;
  resultAfter: string;
  userInstruction: string;
  model: string;
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
  // Ctrl+K 命令只注册一次；用 ref 持有最新的 open 闭包，命令回调始终调到当前实现。
  const openRef = useRef<() => void>(() => {});

  const teardown = useCallback(() => {
    const editor = editorRef.current;
    const session = sessionRef.current;
    if (!session) return;
    if (session.keydownHandler) {
      document.removeEventListener('keydown', session.keydownHandler, true);
    }
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

  const applyAccepted = useCallback(async () => {
    const editor = editorRef.current;
    const session = sessionRef.current;
    const path = filePathRef.current;
    if (!editor || !session || session.phase !== 'diff' || !path) return;

    if (isInlineEditStale(session.capturedBefore, editor.getValue())) {
      teardown();
      flashStatus('文件已变化，行间修订已取消，请重新发起 Ctrl+K');
      return;
    }

    const suggestion = createRemoteFileSuggestion({
      filePath: path,
      before: session.capturedBefore,
      after: session.resultAfter,
      summary: `行间修订：${session.userInstruction || '按指令润色锚定文本'}`,
      model: session.model,
      userIntent: session.userInstruction || '行间对话修订',
      assistantSessionId: sessionIdRef.current,
    });
    const previous = session.capturedBefore;
    const next = session.resultAfter;
    const anchorLine = session.anchor.startLine;
    teardown();

    try {
      await writeAcceptedSuggestion(suggestion, path, previous, next);
      // writeAcceptedSuggestion 内部 setValue 会把光标重置到第 1 行；停回刚改的地方，
      // 免得下一次 Ctrl+K 又锚到开头。
      editor.setPosition({ lineNumber: anchorLine, column: 1 });
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(anchorLine);
      }
      flashStatus('行间修订已写回当前文件');
    } catch (error) {
      flashStatus(`接受失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [editorRef, filePathRef, flashStatus, teardown, writeAcceptedSuggestion]);

  const renderDiff = useCallback(
    (before: string, after: string) => {
      const editor = editorRef.current;
      const session = sessionRef.current;
      const model = editor?.getModel();
      if (!editor || !session || !model) return;

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
                teardown();
                flashStatus('已弃用行间修订');
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
          teardown();
          flashStatus('已弃用行间修订');
        }
      };
      document.addEventListener('keydown', handler, true);
      session.keydownHandler = handler;

      const droppedNote =
        plan.droppedOffAnchor > 0 ? `（已忽略别处 ${plan.droppedOffAnchor} 处改动）` : '';
      flashStatus(`行间修订建议已就绪：+${plan.addedLines} / -${plan.removedLines}${droppedNote}`);
    },
    [applyAccepted, editorRef, flashStatus, teardown],
  );

  // E16：loading 期间取消——abort 在途 revise 请求 + 收场 + 提示；Esc 与 loading 区「取消」键都走这里。
  const cancelLoading = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.phase !== 'loading') return;
    session.abortController?.abort();
    teardown();
    flashStatus('已取消行间修订');
  }, [flashStatus, teardown]);

  const send = useCallback(
    async (userInstruction: string) => {
      const editor = editorRef.current;
      const session = sessionRef.current;
      const path = filePathRef.current;
      if (!editor || !session || session.phase !== 'input' || !path) return;
      const instruction = userInstruction.trim();
      if (!instruction) return;

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
      swapZoneToLoading(editor, session, cancelLoading);

      try {
        const result = await reviseFileContent({
          filePath: path,
          content: before,
          instruction: buildInlineReviseInstruction({
            anchorText: session.anchor.text,
            isSelection: session.anchor.isSelection,
            userInstruction: instruction,
          }),
          projectName,
          assistantSessionId: sessionIdRef.current,
          signal: controller.signal,
        });
        // 用户可能在等待期间关了会话/切了文件。
        if (sessionRef.current !== session || filePathRef.current !== path) return;
        // 进 diff 前摘掉 loading 的 Esc 处理，避免与 renderDiff 装的重复。
        if (session.keydownHandler === onLoadingEsc) {
          document.removeEventListener('keydown', onLoadingEsc, true);
          session.keydownHandler = null;
        }
        sessionIdRef.current = result.assistantSessionId;
        session.model = result.model;
        renderDiff(before, result.after);
      } catch (error) {
        // 已取消（abort→teardown 已跑，sessionRef 清空）或切走：不再报失败。
        if (sessionRef.current !== session) return;
        teardown();
        flashStatus(`AI 修订失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [cancelLoading, editorRef, filePathRef, flashStatus, projectName, renderDiff, teardown],
  );

  const open = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || typeof editor.changeViewZones !== 'function') return;
    const project = projectPathRef.current;
    const path = filePathRef.current;
    if (!project || !path) {
      flashStatus('先在编辑器里打开一个文件，再用 Ctrl+K 行间对话');
      return;
    }
    if (isReadOnlyDerivedProjectPath(path)) {
      flashStatus('派生缓存为只读，不能行间修订');
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
    if (!anchor.isSelection && anchor.text.trim() === '') {
      flashStatus('先选中要改的文字，再用 Ctrl+K 行间对话');
      return;
    }

    const session: InlineSession = {
      phase: 'input',
      anchor,
      zoneIds: [],
      decorations: null,
      keydownHandler: null,
      abortController: null,
      capturedBefore: '',
      resultAfter: '',
      userInstruction: '',
      model: '',
    };
    sessionRef.current = session;

    const dom = buildInputZoneDom(anchor, {
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
  }, [editorRef, filePathRef, flashStatus, projectPathRef, send, teardown]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Ctrl+K 命令注册一次（editor 生命周期内只建一次实例）。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || registeredRef.current) return;
    registeredRef.current = true;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => openRef.current());
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
  head.textContent = `行间对话 · ${lineLabel} · 只改这附近，不整段重写`;

  const textarea = document.createElement('textarea');
  textarea.className = 'sf-inline-chat__textarea';
  textarea.rows = 1;
  textarea.placeholder = '对这段说点什么：收紧节奏 / 换个意象 / 口吻更冷…';

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
  hint.textContent = 'Enter 发送 · Shift+Enter 换行 · Esc 关闭';

  container.append(head, textarea, hint);
  return { container, textarea };
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
