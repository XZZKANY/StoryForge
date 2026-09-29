import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { ObsPanel } from '../src/components/shell/ObsPanel';
test('观测尚未启用时不把空数组表达成零问题或全部处理完', () => {
  const panelHtml = renderToStaticMarkup(
    <ObsPanel observations={[]} onClose={() => undefined} onResolve={() => undefined} />,
  );

  assert.match(panelHtml, /观测尚未启用/);
  assert.doesNotMatch(panelHtml, /全部处理完/);
  assert.doesNotMatch(panelHtml, /机械观测.*常驻扫描/);
});

test('只有观测数据可用且为空时才显示真实成功空态', () => {
  const panelHtml = renderToStaticMarkup(
    <ObsPanel
      observations={[]}
      availability="available"
      onClose={() => undefined}
      onResolve={() => undefined}
    />,
  );

  assert.match(panelHtml, /全部处理完/);
  assert.match(panelHtml, /暂无观测项/);
});
