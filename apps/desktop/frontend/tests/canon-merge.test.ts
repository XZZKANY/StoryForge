/**
 * canon 提案并入的行为红线。此前提案区只读，agent 能读 canon.json 不能写，
 * 作者只能手改 JSON；这一层只补「作者点一下」，写盘仍由作者动作触发。
 *
 * 可证伪：
 * 1. 并入实体写全字段（不能只写卡片展示的 id/名/别名）。
 * 2. 已存在同 id / 同内容不重复追加——作者已有的声明优先。
 * 3. canon.json 缺失时按空骨架起头；存在但解析不出来（手改到一半）就拒绝，绝不拿空骨架覆盖。
 * 4. 落盘路径是 .storyforge/canon/canon.json，按项目自身分隔符风格拼。
 */

import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

import {
  applyCanonMerge,
  applyPromiseResolved,
  canonDeclarationPathFor,
  CanonUnreadableError,
  type CanonMergeTarget,
} from '../src/lib/canon-merge';
import { writeCanonGuarded } from '../src/lib/canon-write';
import { mapObservatoryPayload } from '../src/lib/observations';
import { invalidateFileSystemCache } from '../src/lib/host/tauri-fs';

vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: vi.fn(async () => null) }));

/** 观测镜「并入」的真实写入路径：作者已确认。 */
function mergeProposalIntoCanon(projectPath: string, target: CanonMergeTarget) {
  return writeCanonGuarded({
    projectPath,
    edit: (canon) => applyCanonMerge(canon, target),
    confirm: async () => true,
    summary: '并入',
  });
}

