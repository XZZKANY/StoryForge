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
