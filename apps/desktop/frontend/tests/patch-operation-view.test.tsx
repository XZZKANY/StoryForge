import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import { PatchReviewPanel } from '../src/components/PatchReviewPanel';
import {
  createSuggestionChangeSet,
  projectRemainingSuggestion,
} from '../src/lib/suggestion-change-set';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';
import type { PatchHunk } from '../src/lib/patch-hunks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('remaining UI uses owned operations, explains conflicts and blocks unsafe clicks and hotkeys', async () => {
  const set = createSuggestionChangeSet('A\nB\nC\nD\nE', 'AA\nB\nCC\nD\nEE');
  assert.equal(set.operations.length, 3);
  const current = 'AA\n作者保留。\n作者改了C。\nD\nE';
  const projection = projectRemainingSuggestion(current, set, new Set([set.operations[0].id]));
  assert.equal(projection.after, 'AA\n作者保留。\n作者改了C。\nD\nEE');
  const suggestion: AssistantFileSuggestion = {
    id: 'owned-operation-ui',
    filePath: '正文.md',
    title: 'AI 修订',
    summary: '表达修订',
    before: current,
    after: projection.after,
    note: '',
    createdAt: 1,
    operationView: projection.view,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let wholeCalls = 0;
  const selected: PatchHunk[] = [];
  try {
    await act(async () =>
      root.render(
        <PatchReviewPanel
          suggestion={suggestion}
          editorFontSize={14}
          editorFontFamily="test-font"
          onAccept={() => {
            wholeCalls++;
          }}
          onAcceptHunk={(op) => {
            selected.push(op);
          }}
          onReject={() => undefined}
          onSaveNote={() => undefined}
          onRetryWithoutKnowledge={() => undefined}
        />,
      ),
    );
    const rows = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="suggestion-accept-hunk"]',
    );
    assert.equal(
      rows.length,
      2,
      'safe preview only changes E, but the original unmapped C stays explicit',
    );
    assert.equal(rows[0].disabled, true);
    assert.equal(rows[1].disabled, false);
    assert.match(rows[1].textContent ?? '', /原稿第 5 行/);
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /原修改区间已变化/);
    const whole = container.querySelector<HTMLButtonElement>('[data-testid="suggestion-accept"]')!;
    assert.equal(whole.disabled, true);
    await act(async () => {
      rows[0].click();
      whole.click();
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      );
    });
    assert.equal(wholeCalls, 0);
    assert.equal(selected.length, 0);
    await act(async () => rows[1].click());
    assert.equal(selected.length, 1);
    assert.equal(
      selected[0],
      set.operations[2],
      'callback carries original object, not a fresh current diff',
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
