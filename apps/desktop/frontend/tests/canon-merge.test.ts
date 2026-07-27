/**
 * canon 提案并入的行为红线。此前提案区只读，agent 能读 canon.json 不能写，
 * 作者只能手改 JSON；这一层只补「作者点一下」，写盘仍由作者动作触发。
 *
 * 可证伪：
 * 1. 并入实体写全字段（不能只写卡片展示的 id/名/别名）。
 * 2. 已存在同 id / 同内容不重复追加——作者已有的声明优先。
 * 3. canon.json 缺失或损坏时按空骨架起头，写出一份格式正确的文件，而不是抛错或写坏。
 * 4. 落盘路径是 .storyforge/canon/canon.json，按项目自身分隔符风格拼。
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  applyCanonMerge,
  canonDeclarationPathFor,
  mergeProposalIntoCanon,
} from '../src/lib/canon-merge';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

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

test('merge recovers from a corrupt canon.json instead of throwing', async () => {
  const path = 'D:\\Books\\雾港回声\\.storyforge\\canon\\canon.json';
  await withMockFs({ [path]: '{ 这不是合法 JSON' }, async (writes) => {
    await mergeProposalIntoCanon('D:\\Books\\雾港回声', {
      kind: 'claim',
      invariant: 'timeline_order',
      entry: { before: 'a', after: 'b' },
    });
    const written = JSON.parse(writes[0].content);
    assert.deepEqual(written.invariants.timeline_order, [{ before: 'a', after: 'b' }]);
  });
});
