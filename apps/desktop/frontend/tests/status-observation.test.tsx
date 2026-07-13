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
          theme="dark"
          projectOpen={false}
          obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
          fontMode="grid"
          onToggleObs={() => undefined}
          onToggleFont={() => undefined}
          onToggleTheme={() => undefined}
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

test('观测未接线时不把空数组表达成零问题或全部处理完', () => {
  const statusHtml = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      theme="dark"
      projectOpen
      obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
      fontMode="grid"
      onToggleObs={() => undefined}
      onToggleFont={() => undefined}
      onToggleTheme={() => undefined}
    />,
  );
  const panelHtml = renderToStaticMarkup(
    <ObsPanel observations={[]} onClose={() => undefined} onResolve={() => undefined} />,
  );

  assert.match(statusHtml, /观测未接线/);
  assert.doesNotMatch(statusHtml, /无观测项/);
  // Q9：打开项目时状态栏出现「字体 · 格子/散文」双轨切换芯片。
  assert.match(statusHtml, /data-testid="status-font-toggle"/);
  assert.match(statusHtml, /字体 · 格子/);
  assert.match(panelHtml, /观测未接线/);
  assert.doesNotMatch(panelHtml, /全部处理完/);
  assert.doesNotMatch(panelHtml, /机械观测.*常驻扫描/);
});

test('只有观测数据可用且为空时才显示真实成功空态', () => {
  const statusHtml = renderToStaticMarkup(
    <StatusBar
      modelLabel=""
      theme="dark"
      projectOpen
      obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
      observationAvailability="available"
      fontMode="grid"
      onToggleObs={() => undefined}
      onToggleFont={() => undefined}
      onToggleTheme={() => undefined}
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
