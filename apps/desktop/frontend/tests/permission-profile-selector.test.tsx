import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { ComposerSurface } from '../src/components/chat-window/Composer';
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

test('展开权限菜单时 Composer 不裁切向上的浮层', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ComposerSurface
        value=""
        disabled={false}
        busy={false}
        currentFileLabel={null}
        explicitContextPaths={[]}
        onAddContext={() => undefined}
        onChange={() => undefined}
        permissionProfile="ask"
        onPermissionProfileChange={() => undefined}
      />,
    );
  });

  const trigger = container.querySelector(
    '[data-testid="permission-profile-selector"]',
  ) as HTMLButtonElement;
  act(() => trigger.click());

  const menu = container.querySelector('[role="listbox"]');
  const composer = trigger.closest('.group');
  assert.ok(menu, '权限菜单没有展开');
  assert.ok(composer, '找不到 Composer 外层');
  assert.equal(
    composer.classList.contains('overflow-hidden'),
    false,
    '向上展开的权限菜单会被 Composer overflow-hidden 裁切',
  );

  act(() => root.unmount());
  container.remove();
});
