import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { StoryNavigator } from '../src/components/StoryNavigator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('故事导航页签支持方向键与 Home/End 导航', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <StoryNavigator projectPath={null} currentFile={null} onFileSelect={() => undefined} />,
      ),
    );
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    assert.equal(tabs.length, 2);
    const activeTab = tabs[0];
    const panelId = activeTab?.getAttribute('aria-controls');
    assert.ok(panelId);
    assert.equal(tabs[1]?.getAttribute('aria-controls'), panelId);
    assert.equal(
      container.querySelector(`[role="tabpanel"]#${panelId}`)?.getAttribute('aria-labelledby'),
      activeTab?.id,
    );
    tabs[0]?.focus();
    act(() =>
      tabs[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
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
