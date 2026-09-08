import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, test, vi } from 'vitest';

import { ObsPanel } from '../src/components/shell/ObsPanel';
import { StatusBar } from '../src/components/shell/StatusBar';
import { probeApiRuntimeHealth } from '../src/lib/api/runtime-health';

vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: vi.fn(),
}));

const mockedProbeApiRuntimeHealth = vi.mocked(probeApiRuntimeHealth);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  mockedProbeApiRuntimeHealth.mockReset();
});

test('sidecar 探测 Promise 失败后显示连接中断，不停留在探测中', async () => {
  mockedProbeApiRuntimeHealth.mockRejectedValue(new Error('无法读取 sidecar 配置'));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <StatusBar
          modelLabel=""
          projectOpen={false}
          obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
          onToggleObs={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    const sidecar = container.querySelector('[data-testid="status-sidecar"]');
    assert.ok(sidecar);
    assert.match(sidecar.textContent ?? '', /连接中断/);
    assert.doesNotMatch(sidecar.textContent ?? '', /探测中/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('观测尚未启用时不把空数组表达成零问题或全部处理完', () => {
  const statusHtml = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      projectOpen
      obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
      onToggleObs={() => undefined}
    />,
  );
  const panelHtml = renderToStaticMarkup(
    <ObsPanel observations={[]} onClose={() => undefined} onResolve={() => undefined} />,
  );

  assert.match(statusHtml, /观测尚未启用/);
  assert.doesNotMatch(statusHtml, /无观测项/);
  // #14：字体 / 主题切换已移入设置，状态栏不再出现字体开关。
  assert.doesNotMatch(statusHtml, /data-testid="status-font-toggle"/);
  assert.match(panelHtml, /观测尚未启用/);
  assert.doesNotMatch(panelHtml, /全部处理完/);
  assert.doesNotMatch(panelHtml, /机械观测.*常驻扫描/);
});

test('只有观测数据可用且为空时才显示真实成功空态', () => {
  const statusHtml = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      projectOpen
      obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
      observationAvailability="available"
      onToggleObs={() => undefined}
    />,
  );
  const panelHtml = renderToStaticMarkup(
    <ObsPanel
      observations={[]}
      availability="available"
      onClose={() => undefined}
      onResolve={() => undefined}
    />,
  );

  assert.match(statusHtml, /无未处理观测/);
  assert.match(statusHtml, /text-success/);
  assert.match(panelHtml, /全部处理完/);
  assert.match(panelHtml, /暂无观测项/);
});

test('观测项在键盘焦点落入行内时保持处理按钮可见', () => {
  const html = renderToStaticMarkup(
    <ObsPanel
      observations={[{ id: 'obs-1', severity: 'warning', title: '缺少章节标题' }]}
      availability="available"
      onClose={() => undefined}
      onResolve={() => undefined}
    />,
  );
  assert.match(html, /group-focus-within:opacity-100/);
});

test('观测面板支持 Escape 关闭且不受输入法组合影响', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let closed = 0;
  try {
    act(() =>
      root.render(
        <ObsPanel
          observations={[]}
          onClose={() => {
            closed += 1;
          }}
          onResolve={() => undefined}
        />,
      ),
    );
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭观测面板"]');
    assert.ok(close);
    const composing = new KeyboardEvent('keydown', {
      key: 'Escape',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => close.dispatchEvent(composing));
    assert.equal(closed, 0);
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => close.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, true);
    assert.equal(closed, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('观测入口的无障碍名称随数据可用性变化', () => {
  const unavailable = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      projectOpen
      obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
      onToggleObs={() => undefined}
    />,
  );
  const available = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      projectOpen
      obs={{ error: 1, warning: 2, advisory: 0, total: 3 }}
      observationAvailability="available"
      onToggleObs={() => undefined}
    />,
  );
  assert.match(unavailable, /aria-label="打开观测清单：观测尚未启用"/);
  assert.match(available, /aria-label="打开观测清单：3 项未处理"/);
  assert.match(available, /aria-expanded="false"/);
  const availableOpen = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      projectOpen
      obs={{ error: 1, warning: 2, advisory: 0, total: 3 }}
      observationAvailability="available"
      observationOpen
      onToggleObs={() => undefined}
    />,
  );
  assert.match(availableOpen, /aria-controls="obs-panel"/);
  assert.match(availableOpen, /aria-expanded="true"/);
});
