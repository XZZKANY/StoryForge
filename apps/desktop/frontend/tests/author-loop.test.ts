import { TauriFileSystem } from '../src/lib/tauri-fs';
import { readReceiptAuditPayload, verifyReceiptAudit } from '../src/lib/writeback-audit';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildExportPath,
  buildRevisionLoopRecordPath,
  recordRevisionLoop,
  revisionLoopSemanticPayload,
  readRevisionLoopPayload,
} from '../src/lib/author-loop';

test('author loop writes deterministic local evidence and export paths', () => {
  const stamp = new Date(2026, 5, 17, 10, 11, 12);

  assert.equal(
    buildRevisionLoopRecordPath(
      'D:\\StoryForge\\Book',
      'D:\\StoryForge\\Book\\正文\\第一章.md',
      stamp,
    ),
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

test('receipt-bound author-loop repair reuses its durable record after a lost acknowledgement', async () => {
  const files = new Map<string, string>();
  let writes = 0;
  const record = {
    projectPath: 'D:/Book',
    filePath: 'D:/Book/chapter.md',
    before: 'before',
    after: 'after',
    summary: 'summary',
    note: 'note',
    userIntent: 'revise',
    assistantSessionId: 1,
    patchId: 'p1',
    operationId: 'a'.repeat(64),
  };
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => files.has(path),
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error('missing');
      return content;
    },
    writeFile: (path, content) => {
      files.set(path, content);
      writes++;
      throw new Error('ack lost after write');
    },
  };
  try {
    await assert.rejects(recordRevisionLoop(record), /ack lost/);
    const result = await recordRevisionLoop(record);
    assert.equal(result.recordPath, `D:/Book/.storyforge/author-loop/${record.operationId}.md`);
    assert.equal(
      writes,
      1,
      'a repaired audit reuses the confirmed record instead of writing another',
    );
  } finally {
    delete window.__STORYFORGE_MOCK_FS__;
  }
});

test('audit completion envelope rejects truncated, tampered and conflicting records without overwrite', async () => {
  const files = new Map<string, string>();
  let writes = 0;
  const record = {
    projectPath: 'D:/Book',
    filePath: 'D:/Book/chapter.md',
    before: 'before',
    after: 'after',
    summary: 'summary',
    note: 'note',
    userIntent: 'revise',
    assistantSessionId: 1,
    patchId: 'p1',
    operationId: 'b'.repeat(64),
  };
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => files.has(path),
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('missing');
      return value;
    },
    writeFile: (path, content) => {
      files.set(path, content);
      writes++;
    },
  };
  try {
    const result = await recordRevisionLoop(record);
    const path = result.recordPath!;
    const complete = files.get(path)!;
    await assert.rejects(recordRevisionLoop({ ...record, after: 'other payload' }), /不匹配/);
    for (const corrupt of [
      record.operationId,
      complete.slice(0, -10),
      complete.replace('修订摘要', '篡改摘要'),
    ]) {
      files.set(path, corrupt);
      await assert.rejects(recordRevisionLoop(record), /不完整|不匹配/);
      assert.equal(files.get(path), corrupt);
    }
    files.set(path, complete);
    await recordRevisionLoop(record);
    assert.equal(writes, 1);
  } finally {
    delete window.__STORYFORGE_MOCK_FS__;
  }
});

