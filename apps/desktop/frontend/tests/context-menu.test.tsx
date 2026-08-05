import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { ContextMenu } from '../src/components/shell/ContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

test('右键菜单背景使用 Tailwind 可生成的 92% 任意透明度类', () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <ContextMenu
        x={10}
        y={20}
        items={[{ label: '打开', onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
  });

  const menu = container.querySelector('[data-testid="context-menu"]');
  assert.ok(menu);
  assert.equal(menu.classList.contains('bg-surface/[0.92]'), true);
  assert.equal(menu.classList.contains('bg-surface/92'), false);
});
