import assert from 'node:assert/strict';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { PanelSection } from '../src/components/shell/PanelSection';

function render(node: ReactElement) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(node);
  return host;
}

test('分区标题右侧的小字：数字照原样显示（0 也显示），null 和空串不占位', () => {
  const metaText = (meta: string | number | null) =>
    render(
      <PanelSection prefix="t" testid="s" title="分区" meta={meta}>
        内容
      </PanelSection>,
    ).querySelector('[data-testid="t-toggle-s"] .font-mono')?.textContent ?? null;
  assert.equal(metaText(0), '0');
  assert.equal(metaText(12), '12');
  assert.equal(metaText('3/10'), '3/10');
  assert.equal(metaText(null), null);
  assert.equal(metaText(''), null);
});

test('stack：展开后内容排成一列、左右缩进、条目间留间隔；不给 stack 就原样放', () => {
  const firstChild = (stack: boolean) =>
    render(
      <PanelSection prefix="t" testid="s" title="分区" defaultOpen stack={stack}>
        <p>甲</p>
        <p>乙</p>
      </PanelSection>,
    ).querySelector('[data-testid="t-section-s"] > div')!.firstElementChild!;
  const stacked = firstChild(true);
  assert.equal(stacked.className, 'flex flex-col gap-2 px-3');
  assert.equal(stacked.children.length, 2);
  assert.equal(firstChild(false).tagName, 'P');
});
