import { useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import { TauriFileSystem } from '../../lib/tauri-fs';

export function useEditorFileLoader({
  filePath,
  editorRef,
  originalContentRef,
  cleanVersionIdRef,
  issueDecorationsRef,
  filePathRef,
  resetSuggestionWriteback,
  setLoadedContentPreview,
  setIsDirty,
  setShowHistory,
}: {
  filePath: string | null;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  originalContentRef: MutableRefObject<string>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  issueDecorationsRef: MutableRefObject<monaco.editor.IEditorDecorationsCollection | null>;
  filePathRef: MutableRefObject<string | null>;
  resetSuggestionWriteback: () => void;
  setLoadedContentPreview: (preview: string) => void;
  setIsDirty: (dirty: boolean) => void;
  setShowHistory: (show: boolean) => void;
}) {
  const loadRequestIdRef = useRef(0);
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null);
  const [loadedContent, setLoadedContent] = useState('');
  const [loadAttemptFilePath, setLoadAttemptFilePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  // 加载文件内容
  useLayoutEffect(() => {
    loadRequestIdRef.current += 1;
    const requestId = loadRequestIdRef.current;
    issueDecorationsRef.current?.clear();

    if (!filePath) {
      originalContentRef.current = '';
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filePath 清空时同步重置加载态，React18 合法模式
      setLoadedFilePath(null);
      setLoadedContent('');
      setLoadedContentPreview('');
      setLoadAttemptFilePath(null);
      setLoadError('');
      setShowHistory(false);
      resetSuggestionWriteback();
      setIsDirty(false);
      editorRef.current?.setValue('');
      return;
    }

    setLoadAttemptFilePath(filePath);
    setLoadedFilePath(null);
    setLoadedContent('');
    setLoadedContentPreview('');
    setLoadError('');
    setShowHistory(false);
    resetSuggestionWriteback();

    const loadFile = async () => {
      try {
        const content = await TauriFileSystem.readFile(filePath);
        if (loadRequestIdRef.current !== requestId || filePathRef.current !== filePath) {
          return;
        }
        originalContentRef.current = content;
        setLoadedContent(content);
        if (editorRef.current) {
          editorRef.current.setValue(content);
          cleanVersionIdRef.current =
            editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
        }
        setIsDirty(false);
        setLoadedFilePath(filePath);
        setLoadedContentPreview(content.slice(0, 120));
      } catch (err) {
        if (loadRequestIdRef.current !== requestId || filePathRef.current !== filePath) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error('读取文件失败:', err);
        setLoadError(message);
      }
    };

    void loadFile();
  }, [
    cleanVersionIdRef,
    editorRef,
    filePath,
    filePathRef,
    issueDecorationsRef,
    originalContentRef,
    resetSuggestionWriteback,
    setIsDirty,
    setLoadedContentPreview,
    setShowHistory,
  ]);

  return {
    loadedFilePath,
    loadedContent,
    loadAttemptFilePath,
    loadError,
  };
}
