import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';

import { emptyManifest } from '../src/lib/branches';
import { HISTORY_DRAWER_DEFAULT_WIDTH, historyDrawerWidth } from '../src/lib/workspace-layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/versions', () => ({
  listVersions: async () => [],
  readVersionState: async () => ({ exists: true, content: '' }),
}));

import { VersionHistory } from '../src/components/editor/VersionHistory';

test('版本记录抽屉平衡态与对话栏同宽，其余布局用默认宽', () => {
  expect(historyDrawerWidth('balanced', true, 518)).toBe(518);
  expect(historyDrawerWidth('balanced', false, 518)).toBe(HISTORY_DRAWER_DEFAULT_WIDTH);
  expect(historyDrawerWidth('editor', false, 0)).toBe(HISTORY_DRAWER_DEFAULT_WIDTH);
  expect(historyDrawerWidth('balanced', true, 0)).toBe(HISTORY_DRAWER_DEFAULT_WIDTH);
});

test('抽屉压在右栏位置、不在编辑区里盖正文；一开就接焦点，Esc 关掉并把焦点还回正文', () => {
  const editorStandIn = document.createElement('textarea');
  document.body.appendChild(editorStandIn);
  editorStandIn.focus();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const render = (open: boolean) =>
    act(() =>
      root.render(
        open ? (
          <VersionHistory
            projectPath="D:/Book"
            filePath="D:/Book/正文/第005章.md"
            manifest={emptyManifest()}
            onRestore={() => undefined}
            onCheckoutNode={() => undefined}
            onBranchFromNode={() => undefined}
            onSelectBranch={() => undefined}
            onClose={onClose}
          />
        ) : (
          <></>
        ),
      ),
    );
  try {
    render(true);
    const drawer = container.querySelector<HTMLElement>('[data-testid="version-history"]')!;
    expect(drawer.className).toContain('fixed');
    expect(drawer.className).not.toContain('absolute');
    expect(drawer.className).toContain('w-[var(--sf-history-drawer-width,360px)]');
    expect(document.activeElement).toBe(drawer);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => drawer.dispatchEvent(esc));
    expect(onClose).toHaveBeenCalledOnce();
    expect(esc.defaultPrevented).toBe(true);
    // 输入法组字时的 Esc 是取消组字，不关抽屉。
    act(() =>
      drawer.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
    render(false);
    expect(document.activeElement).toBe(editorStandIn);
  } finally {
    act(() => root.unmount());
    container.remove();
    editorStandIn.remove();
  }
});
