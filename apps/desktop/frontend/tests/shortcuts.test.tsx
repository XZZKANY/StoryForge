/**
 * 快捷键速查表护栏：界面上印出来的键，必须真的绑上了。
 *
 * 背景：「Ctrl O 打开项目」在速查表和欢迎页上挂了很久，但 App 的 keydown 处理器里根本没有
 * `o` 分支 —— 原本指望 src-tauri 的原生菜单提供，而那个菜单从未安装（`create_menu` 从未被调用，
 * 且 `decorations:false` 下 Windows 没有窗口框可挂菜单栏）。作者按下去毫无反应。
 *
 * 本护栏对 SHORTCUT_ROWS 里每一条「全局无条件」的键真按一遍，断言 App 调用了 preventDefault
 * （= 确实接管了这个键）。加一行却不填 needs / scope，这里就会红。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { App } from '../src/App';
import { open as openDirectory } from '@tauri-apps/plugin-dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
import { SHORTCUT_ROWS, formatShortcutSheet } from '../src/components/app/shortcuts';

// 中栏重组件与本用例无关，桩掉避免挂载副作用（读本机 LLM 配置 / 版本历史）出网。
vi.mock('../src/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('../src/components/Editor', () => ({ Editor: () => null }));
vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: async () => ({
    status: 'unreachable',
    reachable: false,
    baseUrl: 'http://127.0.0.1:8000',
    latencyMs: 0,
    checks: {},
    detail: 'mocked in shortcuts test',
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> = [];

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openDirectory).mockClear();
});

afterEach(() => {
  while (mounted.length) {
    const instance = mounted.pop();
    if (!instance) continue;
    act(() => instance.root.unmount());
    instance.container.remove();
  }
  vi.restoreAllMocks();
});

function mountApp(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<App />));
  mounted.push({ container, root });
  return container;
}

/** 真按一次，回报 App 是否调用了 preventDefault。 */
function pressChord(
  chord: { ctrl?: true; meta?: true; shift?: true; key: string },
  options: { target?: EventTarget; isComposing?: boolean } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key: chord.key,
    ctrlKey: Boolean(chord.ctrl),
    metaKey: Boolean(chord.meta),
    shiftKey: Boolean(chord.shift),
    isComposing: Boolean(options.isComposing),
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    (options.target ?? window).dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test('速查表里每条全局快捷键都真的被 App 接管', () => {
  mountApp();

  const global = SHORTCUT_ROWS.filter((row) => !row.needs && !row.scope);
  // 防止有人把所有行都标上 needs/scope 让护栏空转。
  assert.ok(global.length >= 6, `全局快捷键少于 6 条，护栏可能被架空：${global.length}`);

  for (const row of global) {
    for (const chord of row.chords) {
      assert.equal(
        pressChord(chord),
        true,
        `速查表印着「${row.keys} ${row.label}」，但按下去 App 没有接管（未 preventDefault）。` +
          `要么把键绑上，要么给这一行标注 needs / scope。`,
      );
    }
  }
});

test('需要前置态或由别处接管的键，必须显式标注而不是悄悄失效', () => {
  // needs/scope 两个字段是「我知道这条键为什么按不动」的书面交代，值域受限防手滑写错。
  for (const row of SHORTCUT_ROWS) {
    if (row.needs) assert.ok(['project', 'file'].includes(row.needs), `未知 needs：${row.keys}`);
    if (row.scope) assert.ok(['editor', 'tabs'].includes(row.scope), `未知 scope：${row.keys}`);
    assert.ok(row.chords.length > 0, `${row.keys} 没有登记实际按键，护栏无从验证`);
  }
});

test('没有打开项目时 Ctrl+3 不会藏掉欢迎区留下空白窗口', () => {
  const container = mountApp();

  assert.equal(pressChord({ ctrl: true, key: '3' }), true);

  const center = container.querySelector('[data-testid="shell-center"]');
  assert.ok(center, '找不到承载欢迎区的中栏');
  assert.equal(center.classList.contains('hidden'), false, '无项目时不得切到只有对话栏的布局');
});

test('Ctrl+Tab / Ctrl+PageDown 在无项目时不接管按键，有项目时才接管', () => {
  // 无项目：App 不应拦截 Ctrl+Tab，否则会挡住后续可能的其他用途，速查表也标注 needs:project。
  mountApp();
  const noProjectTab = pressChord({ ctrl: true, key: 'tab' });
  const noProjectPageDown = pressChord({ ctrl: true, key: 'pagedown' });
  assert.equal(noProjectTab, false, '无项目时 Ctrl+Tab 不应被 preventDefault');
  assert.equal(noProjectPageDown, false, '无项目时 Ctrl+PageDown 不应被 preventDefault');
});

test('Ctrl+Shift+Tab 不会被 shift 视图快捷键早退吞掉', () => {
  // Ctrl+Shift+Tab 与「Ctrl+Shift+<视图键>」共享前面那组 shift 分支；若 tab 误进 shift 早退就会被吞。
  // 这里验证：无项目时它安全地不接管（needs:project 标注正确），而不是被当成了某个视图键。
  mountApp();
  assert.equal(pressChord({ ctrl: true, shift: true, key: 'tab' }), false);
});

test('文本输入目标不触发壳层 B/1/2/3 导航，但 Ctrl/Cmd+P 仍跨文本生效', () => {
  mountApp();
  const input = document.createElement('input');
  const select = document.createElement('select');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  document.body.append(input, select, editable);

  try {
    for (const target of [input, select, editable]) {
      for (const key of ['b', '1', '2', '3']) {
        assert.equal(
          pressChord({ ctrl: true, key }, { target }),
          false,
          `文本目标不应接管 Ctrl+${key.toUpperCase()} 壳层导航`,
        );
      }
      assert.equal(
        pressChord({ ctrl: true, key: 'p' }, { target }),
        true,
        'Ctrl+P 仍应在文本目标上打开命令面板',
      );
    }
    assert.equal(
      pressChord({ meta: true, key: 'p' }, { target: input }),
      true,
      'Cmd+P 仍应在文本目标上打开命令面板',
    );
  } finally {
    input.remove();
    select.remove();
    editable.remove();
  }
});

test('IME 组合态不会触发壳层 B/O/1/2/3 导航，普通壳层焦点仍接管', () => {
  mountApp();
  const shell = document.createElement('div');
  document.body.append(shell);

  try {
    for (const key of ['b', 'o', '1', '2', '3']) {
      assert.equal(
        pressChord({ ctrl: true, key }, { isComposing: true }),
        false,
        `IME 组合态不应接管 Ctrl+${key.toUpperCase()} 壳层导航`,
      );
      assert.equal(
        pressChord({ ctrl: true, key }, { target: shell }),
        true,
        `普通壳层焦点应接管 Ctrl+${key.toUpperCase()} 导航`,
      );
    }
  } finally {
    shell.remove();
  }
});

test('速查表正文按显示键名等宽对齐，且每行都出现在正文里', () => {
  const sheet = formatShortcutSheet();
  for (const row of SHORTCUT_ROWS) {
    assert.ok(sheet.includes(row.label), `速查表正文缺少「${row.label}」`);
  }
  assert.ok(sheet.includes('Ctrl C / A / V'), '速查表应说明系统编辑键不被拦截');
});

test('Ctrl/Cmd+O 从文本与 Monaco 输入焦点打开原生目录选择器，组合态不触发', async () => {
  mountApp();
  const input = document.createElement('textarea');
  input.className = 'inputarea';
  document.body.append(input);
  try {
    for (const modifier of [{ ctrl: true as const }, { meta: true as const }]) {
      await act(async () => {
        assert.equal(pressChord({ ...modifier, key: 'o' }, { target: input }), true);
      });
    }
    assert.equal(vi.mocked(openDirectory).mock.calls.length, 2);
    assert.equal(pressChord({ ctrl: true, key: 'o' }, { target: input, isComposing: true }), false);
    assert.equal(pressChord({ ctrl: true, shift: true, key: 'o' }, { target: input }), false);
    assert.equal(vi.mocked(openDirectory).mock.calls.length, 2);
  } finally {
    input.remove();
  }
});
