import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import * as monaco from 'monaco-editor';

import { registerSmokeEditorController } from '../../lib/smoke';
import { currentMonacoTheme } from '../../lib/theme';
import { STORYFORGE_EDITOR_UNICODE_HIGHLIGHT } from './options';

export function useMonacoEditor({
  containerRef,
  editorRef,
  filePath,
  loadedFilePath,
  loadedContent,
  editorFontSize,
  filePathRef,
  isDirtyRef,
  autoSaveRef,
  autoSaveTimerRef,
  cleanVersionIdRef,
  setLoadedContentPreview,
  setIsDirty,
  handleSave,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  filePath: string | null;
  loadedFilePath: string | null;
  loadedContent: string;
  editorFontSize: number;
  filePathRef: MutableRefObject<string | null>;
  isDirtyRef: MutableRefObject<boolean>;
  autoSaveRef: MutableRefObject<boolean>;
  autoSaveTimerRef: MutableRefObject<number | null>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  setLoadedContentPreview: Dispatch<SetStateAction<string>>;
  setIsDirty: Dispatch<SetStateAction<boolean>>;
  handleSave: () => Promise<void>;
}) {
  const [editorReady, setEditorReady] = useState(false);
  const [editorInitError, setEditorInitError] = useState('');
  const handleSaveRef = useRef(handleSave);

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

    frame = window.requestAnimationFrame(() => {
      if (disposed || !containerRef.current || editorRef.current) return;

      try {
        editor = monaco.editor.create(containerRef.current, {
          value: loadedContent,
          language: 'markdown',
          theme: currentMonacoTheme(),
          fontSize: editorFontSize,
          lineNumbers: 'on',
          glyphMargin: true,
          minimap: { enabled: true },
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          unicodeHighlight: STORYFORGE_EDITOR_UNICODE_HIGHLIGHT,
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
        const model = editorRef.current?.getModel();
        if (filePathRef.current && model) {
          const dirty = model.getAlternativeVersionId() !== cleanVersionIdRef.current;
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
      resizeObserver?.disconnect();
      editorRef.current = null;
      setEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性创建 Monaco 实例，仅取 loadedContent/editorFontSize 初始值；二者后续变化分别由下方 fontSize updateOptions effect 和 loadedContent setValue effect 接管，列入依赖会销毁重建编辑器、丢失光标与撤销历史
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize, editorRef]);

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
    editorRef.current.setValue(loadedContent);
    editorRef.current.layout();
    cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
  }, [cleanVersionIdRef, editorReady, editorRef, filePath, loadedContent, loadedFilePath]);

  return {
    editorReady,
    editorInitError,
  };
}
