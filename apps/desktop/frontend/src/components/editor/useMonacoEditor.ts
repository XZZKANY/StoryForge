import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import * as monaco from 'monaco-editor';

import { emitReviseIssue } from '../../lib/assistant-events';
import { registerSmokeEditorController } from '../../lib/smoke';

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
  issueByLineRef,
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
  issueByLineRef: MutableRefObject<Map<number, string>>;
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
    let frame = 0;

    frame = window.requestAnimationFrame(() => {
      if (disposed || !containerRef.current || editorRef.current) return;

      try {
        editor = monaco.editor.create(containerRef.current, {
          value: loadedContent,
          language: 'markdown',
          theme: 'vs-dark',
          fontSize: editorFontSize,
          lineNumbers: 'on',
          glyphMargin: true,
          minimap: { enabled: true },
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
        });
        cleanVersionIdRef.current = editor.getModel()?.getAlternativeVersionId() ?? null;
      } catch (err) {
        setEditorInitError(err instanceof Error ? err.message : String(err));
        return;
      }

      editorRef.current = editor;
      setEditorReady(true);
      setEditorInitError('');

      editor.onDidChangeModelContent(() => {
        const model = editorRef.current?.getModel();
        if (filePathRef.current && model) {
          const dirty = model.getAlternativeVersionId() !== cleanVersionIdRef.current;
          setIsDirty(dirty);
          if (autoSaveRef.current && dirty) {
            if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = window.setTimeout(() => {
              // eslint-disable-next-line react-hooks/immutability -- 自动保存定时器回调，非渲染期触发保存
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

      editor.onMouseDown((event) => {
        if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const lineNumber = event.target.position?.lineNumber;
        if (!lineNumber) return;
        const issueId = issueByLineRef.current.get(lineNumber);
        if (issueId) emitReviseIssue(issueId);
      });
    });

    return () => {
      disposed = true;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      window.cancelAnimationFrame(frame);
      editor?.dispose();
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
    cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
  }, [cleanVersionIdRef, editorReady, editorRef, filePath, loadedContent, loadedFilePath]);

  return {
    editorReady,
    editorInitError,
  };
}
