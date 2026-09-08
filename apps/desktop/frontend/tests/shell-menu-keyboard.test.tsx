import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';
import { SidePanel } from '../src/components/shell/SidePanel';
import { ConversationHeader } from '../src/components/chat-window/panels';

vi.mock('../src/components/StoryNavigator', () => ({ StoryNavigator: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function press(key: string) {
  act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    ),
  );
}

test('最近项目菜单能导航到移除操作，删除后焦点接续且菜单保持可用', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const selected: string[] = [];
  function Harness() {
    const [projects, setProjects] = useState(['fixture/one', 'fixture/two', 'fixture/three']);
    return (
      <SidePanel
        view="explorer"
        projects={projects}
        activeProject="fixture/one"
        currentFile={null}
        previewFile={null}
        projectRefreshVersion={0}
        widths={{}}
        onWidthChange={() => {}}
        onSelectProject={(path) => {
          selected.push(path);
        }}
        onRemoveProject={(path) =>
          setProjects((current) => current.filter((project) => project !== path))
        }
        onOpenProject={() => {}}
        onNewFile={() => {}}
        onFileSelect={() => {}}
        onFilePreview={() => {}}
      />
    );
  }
  try {
    act(() => root.render(<Harness />));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-project-library"]',
    )!;
    trigger.focus();
    act(() => trigger.click());
    assert.equal(document.activeElement?.getAttribute('title'), 'fixture/one');
    assert.equal(
      container.querySelector('[role="menu"]')?.querySelectorAll('[role="separator"]').length,
      1,
    );
    press('ArrowDown');
    assert.equal(document.activeElement?.getAttribute('title'), 'fixture/two');
    press('ArrowDown');
    const remove = document.activeElement as HTMLButtonElement;
    assert.equal(remove.getAttribute('aria-label'), '从最近打开移除 two');
    await act(async () => remove.click());
    assert.equal(remove.isConnected, false);
    assert.equal(document.activeElement?.getAttribute('title'), 'fixture/three');
    assert.ok(container.querySelector('[role="menu"]'));
    act(() => (document.activeElement as HTMLButtonElement).click());
    assert.deepEqual(selected, ['fixture/three']);
    assert.equal(document.activeElement, trigger);
    assert.equal(container.querySelector('[role="menu"]'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('会话菜单空态聚焦新建，执行后关闭并恢复会话入口', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let created = 0;
  try {
    act(() =>
      root.render(
        <ConversationHeader
          title="会话"
          sessions={[]}
          onNewSession={() => {
            created += 1;
          }}
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="conversation-session-switch"]',
    )!;
    trigger.focus();
    act(() => trigger.click());
    assert.equal(document.activeElement?.getAttribute('role'), 'menuitem');
    assert.equal(document.activeElement?.textContent?.trim(), '新建会话');
    act(() => (document.activeElement as HTMLButtonElement).click());
    assert.equal(created, 1);
    assert.equal(container.querySelector('[role="menu"]'), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
