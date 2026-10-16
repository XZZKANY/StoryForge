import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { useWorkspaceColumns } from '../src/components/shell/useWorkspaceColumns';
import {
  resolveWorkspaceColumns,
  widthToRatio,
  WORKSPACE_PRIMARY_COMFORT_WIDTH,
} from '../src/lib/workspace-layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

const DEFAULTS = { sideRatio: null, assistantRatio: null };
const primary = (viewport: number, side: number, assistant: number) =>
  viewport - 48 - side - assistant;

test('没拖过时三栏按窗口宽成比例变化：1400 / 1920 / 2560 各不相同', () => {
  expect(resolveWorkspaceColumns(1400, 'balanced', true, DEFAULTS)).toEqual({
    side: 224,
    assistant: 378,
    sideMax: 414,
    assistantMax: 568,
  });
  const wide = resolveWorkspaceColumns(1920, 'balanced', true, DEFAULTS);
  expect([wide.side, wide.assistant]).toEqual([307, 518]);
  // 大屏上默认比例算出的宽度封顶：文件树 360、对话栏 640，剩下的给编辑区。
  const huge = resolveWorkspaceColumns(2560, 'balanced', true, DEFAULTS);
  expect([huge.side, huge.assistant]).toEqual([360, 640]);
  expect(primary(2560, huge.side, huge.assistant)).toBe(1512);
});

test('作者拖出的比例在别的窗口宽下照比例换算，不再是死像素', () => {
  const prefs = { sideRatio: widthToRatio(220, 1400), assistantRatio: null };
  expect(prefs.sideRatio).toBe(0.1571);
  expect(resolveWorkspaceColumns(1400, 'balanced', true, prefs).side).toBe(220);
  // 作者自己拖的比例不受默认封顶限制，只受硬上限与编辑区保底约束。
  expect(resolveWorkspaceColumns(2560, 'balanced', true, prefs).side).toBe(402);
});

test('编辑区保底：对话栏拖得太宽时先收对话栏，编辑区不低于保底宽', () => {
  const columns = resolveWorkspaceColumns(1400, 'balanced', true, {
    sideRatio: null,
    assistantRatio: 0.5,
  });
  expect(columns.assistant).toBe(568);
  expect(primary(1400, columns.side, columns.assistant)).toBe(WORKSPACE_PRIMARY_COMFORT_WIDTH);
});

test('窗口窄到两栏都在下限时只收到下限为止，编辑区拿剩下的', () => {
  const columns = resolveWorkspaceColumns(1100, 'balanced', true, DEFAULTS);
  expect([columns.side, columns.assistant]).toEqual([220, 320]);
  expect(primary(1100, columns.side, columns.assistant)).toBe(512);
  expect([columns.sideMax, columns.assistantMax]).toEqual([220, 320]);
});

test('编辑聚焦没有对话栏；对话聚焦时主区就是对话，侧栏只守对话的硬下限', () => {
  expect(resolveWorkspaceColumns(1400, 'editor', true, DEFAULTS)).toMatchObject({
    side: 224,
    assistant: 0,
    sideMax: 792,
  });
  expect(resolveWorkspaceColumns(1400, 'chat', true, DEFAULTS)).toMatchObject({
    side: 224,
    assistant: 0,
    sideMax: 800,
  });
});

test('侧栏收起时侧栏为 0，对话栏能拖到的上限随之变宽', () => {
  expect(resolveWorkspaceColumns(1400, 'balanced', false, DEFAULTS)).toEqual({
    side: 0,
    assistant: 378,
    sideMax: 414,
    assistantMax: 792,
  });
});

test('宽度换比例：窗口宽未知或非法时不记', () => {
  expect(widthToRatio(378, 1400)).toBe(0.27);
  expect(widthToRatio(300, 0)).toBeNull();
  expect(widthToRatio(Number.NaN, 1400)).toBeNull();
});

test('窗口 resize 时显示宽度实时换算，比例偏好本身不变', () => {
  let width = 1400;
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => width);
  const prefs = { sideRatio: 0.2, assistantRatio: 0.3 };
  function Harness() {
    const { columns } = useWorkspaceColumns('balanced', true, prefs);
    return <output>{columns ? `${columns.side}/${columns.assistant}` : 'none'}</output>;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<Harness />));
    expect(container.textContent).toBe('280/420');
    act(() => {
      width = 2000;
      window.dispatchEvent(new Event('resize'));
    });
    expect(container.textContent).toBe('400/600');
    expect(prefs).toEqual({ sideRatio: 0.2, assistantRatio: 0.3 });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
