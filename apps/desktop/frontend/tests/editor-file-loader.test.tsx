import assert from 'node:assert/strict';
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test } from 'vitest';
import type * as monaco from 'monaco-editor';
import { __getLastEditor, __resetMonacoStub } from 'monaco-editor';
import { Editor } from '../src/components/Editor';

import { useEditorFileLoader } from '../src/components/editor/useEditorFileLoader';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const noop = () => {};

function Harness({ filePath }: { filePath: string | null }) {
  const originalContentRef = useRef('');
  const issueDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const filePathRef = useRef(filePath);
  useLayoutEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);
  const isDirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const modelCacheRef = useRef<EditorModelCache>(new Map());
  const state = useEditorFileLoader({
    filePath,
    originalContentRef,
    issueDecorationsRef,
    filePathRef,
    isDirtyRef,
    autoSaveTimerRef,
    resetSuggestionWriteback: noop,
    adoptPendingSuggestion: noop,
    setLoadedContentPreview: noop,
    setIsDirty: noop,
    setShowHistory: noop,
    modelCacheRef,
  });
  return (
    <output
      data-testid="loader"
      data-loaded={state.loadedFilePath ?? ''}
      data-error={state.loadError}
    >
      <button type="button" data-testid="retry" onClick={state.retry}>
        retry
      </button>
    </output>
  );
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete window.__STORYFORGE_MOCK_FS__;
  __resetMonacoStub();
});

test('读取失败后可重试并只接受当前 request 的成功结果', async () => {
  let reads = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
    readFile: async () => {
      reads += 1;
      if (reads === 1) throw new Error('暂时不可读');
      return '恢复后的正文';
    },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness filePath="D:/book/正文/01.md" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(
    container.querySelector('[data-testid="loader"]')?.getAttribute('data-error'),
    '暂时不可读',
  );

  await act(async () => {
    (container!.querySelector('[data-testid="retry"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(reads, 2);
  assert.equal(
    container.querySelector('[data-testid="loader"]')?.getAttribute('data-loaded'),
    'D:/book/正文/01.md',
  );
  assert.equal(container.querySelector('[data-testid="loader"]')?.getAttribute('data-error'), '');
});

test('切换文件后旧读取结果不能覆盖新的页签目标', async () => {
  let resolveOld!: (content: string) => void;
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
    readFile: async (path) =>
      path.includes('/old.md')
        ? new Promise<string>((resolve) => {
            resolveOld = resolve;
          })
        : '新文件正文',
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness filePath="D:/book/old.md" />);
    await Promise.resolve();
  });
  await act(async () => {
    root!.render(<Harness filePath="D:/book/new.md" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  resolveOld('旧文件正文');
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(
    container.querySelector('[data-testid="loader"]')?.getAttribute('data-loaded'),
    'D:/book/new.md',
  );
});

test('卸载期间迟到的存在检查不再读取旧文件', async () => {
  let resolveExists!: (exists: boolean) => void;
  let reads = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: () =>
      new Promise<boolean>((resolve) => {
        resolveExists = resolve;
      }),
    readFile: async () => {
      reads += 1;
      return 'late content';
    },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness filePath="D:/book/old.md" />));
  act(() => root!.unmount());
  root = null;
  await act(async () => resolveExists(true));
  assert.equal(reads, 0, '卸载后的 pathExists 不能继续旧读取链');
});

test('同文件重试生成新请求，旧失败不得污染重试成功状态', async () => {
  let rejectOld!: (error: Error) => void;
  let reads = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
    readFile: async () =>
      ++reads === 1
        ? new Promise<string>((_resolve, reject) => {
            rejectOld = reject;
          })
        : 'latest',
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness filePath="D:/book/file.md" />));
  await act(async () =>
    (container!.querySelector('[data-testid="retry"]') as HTMLButtonElement).click(),
  );
  await act(async () => rejectOld(new Error('stale failure')));
  assert.equal(container.querySelector('[data-testid="loader"]')?.getAttribute('data-error'), '');
  assert.equal(
    container.querySelector('[data-testid="loader"]')?.getAttribute('data-loaded'),
    'D:/book/file.md',
  );
});

test('真实 Editor 读取失败脱离旧 model，点击重试直到成功都不挂回旧稿', async () => {
  let reads = 0;
  let resolveRetry!: (content: string) => void;
  const a = 'D:/book/a.md';
  const b = 'D:/book/b.md';
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => path === a || path === b,
    readFile: async (path) => {
      if (path === a) return '旧文件正文';
      if (path === b) {
        if (++reads === 1) throw new Error('文件暂时被占用');
        return new Promise<string>((resolve) => {
          resolveRetry = resolve;
        });
      }
      throw new Error('unexpected metadata read');
    },
    writeFile: async () => {
      throw new Error('禁止写回');
    },
  };
  const dialogs = { alert: async () => {}, confirm: async () => false, prompt: async () => null };
  const render = async (filePath: string) => {
    await act(async () =>
      root!.render(
        <Editor
          projectPath="D:/book"
          filePath={filePath}
          retainedFilePaths={[a, b]}
          dialogs={dialogs}
        />,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await render(a);
  const editor = __getLastEditor();
  assert.ok(editor);
  assert.equal(editor.getValue(), '旧文件正文');
  const oldModel = editor.getModel();
  await render(b);
  assert.equal(editor.getModel(), null);
  assert.equal(editor.options.readOnly, true);
  assert.match(
    container.querySelector('[data-testid="editor-load-error"]')?.textContent ?? '',
    /文件暂时被占用/,
  );
  await act(async () =>
    (container!.querySelector('[data-testid="editor-load-retry"]') as HTMLButtonElement).click(),
  );
  assert.equal(editor.getModel(), null);
  assert.equal(editor.options.readOnly, true);
  assert.ok(container.querySelector('[data-testid="editor-loading"]'));
  await act(async () => resolveRetry('重试读到的新稿'));
  assert.equal(editor.getValue(), '重试读到的新稿');
  assert.notEqual(editor.getModel(), oldModel);
  assert.equal(editor.options.readOnly, false);
  assert.equal(container.querySelector('[data-testid="editor-load-error"]'), null);
});
