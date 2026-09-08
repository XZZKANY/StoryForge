import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorTabs } from '../src/components/shell/EditorTabs';

const noop = () => {};

const fileTabProps = {
  openFiles: ['D:/Book/a.md', 'D:/Book/b.md'],
  activeFile: 'D:/Book/a.md',
  previewFile: null,
  dirtyFiles: new Set<string>(),
  activeTab: 'file' as const,
  onFocusFile: noop,
  onFocusPreview: noop,
  onPinPreview: noop,
  onCloseFile: noop,
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

test('关闭页签后焦点跟随剩余页签，最后一个关闭后保留在页签区', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [files, setFiles] = React.useState(fileTabProps.openFiles);
    return (
      <EditorTabs
        {...fileTabProps}
        openFiles={files}
        activeFile={files.at(-1) ?? null}
        onCloseFile={(path) => setFiles((current) => current.filter((file) => file !== path))}
      />
    );
  }
  try {
    act(() => root.render(<Harness />));
    for (let remaining = 1; remaining >= 0; remaining -= 1) {
      const close = container.querySelector<HTMLButtonElement>(
        '[aria-label="关闭 b.md"], [aria-label="关闭 a.md"]',
      )!;
      close.focus();
      await act(async () => {
        close.click();
      });
      await nextFrame();
      assert.equal(container.querySelectorAll('[role="tab"]').length, remaining);
      assert.equal(
        document.activeElement,
        remaining
          ? container.querySelector('[role="tab"][aria-selected="true"]')
          : container.querySelector('[role="tablist"]'),
      );
    }
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

for (const movedOutside of [false, true]) {
  test(`异步关闭取消后${movedOutside ? '保留用户移到外部的焦点' : '恢复仍存在的关闭按钮'}`, async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    let resolveClose: (() => void) | undefined;
    try {
      act(() =>
        root.render(
          <EditorTabs
            {...fileTabProps}
            onCloseFile={() =>
              new Promise<void>((resolve) => {
                resolveClose = resolve;
              })
            }
          />,
        ),
      );
      const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭 a.md"]')!;
      close.focus();
      act(() => close.click());
      assert.ok(resolveClose);
      outside.focus();
      if (!movedOutside) outside.remove();
      await act(async () => resolveClose?.());
      await nextFrame();
      assert.equal(document.activeElement, movedOutside ? outside : close);
      assert.equal(container.querySelectorAll('[role="tab"]').length, 2);
    } finally {
      act(() => root.unmount());
      container.remove();
      outside.remove();
    }
  });
}

test('预览页签聚焦时 Ctrl+W 关闭预览，不会关闭后台固定页签', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let previewClosed = 0;
  let fileClosed = 0;
  try {
    act(() =>
      root.render(
        <EditorTabs
          {...fileTabProps}
          activeTab="preview"
          previewFile="D:/Book/preview.md"
          onClosePreview={() => {
            previewClosed += 1;
          }}
          onCloseFile={() => {
            fileClosed += 1;
          }}
        />,
      ),
    );
    const preview = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    preview.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'w',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      preview.dispatchEvent(event);
    });
    assert.equal(event.defaultPrevented, true);
    assert.equal(previewClosed, 1);
    assert.equal(fileClosed, 0);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('编辑器页签支持方向键循环与 Home/End 定位', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    function Harness() {
      const [activeFile, setActiveFile] = React.useState(fileTabProps.activeFile);
      return <EditorTabs {...fileTabProps} activeFile={activeFile} onFocusFile={setActiveFile} />;
    }
    act(() => root.render(<Harness />));
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs[0]?.focus();
    act(() =>
      tabs[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(document.activeElement, tabs[1]);
    assert.equal(tabs[1]?.getAttribute('aria-selected'), 'true');
    act(() =>
      tabs[1]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(document.activeElement, tabs[0]);
    assert.equal(tabs[0]?.getAttribute('aria-selected'), 'true');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('编辑器工具菜单不混入页签 tablist 语义范围', () => {
  const html = renderToStaticMarkup(
    <EditorTabs
      {...fileTabProps}
      onPolishActive={() => undefined}
      onSaveActive={noop}
      onToggleHistory={noop}
      onExportActive={noop}
      onCloseOthers={noop}
      onCloseAll={noop}
    />,
  );
  assert.match(html, /role="tablist"[^>]*data-testid="editor-tab-scroll"/);
  const host = document.createElement('div');
  host.innerHTML = html;
  const tablist = host.querySelector('[role="tablist"]');
  assert.ok(tablist);
  assert.equal(tablist.querySelector('[data-testid="editor-more-btn"]'), null);
});

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
  assert.equal((html.match(/aria-controls="editor-panel"/g) ?? []).length, 2);
});

test('页签关闭按钮保留 Enter 和空格的原生按钮行为', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let activated = 0;
  try {
    act(() =>
      root.render(
        <EditorTabs
          {...fileTabProps}
          onFocusFile={() => {
            activated += 1;
          }}
        />,
      ),
    );
    const tab = container.querySelector<HTMLElement>('[role="tab"]');
    const close = container.querySelector('[aria-label="关闭 a.md"]');
    assert.ok(tab);
    assert.ok(close);
    assert.equal(close.getAttribute('type'), 'button');
    assert.equal(close.getAttribute('aria-label'), '关闭 a.md');
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => {
        close.dispatchEvent(event);
      });
      assert.equal(event.defaultPrevented, false, '关闭按钮的默认激活不能被父页签取消');
    }
    assert.equal(activated, 0);
    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(activated, 1, '页签本身仍可通过 Enter 激活');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('非活动页签的关闭图标在键盘焦点下保持可见', () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorTabs, {
      ...fileTabProps,
      openFiles: ['D:/Book/a.md', 'D:/Book/b.md', 'D:/Book/c.md'],
      activeFile: 'D:/Book/a.md',
      dirtyFiles: new Set(['D:/Book/b.md']),
      activeTab: 'file',
    }),
  );
  assert.match(html, /group-focus-within:block/);
  assert.match(html, /group-focus-within:opacity-100/);
});

