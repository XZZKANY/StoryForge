import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { test } from 'vitest';
import { SidePanel } from '../src/components/shell/SidePanel';
import type { SidePanelView } from '../src/components/shell/useShellState';
import {
  clampSidePanelWidth,
  draggedSidePanelWidth,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
} from '../src/lib/side-panel-width';
import {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  LEGACY_SIDE_PANEL_REFERENCE_VIEWPORT,
  loadAppSettings,
  sanitizeAppSettings,
  saveAppSettings,
} from '../src/lib/user-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ALL_VIEWS: SidePanelView[] = [
  'book',
  'manuscript',
  'explorer',
  'knowledge',
  'search',
  'observatory',
];

test('全左栏共享一份宽度默认 300，与视图无关（不再有 260/340 两档）', () => {
  assert.equal(SIDE_PANEL_WIDTH_DEFAULT, 300);
  assert.ok(SIDE_PANEL_WIDTH_MIN < SIDE_PANEL_WIDTH_DEFAULT);
  assert.ok(SIDE_PANEL_WIDTH_DEFAULT < SIDE_PANEL_WIDTH_MAX);
});

test('宽度一律夹限——手改过的 localStorage 不该把面板撑成 0 或 5000', () => {
  assert.equal(clampSidePanelWidth(10), SIDE_PANEL_WIDTH_MIN);
  assert.equal(clampSidePanelWidth(5000), SIDE_PANEL_WIDTH_MAX);
  assert.equal(clampSidePanelWidth(320.4), 320);
  assert.equal(clampSidePanelWidth(Number.NaN), SIDE_PANEL_WIDTH_DEFAULT);
});

const ratioOf = (value: Record<string, unknown>) => sanitizeAppSettings(value).sidePanelRatio;

test('旧像素宽迁成比例：按出厂窗口宽 1400 换算，出厂 300 视为没拖过', () => {
  assert.equal(LEGACY_SIDE_PANEL_REFERENCE_VIEWPORT, 1400);
  assert.equal(ratioOf({}), null);
  assert.equal(ratioOf({ sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT }), null);
  // 作者装机版里存的就是 220（拖到了最窄）：在出厂 1400 窗口里换算回来仍是 220。
  assert.equal(ratioOf({ sidePanelWidth: 220 }), 0.1571);
  assert.equal(ratioOf({ sidePanelWidth: 4000 }), 0.5714, '先按旧上下限夹成 800 再换算');
  assert.equal(ratioOf({ sidePanelWidth: 'wide' }), null);
  assert.equal(sanitizeAppSettings({}).assistantPanelRatio, null);
});

test('旧按视图 sidePanelWidths 仍按原确定性规则选出一个宽度，再换成比例', () => {
  assert.equal(ratioOf({ sidePanelWidths: {} }), null);
  assert.equal(ratioOf({ sidePanelWidths: { book: 420 } }), 0.3);
  assert.equal(ratioOf({ sidePanelWidths: { book: 288, explorer: 288 } }), 0.2057);
  // 存在 >300 的加宽信号 → 取最大（加宽是当初分视图记录的动机）
  assert.equal(ratioOf({ sidePanelWidths: { book: 420, explorer: 240 } }), 0.3);
  assert.equal(ratioOf({ sidePanelWidths: { book: 340, manuscript: 380 } }), 0.2714);
  // 全部 ≤300 → 取最大；恰好选出出厂 300 的视为没拖过
  assert.equal(ratioOf({ sidePanelWidths: { explorer: 230, search: 260 } }), 0.1857);
  assert.equal(ratioOf({ sidePanelWidths: { book: 300, explorer: 240 } }), null);
  // 与 key 名无关；异常值丢弃、超界夹限
  assert.equal(ratioOf({ sidePanelWidths: { 旧视图名: 460 } }), 0.3286);
  assert.equal(ratioOf({ sidePanelWidths: { book: 9999 } }), 0.5714);
  assert.equal(ratioOf({ sidePanelWidths: { explorer: 5 } }), 0.1571);
  assert.equal(ratioOf({ sidePanelWidths: { book: '宽', explorer: Number.NaN } }), null);
  assert.equal(ratioOf({ sidePanelWidths: '手改坏了' }), null);
  // 共享像素字段无效时仍走旧 map
  assert.equal(ratioOf({ sidePanelWidth: Number.NaN, sidePanelWidths: { book: 410 } }), 0.2929);
});

