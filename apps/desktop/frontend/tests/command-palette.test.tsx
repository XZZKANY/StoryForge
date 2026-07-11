import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommandPalette } from '../src/components/CommandPalette';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

const noop = () => {};

function paletteProps(projectPath: string | null) {
  return {
    mode: 'files' as const,
    projectPath,
    currentFile: null,
    onClose: noop,
    onOpenFile: noop,
    onOpenProject: noop,
    onInitializeProject: noop,
    onRefreshCanon: noop,
    onExportCurrent: noop,
    onToggleAssistant: noop,
    onToggleWorkspace: noop,
    onOpenSettings: noop,
    onFocusAssistantOnly: noop,
    onFocusWorkspaceOnly: noop,
    onRestoreLayout: noop,
  };
}

function renderCommands(projectPath: string | null) {
  return renderToStaticMarkup(
    React.createElement(CommandPalette, {
      mode: 'commands',
      projectPath,
      currentFile: null,
      onClose: () => {},
      onOpenFile: () => {},
      onOpenProject: () => {},
      onInitializeProject: () => {},
      onExportCurrent: () => {},
      onToggleAssistant: () => {},
      onToggleWorkspace: () => {},
      onOpenSettings: () => {},
      onFocusAssistantOnly: () => {},
      onFocusWorkspaceOnly: () => {},
      onRestoreLayout: () => {},
    }),
  );
}

test('command palette exposes story project initialization for active projects', () => {
  const html = renderCommands('D:\\StoryForge\\Books\\雾港回声');

  assert.ok(html.includes('初始化小说项目结构'));
  assert.ok(html.includes('雾港回声'));
});

test('command palette hides story project initialization before a project is open', () => {
  const html = renderCommands(null);

  assert.equal(html.includes('初始化小说项目结构'), false);
});

test('文件目录读取失败时显示错误与重试入口，而不是无匹配项', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const previousMock = window.__STORYFORGE_MOCK_FS__;
  const projectPath = 'D:\\StoryForge\\PaletteLoadError';
  let calls = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    async listDir() {
      calls += 1;
      if (calls === 1) throw new Error('permission denied');
      return [
        {
          name: '第一章.md',
          path: `${projectPath}\\正文\\第一章.md`,
          isDir: false,
          size: 1,
          modified: 1,
          extension: 'md',
        },
      ];
    },
  };
  invalidateFileSystemCache(projectPath);

  try {
    await act(async () => {
      root.render(React.createElement(CommandPalette, paletteProps(projectPath)));
    });

    assert.match(container.textContent ?? '', /无法读取项目文件/);
    assert.equal((container.textContent ?? '').includes('无匹配项'), false);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="palette-retry"]');
    assert.ok(retry);

    await act(async () => retry.click());

    assert.equal(calls, 2);
    assert.match(container.textContent ?? '', /正文[\\/]第一章\.md/);
  } finally {
    act(() => root.unmount());
    container.remove();
    window.__STORYFORGE_MOCK_FS__ = previousMock;
    invalidateFileSystemCache(projectPath);
  }
});