test('same-operation concurrent audit attempts cannot replace the winning payload', async () => {
  const files = new Map<string, string>();
  let writes = 0;
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => files.has(path),
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('missing');
      return value;
    },
    writeFile: async (path, content) => {
      await Promise.resolve();
      files.set(path, content);
      writes++;
    },
  };
  const record = {
    projectPath: 'D:/Book',
    filePath: 'D:/Book/chapter.md',
    before: 'before',
    after: 'after',
    summary: 'summary',
    note: 'note',
    userIntent: 'revise',
    assistantSessionId: 1,
    operationId: 'c'.repeat(64),
  };
  try {
    const results = await Promise.allSettled([
      recordRevisionLoop(record),
      recordRevisionLoop({ ...record, after: 'different' }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(writes, 1);
  } finally {
    delete window.__STORYFORGE_MOCK_FS__;
  }
});

test('audit recovery decodes the exact canonical semantic payload, including issue metadata', () => {
  const project = 'D:/project',
    file = project + '/正文/a.md';
  const raw = revisionLoopSemanticPayload({
    projectPath: project,
    filePath: file,
    before: '原稿\r\n',
    after: '新稿😀é\r\n',
    summary: '局部修改',
    note: '未作语义复核',
    userIntent: '保持声音',
    assistantSessionId: 42,
    patchId: 'patch',
    issueIds: ['a', 'b'],
    contextFiles: ['knowledge/a.md'],
    issueResolutions: [
      { id: 'a', status: 'resolved' },
      { id: 'b', status: 'open' },
    ],
    issueCounts: { observed: 2, authorConfirmed: 1, resolved: 1 },
    issueAttributed: false,
  });
  assert.equal(revisionLoopSemanticPayload(readRevisionLoopPayload(project, file, raw)), raw);
  for (const change of [
    { issueIds: [42] },
    { issueCounts: { observed: -1, authorConfirmed: 1, resolved: 1 } },
    { issueResolutions: [{ id: 'a', status: 'approved' }] },
    { file: '../other.md' },
    { assistantSessionId: '42' },
    { summary: null },
    { extraField: 'ignored' },
  ])
    assert.throws(() =>
      readRevisionLoopPayload(project, file, JSON.stringify({ ...JSON.parse(raw), ...change })),
    );
});


test('completed audit retains exact payload while legacy hash-only records remain immutable', async () => {
  const files = new Map<string, string>();
  const projectPath = 'D:/Book', filePath = projectPath + '/chapter.md';
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => files.has(path),
    readFile: (path) => { const value = files.get(path); if (value === undefined) throw new Error('missing'); return value; },
    writeFile: (path, content) => { files.set(path, content); },
  };
  try {
    const request = {operationKey: 'p:whole', path: filePath, content: 'after with author text', source: 'original'};
    const receipt = await TauriFileSystem.writeFileWithReceipt(projectPath, request, {kind: 'missing'}, null);
    const record = {projectPath, filePath, before: '', after: request.content, summary: 'summary', note: '', userIntent: 'revise', assistantSessionId: null, patchId: 'p', operationId: receipt.operationId};
    const {recordPath} = await recordRevisionLoop({...record, retainRecoveryPayload: true});
    const payload = revisionLoopSemanticPayload(record);
    assert.equal(await readReceiptAuditPayload(projectPath, {...request, content: 'later author text'}), payload);
    const complete = files.get(recordPath!)!;
    const defaultResult = await recordRevisionLoop({...record, operationId: 'f'.repeat(64)});
    const defaultHeader = files.get(defaultResult.recordPath!)!.split('\n')[0];
    const defaultMetadata = JSON.parse(defaultHeader.slice('<!-- storyforge-writeback-audit-v1 '.length, -4));
    assert.deepEqual(Object.keys(defaultMetadata).sort(), ['bodyHash', 'operationId', 'payloadHash']);
    const headerEnd = complete.indexOf('\n');
    const prefix = '<!-- storyforge-writeback-audit-v1 ';
    const metadata = JSON.parse(complete.slice(prefix.length, headerEnd - 4));
    const withMetadata = (value: object) => prefix + JSON.stringify(value) + ' -->' + complete.slice(headerEnd);
    files.set(recordPath!, withMetadata({...metadata, semanticPayload: payload + ' '}));
    await assert.rejects(readReceiptAuditPayload(projectPath, request), /不匹配/);
    await assert.rejects(verifyReceiptAudit(projectPath, recordPath!, receipt.operationId, payload), /不匹配/);
    delete metadata.semanticPayload;
    const legacy = withMetadata(metadata);
    files.set(recordPath!, legacy);
    assert.equal(await readReceiptAuditPayload(projectPath, request), null, 'legacy hashes cannot recover absent manuscript bytes');
    await verifyReceiptAudit(projectPath, recordPath!, receipt.operationId, payload);
    await recordRevisionLoop(record);
    assert.equal(files.get(recordPath!), legacy, 'repair never overwrites legacy audit');
  } finally {
    delete window.__STORYFORGE_MOCK_FS__;
  }
});