test('比例字段一旦存在就优先于一切旧字段；localStorage 往返一次后旧 key 落盘消失', () => {
  assert.equal(
    ratioOf({ sidePanelRatio: 0.2, sidePanelWidth: 276, sidePanelWidths: { book: 999 } }),
    0.2,
  );
  // 新字段为 null（作者点过复位）时也不回头读旧像素
  assert.equal(ratioOf({ sidePanelRatio: null, sidePanelWidth: 420 }), null);
  for (const bad of [0, 1, -0.1, 1.5, Number.NaN, '0.2']) {
    assert.equal(ratioOf({ sidePanelRatio: bad }), null, `非法比例 ${String(bad)}`);
    assert.equal(sanitizeAppSettings({ assistantPanelRatio: bad }).assistantPanelRatio, null);
  }
  assert.equal(sanitizeAppSettings({ assistantPanelRatio: 0.3 }).assistantPanelRatio, 0.3);

  const legacy: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
  delete legacy.sidePanelRatio;
  delete legacy.assistantPanelRatio;
  legacy.sidePanelWidths = { book: 340, manuscript: 380 };
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(legacy));
  try {
    const loaded = loadAppSettings();
    assert.equal(loaded.sidePanelRatio, 0.2714, '加载即迁移');
    saveAppSettings(loaded);
    const persisted = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)!) as Record<
      string,
      unknown
    >;
    assert.equal(persisted.sidePanelRatio, 0.2714);
    assert.equal('sidePanelWidths' in persisted, false, '旧 key 下次保存后落盘消失');
    assert.equal('sidePanelWidth' in persisted, false);
    // 再加载稳定在同值：迁移只发生一次，不会反复横跳
    assert.equal(loadAppSettings().sidePanelRatio, 0.2714);
  } finally {
    localStorage.removeItem(APP_SETTINGS_KEY);
  }
});

test('拖拽宽度 = 起始宽 + 位移，两端夹住', () => {
  assert.equal(draggedSidePanelWidth(300, 60), 360);
  assert.equal(draggedSidePanelWidth(300, -60), 240);
  assert.equal(draggedSidePanelWidth(300, -9999), SIDE_PANEL_WIDTH_MIN);
  assert.equal(draggedSidePanelWidth(300, 9999), SIDE_PANEL_WIDTH_MAX);
});

const BASE_PROPS = {
  projects: [],
  activeProject: null,
  currentFile: null,
  previewFile: null,
  projectRefreshVersion: 0,
  onSelectProject: () => {},
  onRemoveProject: () => {},
  onOpenProject: () => {},
  onNewFile: () => {},
  onFileSelect: () => {},
  onFilePreview: () => {},
};

function renderPanel(savedWidth: number, maxWidth?: number) {
  const calls: number[] = [];
  const resets = { count: 0 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = (limit = maxWidth) =>
    act(() => {
      root.render(
        <SidePanel
          view="book"
          width={savedWidth}
          maxWidth={limit}
          onWidthChange={(next) => calls.push(next)}
          onWidthReset={() => {
            resets.count += 1;
          }}
          {...BASE_PROPS}
        />,
      );
    });
  render();
  const panel = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
  const handle = container.querySelector<HTMLElement>('[data-testid="side-panel-resize"]');
  assert.ok(panel && handle);
  return {
    panel,
    handle,
    calls,
    resets,
    render,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function renderSwitchHarness(initialWidth = SIDE_PANEL_WIDTH_DEFAULT) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const state = { view: 'book' as SidePanelView, width: initialWidth };
  const render = () =>
    act(() => {
      root.render(
        <SidePanel
          {...BASE_PROPS}
          view={state.view}
          width={state.width}
          onWidthChange={(next) => {
            state.width = next;
          }}
          onWidthReset={() => {
            state.width = SIDE_PANEL_WIDTH_DEFAULT;
          }}
          book={<textarea data-testid="book-draft" />}
        />,
      );
    });
  render();
  const panel = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
  const handle = container.querySelector<HTMLElement>('[data-testid="side-panel-resize"]');
  assert.ok(panel && handle);
  return {
    container,
    panel,
    handle,
    state,
    render,
    switchView: (view: SidePanelView) => {
      state.view = view;
      render();
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('组件级：连续切换六个视图只换内容，侧栏右边界不动', () => {
  const { panel, handle, state, switchView, cleanup } = renderSwitchHarness();
  try {
    for (const view of ALL_VIEWS) {
      switchView(view);
      assert.equal(panel.getAttribute('data-side-view'), view);
      assert.equal(panel.style.width, '300px', `切到 ${view} 不应改变侧栏宽度`);
      assert.equal(handle.getAttribute('aria-valuenow'), '300');
    }
  } finally {
    cleanup();
  }
  assert.equal(state.width, SIDE_PANEL_WIDTH_DEFAULT);
});

test('组件级：拖过/键盘调过的宽度在切换视图后保持一致', () => {
  const { panel, handle, state, switchView, render, cleanup } = renderSwitchHarness();
  try {
    // 在手稿视图键盘加宽一档（Shift 加速 50px）
    state.view = 'manuscript';
    render();
    act(() =>
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      ),
    );
    assert.equal(state.width, 350);
    for (const view of ALL_VIEWS) {
      switchView(view);
      assert.equal(panel.style.width, '350px', `调到 350 后切到 ${view} 仍 350`);
    }

    // 在观测镜视图拖把手到 380，再全视图巡查
    switchView('observatory');
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 350, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 380 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 380 }));
    });
    assert.equal(state.width, 380);
    for (const view of ALL_VIEWS) {
      switchView(view);
      assert.equal(panel.style.width, '380px', `拖到 380 后切到 ${view} 仍 380`);
      assert.equal(handle.getAttribute('aria-valuenow'), '380');
    }

    // 复位后回到共享默认，且对所有视图生效
    act(() => handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    assert.equal(state.width, SIDE_PANEL_WIDTH_DEFAULT);
    for (const view of ALL_VIEWS) {
      switchView(view);
      assert.equal(panel.style.width, '300px', `复位后切到 ${view} 应为默认 300`);
    }
  } finally {
    cleanup();
  }
});

