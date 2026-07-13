import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorTabs } from '../src/components/shell/EditorTabs';

const noop = () => {};

test('多标签分别明示未保存状态', () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: ['D:\\Book\\a.md', 'D:\\Book\\b.md'],
      activeFile: 'D:\\Book\\a.md',
      previewFile: null,
      dirtyFiles: new Set(['D:\\Book\\b.md']),
      settingsOpen: false,
      activeTab: 'file',
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onFocusSettings: noop,
      onCloseFile: noop,
      onCloseSettings: noop,
    }),
  );

  assert.equal((html.match(/data-testid="editor-tab-dirty"/g) ?? []).length, 1);
  assert.match(html, /title="关闭（有未保存修改）"/);
});

test('Q3a 文件页签行右端出现「…」文件操作菜单入口；设置页签不出现', () => {
  const withFile = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: ['D:\\Book\\a.md'],
      activeFile: 'D:\\Book\\a.md',
      previewFile: null,
      dirtyFiles: new Set<string>(),
      settingsOpen: false,
      activeTab: 'file',
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onFocusSettings: noop,
      onCloseFile: noop,
      onCloseSettings: noop,
    }),
  );
  assert.match(withFile, /data-testid="editor-more-btn"/);

  const settingsOnly = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: [],
      activeFile: null,
      previewFile: null,
      dirtyFiles: new Set<string>(),
      settingsOpen: true,
      activeTab: 'settings',
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onFocusSettings: noop,
      onCloseFile: noop,
      onCloseSettings: noop,
    }),
  );
  assert.equal(settingsOnly.includes('editor-more-btn'), false);
});

test('Q3a 只读派生文件的只读徽章落在页签行右端', () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      openFiles: ['D:\\Book\\.storyforge\\canon\\derived\\dossier.md'],
      activeFile: 'D:\\Book\\.storyforge\\canon\\derived\\dossier.md',
      previewFile: null,
      dirtyFiles: new Set<string>(),
      settingsOpen: false,
      activeTab: 'file',
      activeReadOnly: true,
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onFocusSettings: noop,
      onCloseFile: noop,
      onCloseSettings: noop,
    }),
  );
  assert.match(html, /只读派生文件/);
});
