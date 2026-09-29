import assert from 'node:assert/strict';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useEditorNavigation } from '../src/components/app/useEditorNavigation';
import { LOCATE_IN_EDITOR_EVENT } from '../src/lib/assistant-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof useEditorNavigation>[0];
type Navigation = ReturnType<typeof useEditorNavigation>;
let root: Root;
let container: HTMLDivElement;
let navigation: Navigation;
let effects: unknown[];

function Harness({ options }: { options: Options }) {
  const actions = useEditorNavigation(options);
  useLayoutEffect(() => {
    navigation = actions;
  }, [actions]);
  return null;
}

function onLocate(event: Event) {
  assert.ok(event instanceof CustomEvent);
  effects.push(['locate', event.detail]);
}

beforeEach(() => {
  effects = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.addEventListener(LOCATE_IN_EDITOR_EVENT, onLocate);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.removeEventListener(LOCATE_IN_EDITOR_EVENT, onLocate);
});

async function mount(overrides: Partial<Options> = {}) {
  const options: Options = {
    activeProject: '/books/样例',
    displayedFile: null,
    showEditor: vi.fn(() => {
      effects.push(['show']);
    }),
    openFile: vi.fn(async (path: string, label?: string) => {
      effects.push(['open', path, label]);
    }),
    ...overrides,
  };
  await act(async () => root.render(<Harness options={options} />));
  return options;
}

for (const [method, label] of [
  ['openOutlineHeading', '打开大纲'],
  ['openSearchHit', '打开搜索结果'],
] as const) {
  for (const sameFile of [false, true]) {
    test(`${method}: ${sameFile ? '当前' : '其他'}文件先展示编辑器，保持定位次序且不要求项目`, async () => {
      const path = '/books/样例/正文/第一章.md';
      await mount({ activeProject: null, displayedFile: sameFile ? path : null });
      navigation[method](path, 7);
      assert.deepEqual(effects, [
        ['show'],
        ...(sameFile ? [] : [['open', path, label]]),
        ['locate', { filePath: path, line: 7 }],
      ]);
    });
  }
}

for (const [project, expected] of [
  ['D:\\样例\\', 'D:\\样例\\正文\\第一章.md'],
  ['D:/样例///', 'D:/样例/正文/第一章.md'],
  ['/books/样例/', '/books/样例/正文/第一章.md'],
  ['/', '/正文/第一章.md'],
]) {
  test(`锚点与章节沿用项目路径风格: ${project}`, async () => {
    await mount({ activeProject: project });
    navigation.locateAnchor({ path: '正文/第一章.md', line: 3, snippet: '原文锚点' });
    assert.deepEqual(effects, [
      ['show'],
      ['open', expected, '定位观测'],
      ['locate', { filePath: expected, line: 3, snippet: '原文锚点' }],
    ]);
    effects = [];
    navigation.openManuscriptChapter('正文/第一章.md');
    assert.deepEqual(effects, [['show'], ['open', expected, '打开章节']]);
  });
}

test('无项目时观测/章节不导航，无锚点观测没有副作用', async () => {
  await mount({ activeProject: null });
  navigation.locateAnchor({ path: '正文/第一章.md' });
  navigation.openManuscriptChapter('正文/第一章.md');
  navigation.locateObservation({ id: '1', title: '诊断', severity: 'advisory' });
  assert.deepEqual(effects, []);
  await mount();
  navigation.locateObservation({ id: '1', title: '诊断', severity: 'advisory' });
  assert.deepEqual(effects, []);
});

test('同一文件仍定位观测，但不重复打开；章节只展示编辑器', async () => {
  const path = '/books/样例/正文/第一章.md';
  await mount({ displayedFile: path });
  navigation.locateObservation({
    id: '1',
    title: '诊断',
    severity: 'warning',
    anchor: { path: '正文/第一章.md' },
  });
  navigation.openManuscriptChapter('正文/第一章.md');
  assert.deepEqual(effects, [
    ['show'],
    ['locate', { filePath: path, line: undefined, snippet: undefined }],
    ['show'],
  ]);
});

test('openFile 尚未完成时定位事件仍同步发布，编辑器负责就绪后消费', async () => {
  let finish: (() => void) | undefined;
  await mount({
    openFile: (path, label) => {
      effects.push(['open', path, label]);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  navigation.openSearchHit('/books/样例/第一章.md', 9);
  assert.equal(effects.length, 3);
  assert.deepEqual(effects[2], ['locate', { filePath: '/books/样例/第一章.md', line: 9 }]);
  assert.ok(finish);
  finish();
});

test('重渲染后使用当前项目/文件/回调，不捕获旧导航状态', async () => {
  const old = await mount();
  navigation.openManuscriptChapter('正文/第一章.md');
  const nextPath = 'E:\\新项目\\正文\\第一章.md';
  const showEditor = vi.fn();
  const openFile = vi.fn(async () => {});
  await mount({ activeProject: 'E:\\新项目', displayedFile: nextPath, showEditor, openFile });
  effects = [];
  navigation.locateAnchor({ path: '正文/第一章.md', line: 2 });
  assert.equal(showEditor.mock.calls.length, 1);
  assert.equal(openFile.mock.calls.length, 0);
  assert.deepEqual(effects, [['locate', { filePath: nextPath, line: 2, snippet: undefined }]]);
  navigation.openOutlineHeading('/new.md', 1);
  assert.equal(openFile.mock.calls.length, 1);
  assert.equal(vi.mocked(old.openFile).mock.calls.length, 1);
});
