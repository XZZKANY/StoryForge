import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommandPalette } from '../src/components/CommandPalette';
import { REQUEST_EDITOR_COMMAND_EVENT } from '../src/lib/assistant-events';
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

  assert.ok(html.includes('补齐作品目录'));
  assert.ok(html.includes('已有的不动'));
});

test('command palette hides story project initialization before a project is open', () => {
  const html = renderCommands(null);

  assert.equal(html.includes('补齐作品目录'), false);
});

test('没开作品时文件面板的入口叫「打开本地作品…」', () => {
  const html = renderToStaticMarkup(React.createElement(CommandPalette, paletteProps(null)));

  assert.ok(html.includes('打开本地作品…'));
  assert.equal(html.includes('打开项目'), false);
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

const PROJECT = 'D:\\书\\雾港回声';
const CHAPTER = 'D:\\书\\雾港回声\\正文\\第003章.md';

async function mountCommands(currentFile: string | null, calls: string[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(CommandPalette, {
        ...paletteProps(PROJECT),
        mode: 'commands',
        currentFile,
        onShowView: (view: string) => calls.push(`view:${view}`),
        fileActions: {
          onNewFile: async (dir: string) => void calls.push(`new:${dir}`),
          onRename: async (path: string, isDir: boolean) =>
            void calls.push(`rename:${path}:${isDir}`),
        },
        onNewSession: () => calls.push('session'),
        onReopenWelcome: noop,
        onToggleFontMode: noop,
        onCycleProseMeasure: noop,
        fontModeLabel: '',
        proseMeasureLabel: '',
      }),
    );
  });
  const titles = () =>
    [...container.querySelectorAll('[data-testid="palette-item"]')].map(
      (node) => node.textContent ?? '',
    );
  const click = async (title: string) => {
    const item = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="palette-item"]'),
    ].find((node) => node.textContent?.startsWith(title));
    assert.ok(item, title);
    await act(async () => item.click());
  };
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, titles, click, cleanup };
}

test('命令面板说作者的话：没有 Canon / dossier / 派生参考信号', async () => {
  const mounted = await mountCommands(CHAPTER, []);
  try {
    const text = mounted.container.textContent ?? '';
    for (const word of ['Canon', 'dossier', '派生参考信号', '初始化小说项目结构', '打开项目…']) {
      assert.equal(text.includes(word), false, word);
    }
    assert.ok(text.includes('打开本地作品…'));
    assert.ok(text.includes('刷新设定事实卡'));
  } finally {
    mounted.cleanup();
  }
});

test('命令面板能新建文件、改名、开版本历史、新建会话、打开左栏各视图', async () => {
  const calls: string[] = [];
  const commands: string[] = [];
  const onCommand = (event: Event) =>
    commands.push((event as CustomEvent<{ command: string }>).detail.command);
  window.addEventListener(REQUEST_EDITOR_COMMAND_EVENT, onCommand);
  const mounted = await mountCommands(CHAPTER, calls);
  try {
    const titles = mounted.titles();
    const views = [
      ['作品', 'B'],
      ['手稿', 'M'],
      ['资源管理器', 'E'],
      ['知识收件箱', 'I'],
      ['搜索', 'F'],
      ['观测镜', 'O'],
    ];
    for (const [label, key] of views) {
      assert.ok(
        titles.some(
          (title) => title.startsWith(`打开：${label}`) && title.endsWith(`Ctrl Shift ${key}`),
        ),
        label,
      );
    }
    assert.ok(
      titles.some((title) => title.startsWith('新建文件') && title.includes('在「正文」里')),
    );

    await mounted.click('新建文件');
    await mounted.click('重命名当前文件');
    await mounted.click('切换：版本历史');
    await mounted.click('新建会话');
    await mounted.click('打开：观测镜');
    assert.deepEqual(calls, [
      'new:D:\\书\\雾港回声\\正文',
      `rename:${CHAPTER}:false`,
      'session',
      'view:observatory',
    ]);
    assert.deepEqual(commands, ['toggle-history']);
  } finally {
    window.removeEventListener(REQUEST_EDITOR_COMMAND_EVENT, onCommand);
    mounted.cleanup();
  }
});

test('没开文件时新建落在作品根目录，不给改名和版本历史', async () => {
  const calls: string[] = [];
  const mounted = await mountCommands(null, calls);
  try {
    const titles = mounted.titles();
    assert.ok(
      titles.some((title) => title.startsWith('新建文件') && title.includes('在作品根目录')),
    );
    assert.equal(
      titles.some((title) => title.startsWith('重命名当前文件')),
      false,
    );
    assert.equal(
      titles.some((title) => title.startsWith('切换：版本历史')),
      false,
    );
    await mounted.click('新建文件');
    assert.deepEqual(calls, [`new:${PROJECT}`]);
  } finally {
    mounted.cleanup();
  }
});