test('组件级：切换视图不卸载 pane，输入草稿与节点身份保留', () => {
  const { container, switchView, cleanup } = renderSwitchHarness();
  try {
    const draft = container.querySelector<HTMLTextAreaElement>('[data-testid="book-draft"]')!;
    act(() => {
      draft.value = '未提交的简介草稿';
      draft.dispatchEvent(new Event('input', { bubbles: true }));
    });
    switchView('search');
    assert.equal(container.querySelector('[data-testid="book-draft"]'), draft, '同一 DOM 节点');
    switchView('book');
    const restored = container.querySelector<HTMLTextAreaElement>('[data-testid="book-draft"]')!;
    assert.equal(restored, draft, '切回后仍是同一节点，滚动位置等 DOM 状态随之保留');
    assert.equal(restored.value, '未提交的简介草稿');
  } finally {
    cleanup();
  }
});

test('窗口临时收窄不改偏好，变宽后恢复；调宽语义报告显示值', () => {
  const { panel, handle, calls, render, cleanup } = renderPanel(420, 236);
  try {
    assert.equal(panel.style.width, '236px');
    assert.equal(handle.getAttribute('aria-valuenow'), '236');
    assert.equal(handle.getAttribute('aria-valuemax'), '236');
    render(720);
    assert.equal(panel.style.width, '420px');
    assert.equal(handle.getAttribute('aria-valuenow'), '420');
    assert.deepEqual(calls, [], '收窄/恢复窗口本身不得写偏好');
  } finally {
    cleanup();
  }
});

test('窄窗口从显示宽度开始拖拽和键盘调整，不从较大的偏好宽度跳跃', () => {
  const { panel, handle, calls, resets, cleanup } = renderPanel(420, 236);
  try {
    act(() =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    );
    assert.deepEqual(calls.pop(), 226);
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 220 }));
    });
    assert.equal(panel.style.width, '220px');
    assert.deepEqual(calls, []);
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 220 })));
    assert.deepEqual(calls.pop(), 220);
    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    assert.deepEqual(calls.pop(), 236);
    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(resets.count, 1, 'Enter 复位走复位回调（回到默认比例），不写一个像素宽');
    assert.deepEqual(calls, []);
  } finally {
    cleanup();
  }
});

test('取消拖拽或在松手前卸载，不提交偏好也不留下全局拖拽监听', () => {
  const first = renderPanel(420, 236);
  act(() => {
    first.handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 210 }));
    window.dispatchEvent(new PointerEvent('pointercancel'));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 210 }));
  });
  assert.equal(first.panel.style.width, '236px');
  assert.deepEqual(first.calls, []);
  first.cleanup();

  const second = renderPanel(420, 236);
  act(() =>
    second.handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true })),
  );
  second.cleanup();
  act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 210 })));
  assert.deepEqual(second.calls, []);
});

test('拖右缘把手改宽度，松手才落盘（拖拽中不写设置）', () => {
  const { panel, handle, calls, cleanup } = renderPanel(320);
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
    assert.deepEqual(calls, [420], '松手才落一次');
  } finally {
    cleanup();
  }
});

test('松手后不再跟随指针——监听必须摘干净', () => {
  const { panel, handle, calls, cleanup } = renderPanel(320);
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
    assert.deepEqual(calls, [400]);
  } finally {
    cleanup();
  }
});

