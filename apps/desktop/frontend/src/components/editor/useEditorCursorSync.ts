import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import {
  AUTHOR_VIEW_SELECTION_MAX_CHARS,
  LOCATE_IN_EDITOR_EVENT,
  emitEditorAuthorView,
  emitEditorCursorLine,
  type LocateInEditorDetail,
} from '../../lib/assistant-events';
import { resolveAnchorLine } from '../../lib/observations';
import type { FileCursor } from '../../lib/workspace-session';
import type { SuggestionStatusTone } from './useSuggestionState';

// 光标与视图同步：向外广播光标行与作者视图，从外面把光标放回来（恢复现场、观测定位）。

export function useEditorCursorSync({
  editorRef,
  editorReady,
  filePath,
  filePathRef,
  loadedFilePath,
  initialCursors,
  onCursorPersist,
  setSuggestionStatus,
}: {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePathRef: MutableRefObject<string | null>;
  editorReady: boolean;
  filePath: string | null;
  loadedFilePath: string | null;
  initialCursors: Record<string, FileCursor> | null;
  onCursorPersist?: (filePath: string, cursor: FileCursor) => void;
  setSuggestionStatus: (text: string, tone?: SuggestionStatusTone) => void;
}) {
  // 观测镜实体联动：光标行变化去抖后广播行文本，观测侧按实体表面形匹配亮卡
  //（monaco stub 无光标 API，均 typeof 守卫）。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor || typeof editor.onDidChangeCursorPosition !== 'function') return;
    let timer: number | null = null;
    const subscription = editor.onDidChangeCursorPosition((event) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const model = editor.getModel();
        const lineNumber = event.position?.lineNumber;
        if (
          !model ||
          typeof model.getLineContent !== 'function' ||
          typeof model.getLineCount !== 'function' ||
          typeof lineNumber !== 'number' ||
          lineNumber < 1 ||
          lineNumber > model.getLineCount()
        ) {
          return;
        }
        emitEditorCursorLine({
          filePath: filePathRef.current,
          lineText: model.getLineContent(lineNumber),
        });
        // 恢复现场：光标位置搭同一趟去抖记账，不再单开一个监听。
        const path = filePathRef.current;
        if (path) {
          onCursorPersist?.(path, { line: lineNumber, column: event.position?.column ?? 1 });
        }
      }, 180);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      subscription.dispose();
    };
  }, [editorReady, onCursorPersist, editorRef, filePathRef]);

  // 恢复现场：某文件首次装载完成时，把上次停笔的光标放回去并滚到视野中央。
  // 每个路径只应用一次（appliedInitialCursorRef），否则来回切页签会把作者刚移动的光标拽回去。
  const appliedInitialCursorRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const editor = editorRef.current;
    const cursor = filePath ? initialCursors?.[filePath] : null;
    if (!editorReady || !editor || !filePath || !cursor) return;
    if (loadedFilePath !== filePath) return;
    if (appliedInitialCursorRef.current.has(filePath)) return;
    // monaco stub（vitest）没有这些 API，逐个 typeof 守卫。
    if (typeof editor.setPosition !== 'function' || typeof editor.getModel !== 'function') return;
    const model = editor.getModel();
    if (!model || typeof model.getLineCount !== 'function') return;
    appliedInitialCursorRef.current.add(filePath);
    // 文件在上次退出后被外部改短是常态（Agent 写回、手动编辑），行号必须夹到当前行数内。
    const line = Math.min(Math.max(cursor.line, 1), model.getLineCount());
    editor.setPosition({ lineNumber: line, column: Math.max(cursor.column, 1) });
    if (typeof editor.revealLineInCenter === 'function') editor.revealLineInCenter(line);
  }, [editorReady, filePath, initialCursors, loadedFilePath, editorRef]);

  // 作者当前视图：内容 / 选区 / 换模型共用去抖广播；订阅前确认事件接口齐全。
  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editorReady ||
      !editor ||
      typeof editor.onDidChangeModelContent !== 'function' ||
      typeof editor.onDidChangeCursorSelection !== 'function' ||
      typeof editor.onDidChangeModel !== 'function'
    ) {
      return;
    }
    let timer: number | null = null;
    const broadcast = () => {
      const model = editor.getModel();
      if (!model || typeof model.getValue !== 'function') {
        return;
      }
      let selectionText = '';
      const selections = typeof editor.getSelections === 'function' ? editor.getSelections() : null;
      if (selections && typeof model.getValueInRange === 'function') {
        for (const selection of selections) {
          const selected = model.getValueInRange(selection);
          selectionText += selected;
        }
      }
      const position = typeof editor.getPosition === 'function' ? editor.getPosition() : null;
      emitEditorAuthorView({
        filePath: filePathRef.current,
        cursorLine: position?.lineNumber ?? 0,
        cursorColumn: position?.column ?? 0,
        selectionText: selectionText.slice(0, AUTHOR_VIEW_SELECTION_MAX_CHARS),
      });
    };
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(broadcast, 200);
    };
    broadcast();
    const subscriptions = [
      editor.onDidChangeModelContent(schedule),
      editor.onDidChangeCursorSelection(schedule),
      editor.onDidChangeModel(schedule),
    ];
    return () => {
      if (timer) window.clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
    };
  }, [editorReady, editorRef, filePathRef]);

  // 观测面板点行定位：目标文件已就绪立即跳；否则挂起等 loader 完成（打开文件是异步的）。
  const pendingLocateRef = useRef<LocateInEditorDetail | null>(null);
  const applyLocate = useCallback(
    (detail: LocateInEditorDetail): boolean => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return false;
      const line = resolveAnchorLine(model.getValue(), {
        line: detail.line,
        snippet: detail.snippet,
      });
      if (line == null) {
        // snippet 锚（prose 类无行号）在原文改动后会失效：明确提示，不静默落空。
        setSuggestionStatus('观测锚点失效：原文可能已改动，请按观测详情手动核对', 'error');
        return true;
      }
      if (typeof editor.setPosition === 'function') {
        editor.setPosition({ lineNumber: line, column: 1 });
      }
      if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
        editor.revealLineInCenterIfOutsideViewport(line);
      }
      if (typeof editor.focus === 'function') editor.focus();
      return true;
    },
    [setSuggestionStatus, editorRef],
  );

  useEffect(() => {
    const onLocate = (event: Event) => {
      const detail = (event as CustomEvent<LocateInEditorDetail>).detail;
      if (!detail?.filePath) return;
      if (detail.filePath === filePathRef.current && applyLocate(detail)) return;
      pendingLocateRef.current = detail;
    };
    window.addEventListener(LOCATE_IN_EDITOR_EVENT, onLocate);
    return () => window.removeEventListener(LOCATE_IN_EDITOR_EVENT, onLocate);
  }, [applyLocate, filePathRef]);

  useEffect(() => {
    const pending = pendingLocateRef.current;
    if (!pending || loadedFilePath !== pending.filePath) return;
    if (applyLocate(pending)) pendingLocateRef.current = null;
  }, [loadedFilePath, applyLocate]);
}
