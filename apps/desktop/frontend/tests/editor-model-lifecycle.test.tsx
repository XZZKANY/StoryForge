import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { afterEach, test, vi } from 'vitest';
import {
  editor as monacoEditor,
  __getLastEditor,
  __getModels,
  __resetMonacoStub,
} from 'monaco-editor';

import { useMonacoEditor } from '../src/components/editor/useMonacoEditor';

type HarnessProps = {
  filePath: string;
  loadedFilePath: string | null;
  loadedContent: string;
  retainedFilePaths: string[];
  editorFontSize?: number;
};

function Harness({
  filePath,
  loadedFilePath,
  loadedContent,
  retainedFilePaths,
  editorFontSize = 14,
}: HarnessProps) {
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
    loadedDiskBaseline: { kind: 'content', content: loadedContent },
    editorFontSize,
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.restoreAllMocks();
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

function mockMotionPreference(initial: boolean) {
  let reduced = initial;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  Object.defineProperty(media, 'matches', { configurable: true, get: () => reduced });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  return {
    media,
    set(value: boolean) {
      reduced = value;
      media.dispatchEvent(new Event('change'));
    },
  };
}

async function mountMotionHarness() {
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
  return root;
}

test('Monaco create 接缝在首次创建时应用降低动效，而非等后续 render 才修正', async () => {
  mockMotionPreference(true);
  const create = vi.spyOn(monacoEditor, 'create');
  const root = await mountMotionHarness();
  try {
    assert.equal(create.mock.calls.length, 1);
    const options = create.mock.calls[0]?.[1];
    assert.equal(options?.smoothScrolling, false);
    assert.equal(options?.cursorSmoothCaretAnimation, 'off');
    assert.equal(options?.cursorBlinking, 'solid');
  } finally {
    act(() => root.unmount());
  }
});

test('系统动效偏好变化走 updateOptions，不重建 Monaco/model 或丢稿，卸载清理监听', async () => {
  const preference = mockMotionPreference(false);
  const addListener = vi.spyOn(preference.media, 'addEventListener');
  const removeListener = vi.spyOn(preference.media, 'removeEventListener');
  const create = vi.spyOn(monacoEditor, 'create');
  const root = await mountMotionHarness();
  let unmounted = false;
  try {
    const editor = __getLastEditor();
    assert.ok(editor);
    const model = editor.getModel();
    const updateOptions = vi.spyOn(editor, 'updateOptions');
    assert.equal(create.mock.calls[0]?.[1]?.smoothScrolling, true);
    assert.equal(editor.options.smoothScrolling, true);
    act(() => editor.setValue('A + 未保存输入'));
    act(() => preference.set(true));
    assert.equal(editor.options.smoothScrolling, false);
    assert.equal(editor.options.cursorSmoothCaretAnimation, 'off');
    assert.equal(editor.options.cursorBlinking, 'solid');
    act(() => {
      root.render(
        <Harness
          filePath="a.md"
          loadedFilePath="a.md"
          loadedContent="A"
          retainedFilePaths={['a.md']}
          editorFontSize={18}
        />,
      );
    });
    assert.equal(editor.options.fontSize, 18);
    assert.equal(editor.options.smoothScrolling, false);
    assert.equal(editor.options.cursorSmoothCaretAnimation, 'off');
    act(() => preference.set(false));
    assert.equal(editor.options.smoothScrolling, true);
    assert.equal(editor.options.cursorSmoothCaretAnimation, 'on');
    assert.equal(editor.options.cursorBlinking, 'smooth');
    assert.equal(create.mock.calls.length, 1);
    assert.equal(__getLastEditor(), editor);
    assert.equal(editor.getModel(), model);
    assert.equal(editor.getValue(), 'A + 未保存输入');
    const listener = addListener.mock.calls.filter(([event]) => event === 'change').at(-1)?.[1];
    assert.ok(listener);
    act(() => root.unmount());
    unmounted = true;
    assert.ok(
      removeListener.mock.calls.some(
        ([event, callback]) => event === 'change' && callback === listener,
      ),
    );
    const settledCalls = updateOptions.mock.calls.length;
    act(() => preference.set(true));
    assert.equal(updateOptions.mock.calls.length, settledCalls);
  } finally {
    if (!unmounted) act(() => root.unmount());
  }
});