function withMockFs(
  files: Record<string, string>,
  run: (writes: { path: string; content: string }[]) => Promise<void>,
) {
  const writes: { path: string; content: string }[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __STORYFORGE_MOCK_FS__: {
        pathExists: async (path: string) => path in files,
        readFile: async (path: string) => {
          if (!(path in files)) throw new Error(`missing: ${path}`);
          return files[path];
        },
        writeFile: async (path: string, content: string) => {
          writes.push({ path, content });
          files[path] = content;
        },
      },
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  return run(writes).finally(() => {
    invalidateFileSystemCache();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
}

test('canon declaration path follows the project separator style', () => {
  assert.equal(
    canonDeclarationPathFor('D:\\Books\\雾港回声'),
    'D:\\Books\\雾港回声\\.storyforge\\canon\\canon.json',
  );
  assert.equal(
    canonDeclarationPathFor('/home/kanye/books/雾港回声'),
    '/home/kanye/books/雾港回声/.storyforge/canon/canon.json',
  );
});

test('merging an entity keeps every backend field, not just the card fields', () => {
  const canon = { version: 1, entities: [], invariants: {} };
  const merged = applyCanonMerge(canon, {
    kind: 'entity',
    entity: { id: 'ent_radio', canonical_name: '旧电台', kind: 'item', aliases: ['电台'] },
  });
  assert.deepEqual(merged.entities, [
    { id: 'ent_radio', canonical_name: '旧电台', kind: 'item', aliases: ['电台'] },
  ]);
});

test('merging is a no-op when the author already declared that entity', () => {
  const canon = {
    version: 1,
    entities: [{ id: 'ent_radio', canonical_name: '作者自己写的名字' }],
    invariants: {},
  };
  const merged = applyCanonMerge(canon, {
    kind: 'entity',
    entity: { id: 'ent_radio', canonical_name: '提案里的名字' },
  });
  // 作者已有的声明优先：不覆盖、不追加。
  assert.equal(merged, canon);
});

test('merging a claim appends under its invariant and dedupes by content', () => {
  const first = applyCanonMerge(
    { version: 1, entities: [], invariants: {} },
    { kind: 'claim', invariant: 'lifespan', entry: { entity: 'char_b', exits_after_chapter: 9 } },
  );
  assert.deepEqual(first.invariants, {
    lifespan: [{ entity: 'char_b', exits_after_chapter: 9 }],
  });

  const again = applyCanonMerge(first, {
    kind: 'claim',
    invariant: 'lifespan',
    entry: { entity: 'char_b', exits_after_chapter: 9 },
  });
  assert.equal(again, first);
});

test('merge writes canon.json even when the file is missing', async () => {
  await withMockFs({}, async (writes) => {
    await mergeProposalIntoCanon('D:\\Books\\雾港回声', {
      kind: 'entity',
      entity: { id: 'ent_radio', canonical_name: '旧电台' },
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, 'D:\\Books\\雾港回声\\.storyforge\\canon\\canon.json');
    const written = JSON.parse(writes[0].content);
    assert.deepEqual(written.entities, [{ id: 'ent_radio', canonical_name: '旧电台' }]);
    assert.equal(writes[0].content.endsWith('\n'), true);
  });
});

test('merge preserves author fields already in canon.json', async () => {
  const path = 'D:\\Books\\雾港回声\\.storyforge\\canon\\canon.json';
  const existing = JSON.stringify({
    version: 1,
    entities: [{ id: 'char_lin', canonical_name: '林岚' }],
    invariants: { single_holder: [{ item: 'ent_knife', holder: 'char_lin' }] },
    author_note: '别动我这个字段',
  });
  await withMockFs({ [path]: existing }, async (writes) => {
    await mergeProposalIntoCanon('D:\\Books\\雾港回声', {
      kind: 'entity',
      entity: { id: 'ent_radio', canonical_name: '旧电台' },
    });
    const written = JSON.parse(writes[0].content);
    assert.equal(written.author_note, '别动我这个字段');
    assert.equal(written.entities.length, 2);
    assert.deepEqual(written.invariants.single_holder, [{ item: 'ent_knife', holder: 'char_lin' }]);
  });
});

test('canon.json 手改到一半解析不出来：拒绝并入，原文一个字不动', async () => {
  const path = 'D:\\Books\\雾港回声\\.storyforge\\canon\\canon.json';
  const broken = '{ "entities": [{ "id": "char_lin", }] ';
  await withMockFs({ [path]: broken }, async (writes) => {
    await assert.rejects(
      mergeProposalIntoCanon('D:\\Books\\雾港回声', {
        kind: 'claim',
        invariant: 'timeline_order',
        entry: { before: 'a', after: 'b' },
      }),
      (error: unknown) =>
        error instanceof CanonUnreadableError && /不是合法的 JSON.*没有写入/.test(error.message),
    );
    assert.equal(writes.length, 0);
  });
});

test('canon.json 字段在、但类型不对（作者手改过）：拒绝并入，原文一个字不动', async () => {
  const path = 'D:\\Books\\雾港回声\\.storyforge\\canon\\canon.json';
  const cases: [string, CanonMergeTarget][] = [
    [
      JSON.stringify({ entities: { char_lin: { note: '作者写的人物' } } }),
      { kind: 'entity', entity: { id: 'ent_radio' } },
    ],
    [
      JSON.stringify({ invariants: [{ note: '写成了数组' }] }),
      { kind: 'claim', invariant: 'timeline_order', entry: { before: 'a', after: 'b' } },
    ],
    [
      JSON.stringify({ invariants: { timeline_order: { before: 'x', after: 'y' } } }),
      { kind: 'claim', invariant: 'timeline_order', entry: { before: 'a', after: 'b' } },
    ],
  ];
  for (const [raw, target] of cases)
    await withMockFs({ [path]: raw }, async (writes) => {
      await assert.rejects(
        mergeProposalIntoCanon('D:\\Books\\雾港回声', target),
        /不是(数组|对象).*没有写入/,
      );
      assert.equal(writes.length, 0);
    });
  assert.throws(
    () => applyPromiseResolved({ invariants: { promises: { id: 'p1' } } }, 'p1', 3),
    /invariants\.promises 不是数组/,
  );
});

test('标伏笔已回收只改那一条的状态与回收章，其余字段原样', () => {
  const canon = {
    version: 1,
    invariants: {
      promises: [
        { id: ' p1 ', title: '旧钥匙', status: 'planted', planted_chapter: 2, note: '作者备注' },
        { id: 'p2', title: '电台', status: 'planted' },
      ],
      lifespan: [{ entity: 'char_a', exits_after_chapter: 3 }],
    },
  };
  const next = applyPromiseResolved(canon, 'p1', 5);
  const promises = (next.invariants as { promises: Record<string, unknown>[] }).promises;
  assert.deepEqual(promises[0], {
    id: ' p1 ',
    title: '旧钥匙',
    status: 'resolved',
    planted_chapter: 2,
    note: '作者备注',
    resolved_chapter: 5,
  });
  assert.deepEqual(promises[1], { id: 'p2', title: '电台', status: 'planted' });
  assert.deepEqual((next.invariants as { lifespan: unknown }).lifespan, canon.invariants.lifespan);
  assert.throws(() => applyPromiseResolved(canon, 'p9', 5), /找不到伏笔「p9」.*没有写入/);
});

test('assertion evidence survives observatory mapping, author merge and disk JSON roundtrip', async () => {
  const metadata = {
    assertion_type: 'model_inference',
    evidence: [{ path: '正文/第01章.md', start_line: 2, end_line: 3, quote: '他似乎已把刀交出。' }],
  };
  const entity = { id: 'char_new', canonical_name: '新客', ...metadata };
  const entry = { item: '刀', holder: 'char_new', from_chapter: 1, ...metadata };
  const data = mapObservatoryPayload(
    {
      proposals: {
        available: true,
        new_entities: [entity],
        new_invariants: { single_holder: [entry] },
        pending_count: 2,
      },
    },
    new Set(),
  );
  const path = canonDeclarationPathFor('D:\\Books\\证据回归');
  await withMockFs({}, async (writes) => {
    await mergeProposalIntoCanon('D:\\Books\\证据回归', {
      kind: 'entity',
      entity: data.proposals.newEntities[0].raw,
    });
    await mergeProposalIntoCanon('D:\\Books\\证据回归', {
      kind: 'claim',
      ...data.proposals.newClaims[0],
    });
    assert.equal(writes.at(-1)?.path, path);
    const saved = JSON.parse(writes.at(-1)!.content);
    assert.deepEqual(saved.entities, [entity]);
    assert.deepEqual(saved.invariants.single_holder, [entry]);
    const again = applyCanonMerge(saved, { kind: 'claim', ...data.proposals.newClaims[0] });
    assert.equal(again, saved);
    assert.equal(saved.invariants.single_holder[0].assertion_type, 'model_inference');
  });
});

test('同 ID 伏笔的不同状态拒绝追加，保留作者文件原字节', async () => {
  const path = canonDeclarationPathFor('/books/promise');
  const original = { id: 'p1', title: '旧钥匙', status: 'planted' };
  const text =
    JSON.stringify({ version: 1, invariants: { promises: [original] } }, null, 3) + '\r\n';
  await withMockFs({ [path]: text }, async (writes) => {
    await assert.rejects(
      mergeProposalIntoCanon('/books/promise', {
        kind: 'claim',
        invariant: 'promises',
        entry: { ...original, status: 'resolved' },
      }),
      /相同 ID.*canon.json.*未写入/,
    );
    assert.equal(writes.length, 0);
  });
});

test('伏笔 ID 与 scanner 一样去空白，缺失 ID 不臆造身份', () => {
  const canon = { invariants: { promises: [{ id: ' p1 ', status: 'planted' }] } };
  assert.throws(
    () =>
      applyCanonMerge(canon, {
        kind: 'claim',
        invariant: 'promises',
        entry: { id: 'p1', status: 'resolved' },
      }),
    /相同 ID/,
  );
  const noId = applyCanonMerge(
    { invariants: { promises: [{ title: '旧声明' }] } },
    {
      kind: 'claim',
      invariant: 'promises',
      entry: { title: '不同声明' },
    },
  );
  assert.equal((noId.invariants as { promises: unknown[] }).promises.length, 2);
});

test('已有无效重复不清洗：相同声明仍 no-op，新 ID 和其他声明仍可并入', () => {
  const original = { id: 'p1', status: 'planted' };
  const canon = { invariants: { promises: [original, { id: 'p1', status: 'advancing' }] } };
  assert.equal(
    applyCanonMerge(canon, { kind: 'claim', invariant: 'promises', entry: original }),
    canon,
  );
  assert.throws(
    () =>
      applyCanonMerge(canon, {
        kind: 'claim',
        invariant: 'promises',
        entry: { id: 'p1', status: 'resolved' },
      }),
    /相同 ID/,
  );
  const fresh = applyCanonMerge(canon, {
    kind: 'claim',
    invariant: 'promises',
    entry: { id: 'p2' },
  });
  assert.deepEqual((fresh.invariants as { promises: unknown[] }).promises, [
    ...canon.invariants.promises,
    { id: 'p2' },
  ]);
  const other = applyCanonMerge(canon, {
    kind: 'claim',
    invariant: 'lifespan',
    entry: { id: 'p1', entity: 'char_a', exits_after_chapter: 3 },
  });
  assert.deepEqual(
    (other.invariants as { promises: unknown[] }).promises,
    canon.invariants.promises,
  );
});

test('伏笔身份只剥离 Python str.strip 空白，保留 BOM 等非空白字符', () => {
  const spaces =
    '\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000';
  for (const space of spaces) {
    const canon = { invariants: { promises: [{ id: `${space}p1${space}`, status: 'planted' }] } };
    assert.throws(
      () =>
        applyCanonMerge(canon, {
          kind: 'claim',
          invariant: 'promises',
          entry: { id: 'p1', status: 'resolved' },
        }),
      /相同 ID/,
    );
    assert.throws(
      () =>
        applyCanonMerge(
          { invariants: { promises: [{ id: 'p1' }] } },
          { kind: 'claim', invariant: 'promises', entry: { id: `${space}p1${space}` } },
        ),
      /相同 ID/,
    );
  }
  for (const distinct of ['\ufeff', '\u200b']) {
    const original = { id: `${distinct}p1${distinct}` };
    const merged = applyCanonMerge(
      { invariants: { promises: [original] } },
      { kind: 'claim', invariant: 'promises', entry: { id: 'p1' } },
    );
    assert.deepEqual((merged.invariants as { promises: unknown[] }).promises, [
      original,
      { id: 'p1' },
    ]);
  }
});
