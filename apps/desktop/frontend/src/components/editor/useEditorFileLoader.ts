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
  isDirtyRef,
  autoSaveTimerRef,
  resetSuggestionWriteback,
  adoptPendingSuggestion,
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
  isDirtyRef: MutableRefObject<boolean>;
  autoSaveTimerRef: MutableRefObject<number | null>;
  resetSuggestionWriteback: () => void;
  adoptPendingSuggestion: (path: string | null) => void;
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
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    isDirtyRef.current = false;
    setIsDirty(false);

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
        // 文件尚不存在时按"新文件"空内容打开（Agent 起草补丁的目标文件在确认写回前不落盘）；
        // pathExists 不可用（如浏览器 smoke mock 未提供）时回退旧行为，交给 readFile 决定。
        let exists = true;
        try {
          exists = await TauriFileSystem.pathExists(filePath);
        } catch {
          exists = true;
        }
        const content = exists ? await TauriFileSystem.readFile(filePath) : '';
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
        adoptPendingSuggestion(filePath);
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
    adoptPendingSuggestion,
    autoSaveTimerRef,
    cleanVersionIdRef,
    editorRef,
    filePath,
    filePathRef,
    issueDecorationsRef,
    isDirtyRef,
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
