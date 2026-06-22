import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExportPath, buildRevisionLoopRecordPath, recordRevisionLoop } from '../src/lib/author-loop';

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

test('author loop record stores agent patch/session/issue/context metadata', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const writes: Array<{ path: string; content: string }> = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __STORYFORGE_MOCK_FS__: {
        writeFile(path: string, content: string) {
          writes.push({ path, content });
        },
      },
    },
  });

  try {
    await recordRevisionLoop({
      projectPath: 'D:\\StoryForge\\Book',
      filePath: 'D:\\StoryForge\\Book\\正文\\第一章.md',
      before: '旧正文',
      after: '新正文',
      summary: '修订摘要',
      note: '备注',
      userIntent: '修人物动机',
      assistantSessionId: 42,
      patchId: 'patch-1',
      issueIds: ['character-1'],
      contextFiles: ['人物\\林岚.md'],
    });
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }

  assert.equal(writes.length, 1);
  assert.match(writes[0].content, /Assistant Session：42/);
  assert.match(writes[0].content, /Patch ID：patch-1/);
  assert.match(writes[0].content, /Issue IDs：character-1/);
  assert.match(writes[0].content, /上下文文件：人物\\林岚\.md/);
});
