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
    // D4 信息级层：观测面板是壳子内的子区域，标题用语义 h4（比左栏 h2 更低一级）。
    assert.equal(container.querySelector('h4')?.textContent, '观测');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('观测面板图标按钮有显式 aria-label，不只依赖 title', async () => {
  // 图标-only 按钮（关闭面板 X / 标记已处理 ✓）不能只靠 title 做可访问名（屏读者支持不一致）。
  // 关闭按钮每条共用一个名；「标记已处理」要带观测标题，否则一排同名按钮无法区分处理的是哪条。
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
          onLocate={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    const closeBtn = container.querySelector<HTMLButtonElement>('[aria-label="关闭观测面板"]');
    assert.ok(closeBtn, '关闭观测面板按钮缺 aria-label');

    const resolveButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).filter((b) => b.getAttribute('aria-label')?.startsWith('标记已处理：'));
    assert.equal(resolveButtons.length, 2);
    assert.equal(resolveButtons[0]?.getAttribute('aria-label'), '标记已处理：「不禁、五味杂陈」');
    assert.equal(resolveButtons[1]?.getAttribute('aria-label'), '标记已处理：无锚点观测');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