test('双击把手复位到默认比例', () => {
  const { handle, calls, resets, cleanup } = renderPanel(700);
  try {
    act(() => {
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    assert.equal(resets.count, 1);
    assert.deepEqual(calls, []);
  } finally {
    cleanup();
  }
});

test('侧栏分隔器可通过键盘调整、夹限与复位，提供名称和当前范围', () => {
  const { panel, handle, calls, resets, cleanup } = renderPanel(320);
  try {
    assert.equal(handle.getAttribute('role'), 'separator');
    assert.equal(handle.tabIndex, 0);
    assert.equal(handle.getAttribute('aria-label'), '调整侧栏宽度');
    assert.equal(handle.getAttribute('aria-orientation'), 'vertical');
    assert.equal(handle.getAttribute('aria-controls'), panel.id);
    assert.equal(handle.getAttribute('aria-valuemin'), String(SIDE_PANEL_WIDTH_MIN));
    assert.equal(handle.getAttribute('aria-valuemax'), String(SIDE_PANEL_WIDTH_MAX));
    assert.equal(handle.getAttribute('aria-valuenow'), '320');
    for (const [key, shiftKey, expected] of [
      ['ArrowLeft', false, 310],
      ['ArrowRight', false, 330],
      ['ArrowRight', true, 370],
      ['Home', false, SIDE_PANEL_WIDTH_MIN],
      ['End', false, SIDE_PANEL_WIDTH_MAX],
    ] as const) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      act(() => handle.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(calls.at(-1), expected);
    }
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => handle.dispatchEvent(enter));
    assert.equal(enter.defaultPrevented, true);
    assert.equal(resets.count, 1);
    const before = calls.length;
    for (const options of [
      { key: 'Tab' },
      { key: 'ArrowRight', ctrlKey: true },
      { key: 'ArrowLeft', metaKey: true },
      { key: 'Home', altKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
      act(() => handle.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false);
    }
    assert.equal(calls.length, before);
  } finally {
    cleanup();
  }
});

test('侧栏分隔器的方向键及加速调整不会超过现有宽度边界', () => {
  for (const [width, key] of [
    [SIDE_PANEL_WIDTH_MAX, 'ArrowRight'],
    [SIDE_PANEL_WIDTH_MIN, 'ArrowLeft'],
  ] as const) {
    const { handle, calls, cleanup } = renderPanel(width);
    try {
      for (const shiftKey of [false, true]) {
        act(() =>
          handle.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })),
        );
      }
      assert.deepEqual(calls, [width, width]);
    } finally {
      cleanup();
    }
  }
});

test('无常驻线的调宽热区在按下即进入活动态，松手释放且仅提交一次', () => {
  const { panel, handle, calls, cleanup } = renderPanel(420, 236);
  try {
    assert.equal(handle.classList.contains('sf-panel-resize'), true);
    assert.equal(
      handle.classList.contains('w-[7px]'),
      true,
      '去线后命中区扩到 7px，不改变视觉主线',
    );
    assert.equal(handle.getAttribute('data-resizing'), 'false');
    act(() =>
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true })),
    );
    assert.equal(handle.getAttribute('data-resizing'), 'true', '尚未移动也要有拖动反馈');
    assert.equal(panel.style.width, '236px', '按下不能跳回较大的保存宽度');
    assert.deepEqual(calls, []);
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 226 })));
    assert.equal(handle.getAttribute('data-resizing'), 'true');
    assert.equal(handle.getAttribute('aria-valuenow'), '226');
    assert.equal(handle.getAttribute('aria-valuetext'), '226 像素');
    assert.deepEqual(calls, []);
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 226 })));
    assert.equal(handle.getAttribute('data-resizing'), 'false');
    assert.deepEqual(calls, [226]);
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 230 })));
    assert.deepEqual(calls, [226], '已释放的全局监听不再提交');
  } finally {
    cleanup();
  }
});

test('取消拖动清除活动态并回到显示宽度，非主键不启动拖动', () => {
  const { panel, handle, calls, cleanup } = renderPanel(320);
  try {
    act(() =>
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 2, clientX: 320, bubbles: true }),
      ),
    );
    assert.equal(handle.getAttribute('data-resizing'), 'false');
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 })));
    assert.equal(panel.style.width, '320px');
    act(() =>
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 320, bubbles: true })),
    );
    assert.equal(handle.getAttribute('data-resizing'), 'true');
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 })));
    assert.equal(panel.style.width, '400px');
    act(() => window.dispatchEvent(new PointerEvent('pointercancel')));
    assert.equal(handle.getAttribute('data-resizing'), 'false');
    assert.equal(panel.style.width, '320px');
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 500 }));
    });
    assert.equal(panel.style.width, '320px');
    assert.deepEqual(calls, []);
  } finally {
    cleanup();
  }
});
