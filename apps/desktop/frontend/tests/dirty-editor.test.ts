import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  nextDirtyEditorFile,
  shouldConfirmBeforeReplacingDirtyEditor,
} from '../src/components/app/dirty-editor';

test('dirty editor projection records the file that actually became dirty', () => {
  assert.equal(
    nextDirtyEditorFile(null, 'D:\\Book\\正文\\第01章.md', true),
    'D:\\Book\\正文\\第01章.md',
  );
});

test('dirty editor projection only clears the matching clean file', () => {
  const dirtyFile = 'D:\\Book\\正文\\第01章.md';
  assert.equal(nextDirtyEditorFile(dirtyFile, dirtyFile, false), null);
  assert.equal(nextDirtyEditorFile(dirtyFile, 'D:\\Book\\正文\\第02章.md', false), dirtyFile);
});

test('dirty editor guard allows reopening the same file without a discard prompt', () => {
  const dirtyFile = 'D:\\Book\\正文\\第01章.md';
  assert.equal(shouldConfirmBeforeReplacingDirtyEditor(dirtyFile, dirtyFile), false);
});

test('dirty editor guard prompts before replacing the buffer with another target or settings', () => {
  const dirtyFile = 'D:\\Book\\正文\\第01章.md';
  assert.equal(
    shouldConfirmBeforeReplacingDirtyEditor(dirtyFile, 'D:\\Book\\正文\\第02章.md'),
    true,
  );
  assert.equal(shouldConfirmBeforeReplacingDirtyEditor(dirtyFile, null), true);
  assert.equal(shouldConfirmBeforeReplacingDirtyEditor(null, 'D:\\Book\\正文\\第02章.md'), false);
});
