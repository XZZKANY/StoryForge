/** ObsPanel 点行定位：有 anchor 的行点击回调携带该观测；无 anchor 的行不可点。 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { ObsPanel, type Observation } from '../src/components/shell/ObsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OBSERVATIONS: Observation[] = [
  {
    id: 'prose_def456',
    severity: 'warning',
    title: '「不禁、五味杂陈」',
    source: 'prose·套话',
    location: '正文/第02章.md',
    anchor: { path: '正文/第02章.md', snippet: '不禁、五味杂陈' },
  },
  {
    id: 'no_anchor',
    severity: 'advisory',
    title: '无锚点观测',
  },
];

test('点击带 anchor 的观测行触发 onLocate；无 anchor 行不触发', async () => {
  const located: Observation[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <ObsPanel
          observations={OBSERVATIONS}
          availability="available"
          onClose={() => undefined}
          onResolve={() => undefined}
          onLocate={(observation) => located.push(observation)}
        />,
      );
      await Promise.resolve();
    });

    const bodies = container.querySelectorAll('[data-testid="obs-row-body"]');
    assert.equal(bodies.length, 2);

    await act(async () => {
      (bodies[0] as HTMLElement).click();
      (bodies[1] as HTMLElement).click();
    });

    assert.equal(located.length, 1);
    assert.equal(located[0]?.id, 'prose_def456');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
