import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import * as monaco from 'monaco-editor';

import { registerSmokeEditorController } from '../../lib/smoke';
import { currentMonacoTheme, ensureMonacoThemes } from '../../lib/theme';
import {
  lineNumbersFor,
  STORYFORGE_EDITOR_FONT_GRID,
  STORYFORGE_EDITOR_UNICODE_HIGHLIGHT,
} from './options';
// editorFontFamily 缺省用格子栈；散文栈由 Editor 依 editorFontMode 解析后传入。

export type EditorModelState = {
  model: monaco.editor.ITextModel;
  originalContent: string;
  viewState: monaco.editor.ICodeEditorViewState | null;
};

export type EditorModelCache = Map<string, EditorModelState>;

export function useMonacoEditor({
  containerRef,
  editorRef,
  filePath,
  loadedFilePath,
  loadedContent,
  editorFontSize,
  editorFontFamily = STORYFORGE_EDITOR_FONT_GRID,
  filePathRef,
  isDirtyRef,
  autoSaveRef,
  autoSaveTimerRef,
  cleanVersionIdRef,
  originalContentRef,
  setLoadedContentPreview,
  setIsDirty,
  handleSave,
  readOnly,
  loadedIsDirty,
  modelCacheRef,
  retainedFilePaths,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePath: string | null;
  loadedFilePath: string | null;
  loadedContent: string;
  editorFontSize: number;
  editorFontFamily?: string;
  filePathRef: MutableRefObject<string | null>;
  isDirtyRef: MutableRefObject<boolean>;
  autoSaveRef: MutableRefObject<boolean>;
  autoSaveTimerRef: MutableRefObject<number | null>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  originalContentRef: MutableRefObject<string>;
  setLoadedContentPreview: Dispatch<SetStateAction<string>>;
  setIsDirty: Dispatch<SetStateAction<boolean>>;
  handleSave: () => Promise<void>;
  readOnly: boolean;
  loadedIsDirty: boolean;
  modelCacheRef: MutableRefObject<EditorModelCache>;
  retainedFilePaths: string[];
}) {
  const [editorReady, setEditorReady] = useState(false);
  const [editorInitError, setEditorInitError] = useState('');
  const handleSaveRef = useRef(handleSave);
  const activeModelPathRef = useRef<string | null>(null);
  const loadPending = Boolean(filePath) && loadedFilePath !== filePath;

  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  // 初始化编辑器
  useEffect(() => {
    if (editorRef.current) return;

    let disposed = false;
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let frame = 0;
    const modelCache = modelCacheRef.current;

    frame = window.requestAnimationFrame(() => {
      if (disposed || !containerRef.current || editorRef.current) return;

      try {
        ensureMonacoThemes(monaco);
        editor = monaco.editor.create(containerRef.current, {
          model: null,
          theme: currentMonacoTheme(),
          fontSize: editorFontSize,
          fontFamily: editorFontFamily,
          lineNumbers: lineNumbersFor(filePath),
          glyphMargin: true,
          // Q9 七轮反馈：小说正文没有代码缩略图需求，minimap 删。
          minimap: { enabled: false },
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          // Q2：滚动条按需出现、去掉投影阴影，宽度与 DOM 侧 11px 细滚条对齐（thumb 颜色
          // 由 storyforge 主题的 scrollbarSlider token 控制）。
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            useShadows: false,
            verticalScrollbarSize: 11,
            horizontalScrollbarSize: 11,
          },
          // minimap 已关的正文场景，overview ruler 只剩一条竖线 + 光标灰块，真机被误认成
          // 「多余的滚动条」；整体关掉，审稿 issue 定位靠 gutter 圆点与词级下划线。
          overviewRulerLanes: 0,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          unicodeHighlight: STORYFORGE_EDITOR_UNICODE_HIGHLIGHT,
          readOnly: readOnly || loadPending,
        });
        cleanVersionIdRef.current = editor.getModel()?.getAlternativeVersionId() ?? null;
      } catch (err) {
        setEditorInitError(err instanceof Error ? err.message : String(err));
        return;
      }

      editorRef.current = editor;
      setEditorReady(true);
      setEditorInitError('');

      resizeObserver =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              editorRef.current?.layout();
            });
      resizeObserver?.observe(containerRef.current);

      editor.onDidChangeModelContent(() => {
        const activePath = activeModelPathRef.current;
        const model = editorRef.current?.getModel();
        const state = activePath ? modelCacheRef.current.get(activePath) : null;
        if (activePath && model && state?.model === model) {
          originalContentRef.current = state.originalContent;
          const dirty = model.getValue() !== state.originalContent;
          setIsDirty(dirty);
          if (autoSaveRef.current && dirty) {
            if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = window.setTimeout(() => {
              if (filePathRef.current && editorRef.current) void handleSaveRef.current();
            }, 900);
          }
        }
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (filePathRef.current && isDirtyRef.current) {
          void handleSaveRef.current();
        }
      });
    });

    return () => {
      disposed = true;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      window.cancelAnimationFrame(frame);
      editor?.dispose();
      for (const state of modelCache.values()) state.model.dispose();
      modelCache.clear();
      resizeObserver?.disconnect();
      editorRef.current = null;
      setEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性创建 Monaco 实例；字体、只读态和按路径 model 均由后续 effects 更新，列入依赖会销毁编辑器与缓存 model
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor) return;

    const previousPath = activeModelPathRef.current;
    const previousState = previousPath ? modelCacheRef.current.get(previousPath) : null;
    if (previousState && editor.getModel() === previousState.model) {
      previousState.viewState = editor.saveViewState();
    }

    const nextState = filePath ? modelCacheRef.current.get(filePath) : null;
    if (!filePath || !nextState) {
      editor.setModel(null);
      editor.updateOptions({ readOnly: true });
      activeModelPathRef.current = null;
      cleanVersionIdRef.current = null;
      setIsDirty(false);
      return;
    }

    originalContentRef.current = nextState.originalContent;
    editor.setModel(nextState.model);
    if (nextState.viewState) editor.restoreViewState(nextState.viewState);
    editor.updateOptions({ readOnly });
    activeModelPathRef.current = filePath;
    cleanVersionIdRef.current = nextState.model.getAlternativeVersionId();
    setLoadedContentPreview(nextState.model.getValue().slice(0, 120));
    setIsDirty(nextState.model.getValue() !== nextState.originalContent);
  }, [
    cleanVersionIdRef,
    editorReady,
    editorRef,
    filePath,
    modelCacheRef,
    originalContentRef,
    readOnly,
    setIsDirty,
    setLoadedContentPreview,
  ]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: editorFontSize,
      fontFamily: editorFontFamily,
      readOnly: readOnly || loadPending,
      lineNumbers: lineNumbersFor(filePath),
    });
  }, [editorFontSize, editorFontFamily, editorRef, filePath, loadPending, readOnly]);

  useEffect(() => {
    const retained = new Set(retainedFilePaths);
    for (const [path, state] of modelCacheRef.current) {
      if (retained.has(path)) continue;
      if (editorRef.current?.getModel() === state.model) editorRef.current.setModel(null);
      state.model.dispose();
      modelCacheRef.current.delete(path);
      if (activeModelPathRef.current === path) activeModelPathRef.current = null;
    }
  }, [editorRef, modelCacheRef, retainedFilePaths]);

  useEffect(
    () =>
      registerSmokeEditorController({
        setContent(content: string) {
          if (!editorRef.current) return false;
          editorRef.current.setValue(content);
          editorRef.current.layout();
          setLoadedContentPreview(content.slice(0, 120));
          return true;
        },
        getContent() {
          return editorRef.current?.getValue() ?? null;
        },
      }),
    [editorRef, setLoadedContentPreview],
  );

  useEffect(() => {
    if (!editorReady || !editorRef.current || loadedFilePath !== filePath) return;
    if (!filePath) {
      editorRef.current.setModel(null);
      activeModelPathRef.current = null;
      return;
    }

    let state = modelCacheRef.current.get(filePath);
    if (!state) {
      const language = filePath.toLowerCase().endsWith('.json') ? 'json' : 'markdown';
      state = {
        model: monaco.editor.createModel(loadedContent, language),
        originalContent: loadedIsDirty ? originalContentRef.current : loadedContent,
        viewState: null,
      };
      modelCacheRef.current.set(filePath, state);
    }

    originalContentRef.current = state.originalContent;
    editorRef.current.setModel(state.model);
    if (state.viewState) editorRef.current.restoreViewState(state.viewState);
    editorRef.current.updateOptions({ readOnly });
    activeModelPathRef.current = filePath;
    editorRef.current.layout();
    cleanVersionIdRef.current = state.model.getAlternativeVersionId();
    setLoadedContentPreview(state.model.getValue().slice(0, 120));
    setIsDirty(state.model.getValue() !== state.originalContent);
  }, [
    cleanVersionIdRef,
    editorReady,
    editorRef,
    filePath,
    loadedContent,
    loadedIsDirty,
    loadedFilePath,
    modelCacheRef,
    originalContentRef,
    readOnly,
    setIsDirty,
    setLoadedContentPreview,
  ]);

  return {
    editorReady,
    editorInitError,
  };
}