test('页签关闭控件与 role=tab 分离，并只让活动页签的关闭控件进入 Tab 顺序', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<EditorTabs {...fileTabProps} />));
    const activeTab = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const inactiveTab = container.querySelector<HTMLElement>('[role="tab"][aria-selected="false"]');
    const activeClose = container.querySelector<HTMLButtonElement>('[aria-label="关闭 a.md"]');
    const inactiveClose = container.querySelector<HTMLButtonElement>('[aria-label="关闭 b.md"]');
    assert.ok(activeTab && inactiveTab && activeClose && inactiveClose);
    assert.equal(activeTab.contains(activeClose), false);
    assert.equal(inactiveTab.contains(inactiveClose), false);
    assert.equal(activeClose.tabIndex, 0);
    assert.equal(inactiveClose.tabIndex, -1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('右键关闭其他保留右键目标，文件操作菜单保留当前页签', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const kept: Array<string | undefined> = [];
  try {
    act(() =>
      root.render(
        <EditorTabs
          {...fileTabProps}
          onCloseOthers={(path?: string) => {
            kept.push(path);
          }}
        />,
      ),
    );
    const tabs = container.querySelectorAll('[role="tab"]');
    await act(async () => {
      tabs[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    const closeOthers = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent === '关闭其他',
    );
    assert.ok(closeOthers);
    act(() => closeOthers.click());
    assert.deepEqual(kept, ['D:/Book/b.md']);
    assert.equal(
      document.activeElement,
      tabs[1],
      '右键菜单动作完成后，焦点应回到实际打开菜单的页签',
    );
    const more = container.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]');
    assert.ok(more);
    act(() => more.click());
    const closeOthersCurrent = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '关闭其他页签',
    );
    assert.ok(closeOthersCurrent);
    act(() => closeOthersCurrent.click());
    assert.deepEqual(kept, ['D:/Book/b.md', undefined]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
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
    const closeButton = container.querySelector<HTMLButtonElement>('[aria-label="关闭 c.md"]');
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
  assert.match(withFile, /aria-label="文件操作"/);

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

test('版本历史外部焦点 ref 指向文件操作入口', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const historyTriggerRef = React.createRef<HTMLButtonElement>();
  try {
    act(() =>
      root.render(
        <EditorTabs
          {...fileTabProps}
          historyTriggerRef={historyTriggerRef}
          onToggleHistory={noop}
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]');
    assert.ok(trigger);
    assert.equal(
      historyTriggerRef.current,
      trigger,
      'EditorTabs 必须把外部 historyTriggerRef 绑定到文件操作按钮',
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
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
    const dedicated = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '使用专用润色模型',
    );
    assert.ok(dedicated);
    act(() => dedicated.click());

    act(() => trigger.click());
    const main = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
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
