import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExportPath, buildRevisionLoopRecordPath } from '../src/lib/author-loop';

test('author loop writes deterministic local evidence and export paths', () => {
  const stamp = new Date(2026, 5, 17, 10, 11, 12);

  assert.equal(
    buildRevisionLoopRecordPath('D:\\StoryForge\\Book', 'D:\\StoryForge\\Book\\正文\\第一章.md', stamp),
    'D:\\StoryForge\\Book\\.storyforge\\author-loop\\20260617-101112-第一章.md',
  );
  assert.equal(
    buildExportPath('D:\\StoryForge\\Book', 'D:\\StoryForge\\Book\\正文\\第一章.md', stamp),
    'D:\\StoryForge\\Book\\导出\\20260617-101112-第一章.md',
  );
});
