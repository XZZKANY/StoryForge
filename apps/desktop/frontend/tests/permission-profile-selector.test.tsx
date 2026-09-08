import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { ComposerSurface } from '../src/components/chat-window/Composer';
import { PermissionProfileSelector } from '../src/components/chat-window/PermissionProfileSelector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

test('权限档位菜单支持方向键循环、Home/End、Enter 选择和 Escape 返回入口', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const changes: string[] = [];
  act(() => {
    root.render(
      <PermissionProfileSelector value="ask" onChange={(profile) => changes.push(profile)} />,
    );
  });
  try {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-profile-selector"]',
    );
    assert.ok(trigger);
    assert.equal(trigger.getAttribute('aria-controls'), null);
    trigger.focus();
    act(() => trigger.click());

    const options = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const menu = container.querySelector('[role="listbox"]');
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'permission-option-ask');
    assert.equal(trigger.getAttribute('aria-controls'), menu?.getAttribute('id'));
    assert.ok(menu?.getAttribute('id'));

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'permission-option-auto');
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'permission-option-read');
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'permission-option-full');
    act(() => options()[3]?.click());
    assert.deepEqual(changes, ['full']);
    assert.equal(container.querySelector('[role="listbox"]'), null);
    assert.equal(trigger.getAttribute('aria-controls'), null);
    assert.equal(
      document.activeElement?.getAttribute('data-testid'),
      'permission-profile-selector',
    );

    act(() => trigger.click());
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(container.querySelector('[role="listbox"]'), null);
    assert.equal(
      document.activeElement?.getAttribute('data-testid'),
      'permission-profile-selector',
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('选择权限档位后焦点回到入口，Tab 关闭也不丢焦点', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const changes: string[] = [];

  act(() => {
    root.render(
      <PermissionProfileSelector value="ask" onChange={(profile) => changes.push(profile)} />,
    );
  });

  try {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-profile-selector"]',
    );
    assert.ok(trigger);
    act(() => trigger.click());
    const option = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-option-read"]',
    );
    assert.ok(option);
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'permission-option-ask');

    act(() => option.click());
    assert.deepEqual(changes, ['read']);
    assert.equal(
      document.activeElement?.getAttribute('data-testid'),
      'permission-profile-selector',
    );
    assert.equal(container.querySelector('[role="listbox"]'), null);

    act(() => trigger.click());
    assert.equal(document.activeElement?.getAttribute('role'), 'option');
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(container.querySelector('[role="listbox"]'), null);
    assert.equal(
      document.activeElement?.getAttribute('data-testid'),
      'permission-profile-selector',
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('点击不可聚焦的外部背景关闭档位菜单时，焦点回到入口', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <>
        <PermissionProfileSelector value="ask" onChange={() => undefined} />
        <div data-testid="outside-background">背景</div>
      </>,
    );
  });

  try {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-profile-selector"]',
    );
    const outside = container.querySelector<HTMLElement>('[data-testid="outside-background"]');
    assert.ok(trigger);
    assert.ok(outside);
    act(() => trigger.click());
    assert.equal(document.activeElement?.getAttribute('role'), 'option');
    act(() =>
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })),
    );
    assert.equal(container.querySelector('[role="listbox"]'), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('角色建议支持键盘循环和 Enter 选择，不要求鼠标点击', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [value, setValue] = useState('@');
    return (
      <ComposerSurface
        value={value}
        disabled={false}
        busy={false}
        currentFileLabel={null}
        explicitContextPaths={[]}
        onAddContext={() => undefined}
        onChange={setValue}
        permissionProfile="ask"
        onPermissionProfileChange={() => undefined}
      />
    );
  }

  act(() => root.render(<Harness />));
  try {
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    assert.ok(textarea);
    const options = container.querySelectorAll('[role="option"]');
    assert.ok(options.length > 1);
    assert.equal(options[0]?.getAttribute('aria-selected'), 'true');
    assert.equal(textarea.getAttribute('aria-controls'), 'agent-role-suggestions');
    assert.equal(textarea.getAttribute('aria-expanded'), 'true');
    assert.equal(textarea.getAttribute('aria-activedescendant'), options[0]?.getAttribute('id'));
    assert.equal(
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.getAttribute('aria-label'),
      '发送',
    );

    act(() =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    assert.equal(options[0]?.getAttribute('aria-selected'), 'false');
    assert.equal(options[1]?.getAttribute('aria-selected'), 'true');
    act(() =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    assert.equal(textarea.value, `${options[1]?.textContent?.trim()} `);
    assert.equal(container.querySelector('[role="listbox"]'), null);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('无项目时上下文操作随 Composer 一起禁用，并声明角色自动补全语义', () => {
  const html = renderToStaticMarkup(
    <ComposerSurface
      value="@"
      disabled
      busy={false}
      currentFileLabel="正文/第07章.md"
      explicitContextPaths={[]}
      onAddContext={() => undefined}
      onTogglePinnedContext={() => undefined}
      onChange={() => undefined}
      permissionProfile="ask"
      onPermissionProfileChange={() => undefined}
    />,
  );

  assert.match(html, /data-testid="composer-input"[^>]*disabled=""/);
  assert.match(html, /data-testid="composer-input"[^>]*aria-autocomplete="list"/);
  assert.match(html, /aria-label="固定当前文件为参考"[^>]*disabled=""/);
  assert.match(html, /aria-label="固定当前文件为参考：正文\/第07章\.md"[^>]*disabled=""/);
});

for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
  for (const suggestions of [false, true]) {
    test(`Composer ${modifier} 方向键保留原生编辑：候选=${suggestions}`, () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const initial = suggestions ? '@' : '未发送草稿';
      function Harness() {
        const [value, setValue] = useState(initial);
        return (
          <ComposerSurface
            value={value}
            disabled={false}
            busy={false}
            currentFileLabel={null}
            explicitContextPaths={[]}
            history={['历史消息']}
            onAddContext={() => undefined}
            onChange={setValue}
            permissionProfile="ask"
            onPermissionProfileChange={() => undefined}
          />
        );
      }
      act(() => root.render(<Harness />));
      try {
        const input = container.querySelector('textarea')!;
        input.setSelectionRange(0, 0);
        const selected = input.getAttribute('aria-activedescendant');
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
          [modifier]: true,
        });
        act(() => {
          input.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, false);
        assert.equal(input.value, initial);
        assert.equal(input.getAttribute('aria-activedescendant'), selected);
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  }
}
for (const key of ['ArrowUp', 'ArrowDown']) {
  test(`Composer 运行中隐藏的角色候选不拦截 ${key}`, () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ComposerSurface
          value="文字 @"
          disabled={false}
          busy
          currentFileLabel={null}
          explicitContextPaths={[]}
          history={[]}
          onAddContext={() => undefined}
          onChange={() => undefined}
          permissionProfile="ask"
          onPermissionProfileChange={() => undefined}
        />,
      ),
    );
    try {
      const input = container.querySelector('textarea')!;
      input.setSelectionRange(1, 1);
      assert.equal(container.querySelector('[role="listbox"]'), null);
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => {
        input.dispatchEvent(event);
      });
      assert.equal(event.defaultPrevented, false);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
}

function mountRoleComposer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let submissions = 0;
  function Harness() {
    const [value, setValue] = useState('@');
    return (
      <ComposerSurface
        value={value}
        disabled={false}
        busy={false}
        currentFileLabel={null}
        explicitContextPaths={[]}
        onAddContext={() => undefined}
        onChange={setValue}
        onSubmit={() => {
          submissions += 1;
        }}
        permissionProfile="ask"
        onPermissionProfileChange={() => undefined}
      />
    );
  }
  act(() => root.render(<Harness />));
  const input = container.querySelector('textarea')!;
  input.focus();
  return {
    container,
    input,
    submissions: () => submissions,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('Escape 只关闭角色候选并保留草稿，随后 Enter 正常提交文字', () => {
  const view = mountRoleComposer();
  try {
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      view.input.dispatchEvent(escape);
    });
    assert.equal(view.container.querySelector('[role="listbox"]') === null, true);
    assert.equal(view.input.value, '@');
    assert.equal(document.activeElement === view.input, true);
    assert.equal(view.input.getAttribute('aria-expanded'), 'false');
    assert.equal(view.input.getAttribute('aria-activedescendant'), null);
    assert.equal(escape.defaultPrevented, true);
    const nextEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      view.input.dispatchEvent(nextEscape);
    });
    assert.equal(nextEscape.defaultPrevented, false);
    act(() => {
      view.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(view.submissions(), 1);
    assert.equal(view.input.value, '@');
  } finally {
    view.cleanup();
  }
});

test('关闭角色候选后继续输入可以再次触发候选', () => {
  const view = mountRoleComposer();
  try {
    act(() => {
      view.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(view.container.querySelector('[role="listbox"]') === null, true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        view.input,
        '新的 @',
      );
      view.input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.ok(view.container.querySelector('[role="listbox"]'));
  } finally {
    view.cleanup();
  }
});

test('点击角色后恢复输入焦点且不提交消息', () => {
  const view = mountRoleComposer();
  try {
    const option = view.container.querySelector<HTMLButtonElement>('[role="option"]')!;
    const mention = option.textContent!.trim();
    option.focus();
    act(() => option.click());
    assert.equal(view.input.value, `${mention} `);
    assert.equal(document.activeElement === view.input, true);
    assert.equal(view.submissions(), 0);
  } finally {
    view.cleanup();
  }
});

test('折叠参考可用按钮展开，取消第 4 项不影响前 3 项，并可收起', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const paths = ['设定/一.md', '设定/二.md', '设定/三.md', '设定/四.md', '设定/五.md'];
  const toggled: string[] = [];
  function Harness() {
    const [pins, setPins] = useState(paths);
    return (
      <ComposerSurface
        value="草稿"
        disabled={false}
        busy={false}
        currentFileLabel={null}
        explicitContextPaths={pins}
        onAddContext={() => undefined}
        onChange={() => undefined}
        onTogglePinnedContext={(path) => {
          toggled.push(path);
          setPins(pins.filter((p) => p !== path));
        }}
        permissionProfile="ask"
        onPermissionProfileChange={() => undefined}
      />
    );
  }
  act(() => root.render(<Harness />));
  try {
    const expand = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-context-expand"]',
    );
    assert.ok(expand);
    assert.equal(expand.getAttribute('aria-expanded'), 'false');
    assert.equal(container.querySelectorAll('button[aria-label^="取消固定"]').length, 3);
    act(() => expand.click());
    assert.equal(expand.getAttribute('aria-expanded'), 'true');
    assert.equal(container.querySelectorAll('button[aria-label^="取消固定"]').length, 5);
    const fourth = container.querySelector<HTMLButtonElement>(
      'button[aria-label="取消固定 四.md"]',
    )!;
    act(() => fourth.click());
    assert.deepEqual(toggled, ['设定/四.md']);
    assert.equal(container.querySelectorAll('button[aria-label^="取消固定"]').length, 4);
    act(() => expand.click());
    assert.equal(container.querySelectorAll('button[aria-label^="取消固定"]').length, 3);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Composer 禁用时固定参考的取消操作同样禁用', () => {
  const html = renderToStaticMarkup(
    <ComposerSurface
      value=""
      disabled
      busy={false}
      currentFileLabel={null}
      explicitContextPaths={['设定/一.md']}
      onAddContext={() => undefined}
      onChange={() => undefined}
      onTogglePinnedContext={() => undefined}
      permissionProfile="ask"
      onPermissionProfileChange={() => undefined}
    />,
  );
  assert.match(html, /<button[^>]*aria-label="取消固定 一.md"[^>]*disabled=""/);
});

for (const scenario of [
  { pins: ['一', '二', '三'], remove: 0, next: '二' },
  { pins: ['一', '二', '三'], remove: 2, next: '二' },
  { pins: ['一'], remove: 0, next: null },
  { pins: ['一', '二'], remove: 0, next: 'outside' },
]) {
  test(`取消固定参考后焦点有归属：${JSON.stringify(scenario)}`, () => {
    const container = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(container, outside);
    const root = createRoot(container);
    function Harness() {
      const [pins, setPins] = useState(scenario.pins.map((p) => `设定/${p}.md`));
      return (
        <ComposerSurface
          value="草稿"
          disabled={false}
          busy={false}
          currentFileLabel={null}
          explicitContextPaths={pins}
          onAddContext={() => undefined}
          onChange={() => undefined}
          onTogglePinnedContext={(path) => setPins(pins.filter((p) => p !== path))}
          permissionProfile="ask"
          onPermissionProfileChange={() => undefined}
        />
      );
    }
    act(() => root.render(<Harness />));
    try {
      const buttons = container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="取消固定"]',
      );
      const remove = buttons[scenario.remove]!;
      if (scenario.next === 'outside') outside.focus();
      else remove.focus();
      act(() => remove.click());
      const expected =
        scenario.next === 'outside'
          ? outside
          : scenario.next === null
            ? container.querySelector('textarea')
            : container.querySelector(`button[aria-label="取消固定 ${scenario.next}.md"]`);
      assert.equal(remove.isConnected, false);
      assert.equal(document.activeElement === expected, true);
    } finally {
      act(() => root.unmount());
      container.remove();
      outside.remove();
    }
  });
}
