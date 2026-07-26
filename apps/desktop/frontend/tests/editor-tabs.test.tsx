import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorTabs } from '../src/components/shell/EditorTabs';

const noop = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('多标签分别明示未保存状态', () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: ['D:\\Book\\a.md', 'D:\\Book\\b.md'],
      activeFile: 'D:\\Book\\a.md',
      previewFile: null,
      dirtyFiles: new Set(['D:\\Book\\b.md']),
      activeTab: 'file',
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onCloseFile: noop,
    }),
  );

  assert.equal((html.match(/data-testid="editor-tab-dirty"/g) ?? []).length, 1);
  assert.match(html, /title="关闭（有未保存修改）"/);
});

test('预览页签也有关闭按钮（不再只能双击固定后才能关）', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let closed = 0;
  try {
    act(() => {
      root.render(
        React.createElement(EditorTabs, {
          openFiles: [],
          activeFile: null,
          previewFile: 'D:\\Book\\c.md',
          dirtyFiles: new Set<string>(),
          activeTab: 'preview',
          onFocusFile: noop,
          onFocusPreview: noop,
          onPinPreview: noop,
          onCloseFile: noop,
          onClosePreview: () => {
            closed += 1;
          },
        }),
      );
    });
    const closeButton = container.querySelector<HTMLButtonElement>('[role="tab"] button');
    assert.ok(closeButton, '预览页签必须渲染关闭按钮');
    act(() => {
      closeButton.click();
    });
    assert.equal(closed, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Q3a 文件页签行右端出现「…」文件操作菜单入口；无文件时不出现', () => {
  const withFile = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: ['D:\\Book\\a.md'],
      activeFile: 'D:\\Book\\a.md',
      previewFile: null,
      dirtyFiles: new Set<string>(),
      activeTab: 'file',
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onCloseFile: noop,
    }),
  );
  assert.match(withFile, /data-testid="editor-more-btn"/);

  // 没有任何文件页签时不该露出「…」文件操作菜单（那些操作都以活动文件为对象）。
  const noFiles = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: [],
      activeFile: null,
      previewFile: null,
      dirtyFiles: new Set<string>(),
      activeTab: null,
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onCloseFile: noop,
    }),
  );
  assert.equal(noFiles.includes('editor-more-btn'), false);
});

test('Q3a 只读派生文件的只读徽章落在页签行右端', () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: ['D:\\Book\\.storyforge\\canon\\derived\\dossier.md'],
      activeFile: 'D:\\Book\\.storyforge\\canon\\derived\\dossier.md',
      previewFile: null,
      dirtyFiles: new Set<string>(),
      activeTab: 'file',
      activeReadOnly: true,
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onCloseFile: noop,
    }),
  );
  assert.match(html, /只读派生文件/);
});
