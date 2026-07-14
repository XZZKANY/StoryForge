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
  isInlineEditStale,
  summarizeInlineDiff,
  type InlineAnchor,
  type LineDiffHunk,
} from '../../lib/inline-chat';
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
  phase: InlinePhase;
  anchor: InlineAnchor;
  zoneIds: string[];
  decorations: monaco.editor.IEditorDecorationsCollection | null;
  keydownHandler: ((event: KeyboardEvent) => void) | null;
  keydownTarget: HTMLElement | null;
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
    if (session.keydownHandler && session.keydownTarget) {
      session.keydownTarget.removeEventListener('keydown', session.keydownHandler, true);
    }
    session.decorations?.clear();
    if (editor && session.zoneIds.length > 0 && typeof editor.changeViewZones === 'function') {
      editor.changeViewZones((accessor) => {
        for (const id of session.zoneIds) accessor.removeZone(id);
      });
    }
    sessionRef.current = null;
  }, [editorRef]);

  const applyAccepted = useCallback(async () => {
    const editor = editorRef.current;
    const session = sessionRef.current;
    const path = filePathRef.current;
    if (!editor || !session || session.phase !== 'diff' || !path) return;

    if (isInlineEditStale(session.capturedBefore, editor.getValue())) {
      teardown();
      setSuggestionStatus('文件已变化，行间修订已取消，请重新发起 Ctrl+K');
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
    teardown();

    try {
      await writeAcceptedSuggestion(suggestion, path, previous, next);
      setSuggestionStatus('行间修订已写回当前文件');
    } catch (error) {
      setSuggestionStatus(`接受失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [editorRef, filePathRef, setSuggestionStatus, teardown, writeAcceptedSuggestion]);

  const renderDiff = useCallback(
    (before: string, after: string) => {
      const editor = editorRef.current;
      const session = sessionRef.current;
      const model = editor?.getModel();
      if (!editor || !session || !model) return;

      const summary = summarizeInlineDiff(before, after);
      if (summary.isNoop) {
        teardown();
        setSuggestionStatus('行间对话：AI 没有提出改动');
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
      session.resultAfter = after;

      // 旧行红标：整行背景。
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      for (const hunk of summary.hunks) {
        if (hunk.removedStartLine === null || hunk.removedEndLine === null) continue;
        decorations.push({
          range: new monaco.Range(hunk.removedStartLine, 1, hunk.removedEndLine, 1),
          options: { isWholeLine: true, className: 'sf-inline-diff-old' },
        });
      }
      session.decorations = editor.createDecorationsCollection(decorations);

      // 绿色新增块 + 动作条（挂在最后一个 hunk 的 zone 上，落在 diff 底部）。
      const lineHeight = editorLineHeight(editor);
      const hostIndex = summary.hunks.length - 1;
      editor.changeViewZones((accessor) => {
        summary.hunks.forEach((hunk, index) => {
          const isHost = index === hostIndex;
          if (hunk.newLines.length === 0 && !isHost) return;
          const dom = buildDiffZoneDom(hunk, isHost ? summary : null, {
            onAccept: () => void applyAccepted(),
            onReject: () => {
              teardown();
              setSuggestionStatus('已弃用行间修订');
            },
          });
          const heightInPx =
            Math.max(hunk.newLines.length, hunk.newLines.length === 0 ? 0 : 1) * lineHeight +
            (isHost ? 44 : 10);
          const id = accessor.addZone({
            afterLineNumber: hunk.afterLineNumber,
            heightInPx: Math.max(heightInPx, isHost ? 52 : lineHeight),
            domNode: dom,
          });
          session.zoneIds.push(id);
        });
      });

      // 键盘：Alt+Enter 接受、Esc 弃用（挂编辑器容器，捕获期）。
      const target = editor.getContainerDomNode?.() ?? null;
      if (target) {
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
            setSuggestionStatus('已弃用行间修订');
          }
        };
        target.addEventListener('keydown', handler, true);
        session.keydownHandler = handler;
        session.keydownTarget = target;
      }

      setSuggestionStatus(`行间修订建议已就绪：+${summary.addedLines} / -${summary.removedLines}`);
    },
    [applyAccepted, editorRef, setSuggestionStatus, teardown],
  );

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
      swapZoneToLoading(editor, session);

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
        });
        // 用户可能在等待期间关了会话/切了文件。
        if (sessionRef.current !== session || filePathRef.current !== path) return;
        sessionIdRef.current = result.assistantSessionId;
        session.model = result.model;
        renderDiff(before, result.after);
      } catch (error) {
        if (sessionRef.current !== session) return;
        teardown();
        setSuggestionStatus(
          `AI 修订失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [editorRef, filePathRef, projectName, renderDiff, setSuggestionStatus, teardown],
  );

  const open = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || typeof editor.changeViewZones !== 'function') return;
    const project = projectPathRef.current;
    const path = filePathRef.current;
    if (!project || !path) {
      setSuggestionStatus('先在右侧打开一个文件，再用 Ctrl+K 行间对话');
      return;
    }
    if (isReadOnlyDerivedProjectPath(path)) {
      setSuggestionStatus('派生缓存为只读，不能行间修订');
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

    const session: InlineSession = {
      phase: 'input',
      anchor,
      zoneIds: [],
      decorations: null,
      keydownHandler: null,
      keydownTarget: null,
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
    editor.changeViewZones((accessor) => {
      const id = accessor.addZone({
        afterLineNumber: anchor.endLine,
        heightInPx: 104,
        domNode: dom.container,
      });
      session.zoneIds.push(id);
    });
    // Monaco 把 zone DOM 挂上后再聚焦输入框。
    window.setTimeout(() => dom.textarea.focus(), 0);
  }, [editorRef, filePathRef, projectPathRef, send, setSuggestionStatus, teardown]);

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

  // 换文件时拆掉进行中的行间会话，避免 zone/decoration 残留到新文件。
  useEffect(() => {
    return () => teardown();
  }, [filePath, teardown]);
}

// ---- 命令式 DOM 构造（仅在 Ctrl+K 流程中运行，测试不触达） ----

function buildInputZoneDom(
  anchor: InlineAnchor,
  handlers: { onSend: (value: string) => void; onCancel: () => void },
): { container: HTMLElement; textarea: HTMLTextAreaElement } {
  const container = document.createElement('div');
  container.className = 'sf-inline-chat';

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
): void {
  const zoneId = session.zoneIds[0];
  if (!zoneId) return;
  // 简化处理：重建 zone 内容为 loading 行（保留同一 afterLineNumber）。
  editor.changeViewZones((accessor) => {
    accessor.removeZone(zoneId);
    const dom = document.createElement('div');
    dom.className = 'sf-inline-chat sf-inline-chat--loading';
    dom.textContent = '正在请求 AI 修订…';
    const id = accessor.addZone({
      afterLineNumber: session.anchor.endLine,
      heightInPx: 40,
      domNode: dom,
    });
    session.zoneIds = [id];
  });
}

function buildDiffZoneDom(
  hunk: LineDiffHunk,
  summaryForActions: ReturnType<typeof summarizeInlineDiff> | null,
  handlers: { onAccept: () => void; onReject: () => void },
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'sf-inline-diff-zone';

  for (const line of hunk.newLines) {
    const row = document.createElement('div');
    row.className = 'sf-inline-diff-line';
    row.textContent = line.length > 0 ? line : ' ';
    container.append(row);
  }

  if (summaryForActions) {
    const actions = document.createElement('div');
    actions.className = 'sf-inline-diff-actions';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'sf-inline-btn-accept';
    accept.textContent = '接受 (Alt+Enter)';
    accept.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onAccept();
    });

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'sf-inline-btn-reject';
    reject.textContent = '弃用 (Esc)';
    reject.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onReject();
    });

    const note = document.createElement('span');
    note.className = 'sf-inline-diff-note';
    note.textContent =
      summaryForActions.hunks.length > 1
        ? `+${summaryForActions.addedLines} / -${summaryForActions.removedLines} · 共 ${summaryForActions.hunks.length} 处，接受将整体应用`
        : `+${summaryForActions.addedLines} / -${summaryForActions.removedLines}`;

    actions.append(accept, reject, note);
    container.append(actions);
  }

  return container;
}
