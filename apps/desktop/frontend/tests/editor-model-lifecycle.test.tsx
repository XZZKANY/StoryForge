import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { afterEach, test } from 'vitest';
import { __getLastEditor, __getModels, __resetMonacoStub } from 'monaco-editor';

import { useMonacoEditor } from '../src/components/editor/useMonacoEditor';

type HarnessProps = {
  filePath: string;
  loadedFilePath: string | null;
  loadedContent: string;
  retainedFilePaths: string[];
};

function Harness({ filePath, loadedFilePath, loadedContent, retainedFilePaths }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelCacheRef = useRef(new Map());
  const filePathRef = useRef<string | null>(filePath);
  const isDirtyRef = useRef(false);
  const autoSaveRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const cleanVersionIdRef = useRef<number | null>(null);
  const originalContentRef = useRef(loadedContent);
  const [, setPreview] = useState('');
  const [, setDirty] = useState(false);
  filePathRef.current = filePath;

  useMonacoEditor({
    containerRef,
    editorRef,
    filePath,
    loadedFilePath,
    loadedContent,
    editorFontSize: 14,
    filePathRef,
    isDirtyRef,
    autoSaveRef,
    autoSaveTimerRef,
    cleanVersionIdRef,
    originalContentRef,
    setLoadedContentPreview: setPreview,
    setIsDirty: setDirty,
    handleSave: async () => {},
    readOnly: false,
    loadedIsDirty: false,
    modelCacheRef,
    retainedFilePaths,
  });

  return <div ref={containerRef} />;
}

afterEach(() => {
  __resetMonacoStub();
  document.body.innerHTML = '';
});

test('按文件保留 Monaco model 和 view state，加载中脱离旧 model，关闭后 dispose', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <Harness
        filePath="a.md"
        loadedFilePath="a.md"
        loadedContent="A"
        retainedFilePaths={['a.md']}
      />,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
  const editor = __getLastEditor();
  assert.ok(editor);
  const [modelA] = __getModels();
  assert.equal(editor.getModel(), modelA);
  editor.setTestViewState({ cursor: 7 });

  await act(async () => {
    root.render(
      <Harness
        filePath="b.md"
        loadedFilePath={null}
        loadedContent=""
        retainedFilePaths={['a.md', 'b.md']}
      />,
    );
  });
  assert.equal(editor.getModel(), null);
  assert.equal(editor.options.readOnly, true);

  await act(async () => {
    root.render(
      <Harness
        filePath="b.md"
        loadedFilePath="b.md"
        loadedContent="B"
        retainedFilePaths={['a.md', 'b.md']}
      />,
    );
  });
  const [, modelB] = __getModels();
  assert.equal(editor.getModel(), modelB);

  await act(async () => {
    root.render(
      <Harness
        filePath="a.md"
        loadedFilePath="a.md"
        loadedContent="A"
        retainedFilePaths={['a.md']}
      />,
    );
  });
  assert.equal(editor.getModel(), modelA);
  assert.deepEqual(editor.restoredViewState, { cursor: 7 });
  assert.equal(modelB.disposed, true);

  act(() => root.unmount());
});
