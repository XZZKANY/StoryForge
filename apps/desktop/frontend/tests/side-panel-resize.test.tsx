import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { test } from 'vitest';
import { SidePanel } from '../src/components/shell/SidePanel';
import {
  clampSidePanelWidth,
  defaultSidePanelWidth,
  draggedSidePanelWidth,
  resolveSidePanelWidth,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
} from '../src/lib/side-panel-width';
import { sanitizeAppSettings } from '../src/lib/user-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('没拖过的视图吃档位默认：作品/手稿/观测镜宽，资源管理器窄', () => {
  assert.equal(defaultSidePanelWidth('explorer'), 236);
  assert.equal(defaultSidePanelWidth('search'), 236);
  for (const view of ['book', 'manuscript', 'observatory']) {
    assert.ok(defaultSidePanelWidth(view) > 300, `${view} 应比改前的 300px 更宽`);
  }
});

test('宽度一律夹限——手改过的 localStorage 不该把面板撑成 0 或 5000', () => {
  assert.equal(clampSidePanelWidth(10), SIDE_PANEL_WIDTH_MIN);
  assert.equal(clampSidePanelWidth(5000), SIDE_PANEL_WIDTH_MAX);
  assert.equal(clampSidePanelWidth(320.4), 320);
  assert.equal(clampSidePanelWidth(Number.NaN), 236);

  assert.equal(resolveSidePanelWidth('book', { book: 9999 }), SIDE_PANEL_WIDTH_MAX);
  assert.equal(resolveSidePanelWidth('book', { book: 420 }), 420);
  // 没记过的视图不受别的视图影响
  assert.equal(resolveSidePanelWidth('explorer', { book: 420 }), 236);

  const restored = sanitizeAppSettings({ sidePanelWidths: { book: 9999, bad: 'x', explorer: 260 } });
  assert.deepEqual(restored.sidePanelWidths, { book: SIDE_PANEL_WIDTH_MAX, explorer: 260 });
});

test('拖拽宽度 = 起始宽 + 位移，两端夹住', () => {
  assert.equal(draggedSidePanelWidth(300, 60), 360);
  assert.equal(draggedSidePanelWidth(300, -60), 240);
  assert.equal(draggedSidePanelWidth(300, -9999), SIDE_PANEL_WIDTH_MIN);
  assert.equal(draggedSidePanelWidth(300, 9999), SIDE_PANEL_WIDTH_MAX);
});

function renderPanel(widths: Record<string, number>) {
  const calls: Array<[string, number]> = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <SidePanel
        view="book"
        widths={widths}
        onWidthChange={(view, width) => calls.push([view, width])}
        projects={[]}
        activeProject={null}
        currentFile={null}
        previewFile={null}
        projectRefreshVersion={0}
        onSelectProject={() => {}}
        onRemoveProject={() => {}}
        onOpenProject={() => {}}
        onNewFile={() => {}}
        onFileSelect={() => {}}
        onFilePreview={() => {}}
      />,
    );
  });
  const panel = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
  const handle = container.querySelector<HTMLElement>('[data-testid="side-panel-resize"]');
  assert.ok(panel && handle);
  return {
    panel,
    handle,
    calls,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('拖右缘把手改宽度，松手才落盘（拖拽中不写设置）', () => {
  const { panel, handle, calls, cleanup } = renderPanel({ book: 320 });
  try {
    assert.equal(panel.style.width, '320px');

    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 320, bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 420 }));
    });
    assert.equal(panel.style.width, '420px', '拖拽中宽度应跟手');
    assert.deepEqual(calls, [], '拖拽中不该逐帧写设置——会把 localStorage 刷爆');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 420 }));
    });
    assert.deepEqual(calls, [['book', 420]], '松手才落一次');
  } finally {
    cleanup();
  }
});

test('松手后不再跟随指针——监听必须摘干净', () => {
  const { panel, handle, calls, cleanup } = renderPanel({ book: 320 });
  try {
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 320, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 400 }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700 }));
    });
    assert.equal(panel.style.width, '320px', '松手后应回到已保存宽度，不再跟手');
    assert.deepEqual(calls, [['book', 400]]);
  } finally {
    cleanup();
  }
});

test('双击把手复位到该视图的档位默认', () => {
  const { handle, calls, cleanup } = renderPanel({ book: 700 });
  try {
    act(() => {
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    assert.deepEqual(calls, [['book', defaultSidePanelWidth('book')]]);
  } finally {
    cleanup();
  }
});
