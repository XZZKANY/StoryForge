import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorTabs } from '../src/components/shell/EditorTabs';
import { nextCyclicEditorFile } from '../src/components/app/editor-tabs-state';

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
  // P2-C：关闭按钮 title 已升级附带「· Ctrl W」提示（暴露此前无入口的快捷键）。
  assert.match(html, /title="关闭（有未保存修改）· Ctrl W"/);
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
    const closeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="editor-tab-close"]',
    );
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

test('页签的 role=tab 不再包含嵌套关闭按钮，关闭控件保持相邻可达', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => {
      root.render(
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
    });
    assert.equal(container.querySelector('[role="tab"] button'), null);
    const close = container.querySelector<HTMLButtonElement>('[data-testid="editor-tab-close"]');
    assert.ok(close, '关闭控件仍应可由键盘单独到达');
    assert.match(close.getAttribute('aria-label') ?? '', /关闭/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('页签 Home/End 选择并激活首尾目标', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const focused: string[] = [];
  const renderTabs = (activeFile: string) =>
    root.render(
      React.createElement(EditorTabs, {
        openFiles: ['D:\\Book\\a.md', 'D:\\Book\\b.md', 'D:\\Book\\c.md'],
        activeFile,
        previewFile: null,
        dirtyFiles: new Set<string>(),
        activeTab: 'file',
        onFocusFile: (path: string) => focused.push(path),
        onFocusPreview: noop,
        onPinPreview: noop,
        onCloseFile: noop,
      }),
    );
  try {
    act(() => renderTabs('D:\\Book\\b.md'));
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    assert.equal(tabs.length, 3);
    act(() => {
      tabs[1].focus();
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    assert.equal(document.activeElement, tabs[0]);
    assert.deepEqual(focused, ['D:\\Book\\a.md']);
    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    assert.equal(document.activeElement, tabs[2]);
    assert.deepEqual(focused, ['D:\\Book\\a.md', 'D:\\Book\\c.md']);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('关闭页签后焦点衔接到前一个可见页签', () => {
  function Harness() {
    const [files, setFiles] = React.useState([
      'D:\\Book\\a.md',
      'D:\\Book\\b.md',
      'D:\\Book\\c.md',
    ]);
    const active = files.includes('D:\\Book\\b.md') ? 'D:\\Book\\b.md' : (files[0] ?? null);
    return React.createElement(EditorTabs, {
      openFiles: files,
      activeFile: active,
      previewFile: null,
      dirtyFiles: new Set<string>(),
      activeTab: active ? 'file' : null,
      onFocusFile: noop,
      onFocusPreview: noop,
      onPinPreview: noop,
      onCloseFile: (path: string) => setFiles((current) => current.filter((file) => file !== path)),
    });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(React.createElement(Harness)));
    const middle = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.dataset.tabPath === 'D:\\Book\\b.md',
    );
    assert.ok(middle);
    const close = middle.parentElement?.querySelector<HTMLButtonElement>(
      '[data-testid="editor-tab-close"]',
    );
    assert.ok(close);
    act(() => close.click());
    const previous = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.dataset.tabPath === 'D:\\Book\\a.md',
    );
    assert.equal(document.activeElement, previous);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('返回作品总览入口与页签 chrome 同行且保留回调', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let returned = 0;
  try {
    act(() => {
      root.render(
        React.createElement(EditorTabs, {
          openFiles: ['D:\\Book\\a.md'],
          activeFile: 'D:\\Book\\a.md',
          previewFile: null,
          dirtyFiles: new Set<string>(),
          activeTab: 'file',
          onOverview: () => {
            returned += 1;
          },
          onFocusFile: noop,
          onFocusPreview: noop,
          onPinPreview: noop,
          onCloseFile: noop,
        }),
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="back-to-book-overview"]',
    );
    assert.ok(button);
    act(() => button.click());
    assert.equal(returned, 1);
    assert.equal(button.parentElement, container.firstElementChild);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('润色菜单区分专用模型与本次主模型授权', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const choices: boolean[] = [];
  const renderTabs = () =>
    root.render(
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
        onPolishActive: (useMainModel: boolean) => choices.push(useMainModel),
      }),
    );

  try {
    act(renderTabs);
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="editor-polish-btn"]');
    assert.ok(trigger);
    act(() => trigger.click());
    const dedicated = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent === '使用专用润色模型',
    );
    assert.ok(dedicated);
    act(() => dedicated.click());

    act(() => trigger.click());
    const main = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent === '本次使用主模型',
    );
    assert.ok(main);
    act(() => main.click());
    assert.deepEqual(choices, [false, true]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Ctrl+Tab 页签循环：首尾相接、方向正确、不产生关闭副作用', () => {
  const files = ['D:\\Book\\a.md', 'D:\\Book\\b.md', 'D:\\Book\\c.md'];

  // 正向在固定页签间推进，末尾回到开头。
  assert.equal(nextCyclicEditorFile(files, files[0], 1), files[1]);
  assert.equal(nextCyclicEditorFile(files, files[1], 1), files[2]);
  assert.equal(nextCyclicEditorFile(files, files[2], 1), files[0]);
  // 反向同理。
  assert.equal(nextCyclicEditorFile(files, files[0], -1), files[2]);
  assert.equal(nextCyclicEditorFile(files, files[1], -1), files[0]);
});

test('Ctrl+Tab 在无页签 / 当前文件不在固定页签集合时给出确定落点而非原地不动', () => {
  const files = ['D:\\Book\\a.md', 'D:\\Book\\b.md'];
  // 没有固定页签：无目标可去，返回 null 让调用方不动。
  assert.equal(nextCyclicEditorFile([], 'D:\\Book\\a.md', 1), null);
  // 只有一个页签：循环回自己，不是 null（按一下不应毫无反应）。
  assert.equal(nextCyclicEditorFile(['D:\\Book\\a.md'], 'D:\\Book\\a.md', 1), 'D:\\Book\\a.md');
  // 当前在预览槽（不在固定集合）或当前为空：正向落首个、反向落末尾。
  assert.equal(nextCyclicEditorFile(files, 'D:\\Book\\preview.md', 1), 'D:\\Book\\a.md');
  assert.equal(nextCyclicEditorFile(files, null, 1), 'D:\\Book\\a.md');
  assert.equal(nextCyclicEditorFile(files, 'D:\\Book\\preview.md', -1), 'D:\\Book\\b.md');
});

for (const destination of ['author-input', 'another-tab', 'original-close'] as const) {
  test(`异步关闭完成尊重作者后续焦点：${destination}`, async () => {
    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    function Harness() {
      const [files, setFiles] = React.useState(['D:/Book/a.md', 'D:/Book/b.md', 'D:/Book/c.md']);
      const active = files.includes('D:/Book/b.md') ? 'D:/Book/b.md' : files[0];
      return (
        <>
          <input data-testid="new-author-draft" aria-label="新的作者草稿" />
          <EditorTabs
            openFiles={files}
            activeFile={active}
            previewFile={null}
            dirtyFiles={new Set(['D:/Book/b.md'])}
            activeTab="file"
            onFocusFile={noop}
            onFocusPreview={noop}
            onPinPreview={noop}
            onCloseFile={async (path) => {
              await closing;
              setFiles((current) => current.filter((file) => file !== path));
            }}
          />
        </>
      );
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Harness />));
      const tab = (path: string) =>
        [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (item) => item.dataset.tabPath === path,
        );
      const close = tab('D:/Book/b.md')?.parentElement?.querySelector<HTMLButtonElement>(
        '[data-testid="editor-tab-close"]',
      );
      assert.ok(close);
      await act(async () => {
        close.focus();
        close.click();
      });
      assert.ok(tab('D:/Book/b.md'), '确认/保存未完成时不能提前丢弃页签');
      const nextFocus =
        destination === 'author-input'
          ? container.querySelector<HTMLInputElement>('[data-testid="new-author-draft"]')
          : destination === 'another-tab'
            ? tab('D:/Book/c.md')
            : close;
      assert.ok(nextFocus);
      nextFocus.focus();
      await act(async () => {
        finishClose();
        await closing;
      });
      assert.equal(tab('D:/Book/b.md'), undefined);
      assert.equal(
        document.activeElement ===
          (destination === 'original-close' ? tab('D:/Book/a.md') : nextFocus),
        true,
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
