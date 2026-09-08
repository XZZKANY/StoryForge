import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { bindInlineButtonAction, buildInputZoneDom } from '../src/components/editor/useInlineChat';

const buttons: HTMLButtonElement[] = [];

afterEach(() => {
  for (const button of buttons.splice(0)) button.remove();
});

function makeButton() {
  const button = document.createElement('button');
  document.body.append(button);
  buttons.push(button);
  return button;
}

test('inline view-zone button: pointer mousedown invokes once and suppresses follow-up click', () => {
  const button = makeButton();
  let calls = 0;
  bindInlineButtonAction(
    button,
    () => {
      calls += 1;
    },
    { label: '接受行间修订', shortcut: 'Alt+Enter' },
  );

  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  button.dispatchEvent(down);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

  assert.equal(calls, 1);
  assert.equal(down.defaultPrevented, true);
});

test('inline view-zone button: Enter/Space activation clicks invoke, non-activation keys do nothing', () => {
  const button = makeButton();
  let calls = 0;
  bindInlineButtonAction(
    button,
    () => {
      calls += 1;
    },
    { label: '弃用行间修订', shortcut: 'Escape' },
  );

  button.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  button.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );

  assert.equal(calls, 2);
});

test('inline view-zone buttons expose an action name and shortcut', () => {
  const button = makeButton();
  bindInlineButtonAction(button, () => {}, { label: '接受行间修订', shortcut: 'Alt+Enter' });

  assert.equal(button.getAttribute('aria-label'), '接受行间修订');
  assert.equal(button.getAttribute('aria-keyshortcuts'), 'Alt+Enter');
});

test('inline input exposes a mode-specific accessible name instead of relying on placeholder text', () => {
  const revise = buildInputZoneDom(
    { startLine: 4, endLine: 4, text: '旧句', isSelection: true },
    'revise',
    { onSend: () => undefined, onCancel: () => undefined },
  );
  const continueInput = buildInputZoneDom(
    { startLine: 4, endLine: 4, text: '旧句', isSelection: true },
    'continue',
    { onSend: () => undefined, onCancel: () => undefined },
  );
  try {
    assert.equal(revise.textarea.getAttribute('aria-label'), '行间修订指令');
    assert.equal(continueInput.textarea.getAttribute('aria-label'), '续写指令（可选）');
  } finally {
    revise.container.remove();
    continueInput.container.remove();
  }
});
