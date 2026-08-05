import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { PermissionProfileSelector } from '../src/components/chat-window/PermissionProfileSelector';

test('显示当前档位标签', () => {
  const html = renderToStaticMarkup(
    <PermissionProfileSelector value="auto" onChange={() => undefined} />,
  );

  assert.match(html, /data-testid="permission-profile-selector"/);
  assert.match(html, /自动/);
});

test('不同档位显示对应标签', () => {
  const readHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="read" onChange={() => undefined} />,
  );
  assert.match(readHtml, /只读/);

  const askHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="ask" onChange={() => undefined} />,
  );
  assert.match(askHtml, /询问/);

  const autoHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="auto" onChange={() => undefined} />,
  );
  assert.match(autoHtml, /自动/);

  const fullHtml = renderToStaticMarkup(
    <PermissionProfileSelector value="full" onChange={() => undefined} />,
  );
  assert.match(fullHtml, /完全放行/);
});

test('disabled 时按钮被禁用', () => {
  const html = renderToStaticMarkup(
    <PermissionProfileSelector value="ask" onChange={() => undefined} disabled />,
  );

  assert.match(html, /data-testid="permission-profile-selector"/);
  assert.match(html, /disabled=""/);
});

test('busy 时按钮被禁用且显示特定提示', () => {
  const html = renderToStaticMarkup(
    <PermissionProfileSelector value="ask" onChange={() => undefined} busy />,
  );

  assert.match(html, /data-testid="permission-profile-selector"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /本轮正在按启动时的权限档位执行/);
});
