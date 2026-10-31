import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-context.windows.json';
import { buildBookContext } from './buildBookContext';
import { chapterOrdinals } from './canonRebuild';
import { memoryProject } from './memoryProject.test-support';
import { previousChapterTail } from './previousChapter';
import { toBookContextPayload } from './bookContext';
import { captureCanonSourceRevision } from './canonStore';
import { contextFixtureReader } from './contextFixture.test-support';
import {
  CACHE_INVALID_ORACLE,
  contextExpectation,
  currentPresenceVersionFixture,
  currentReadingOrderJson,
  DECLARATION_ERRORS,
  RELATIVE_ORACLE,
  REVISION_UNKNOWN,
} from './contextDomain.test-support';
import { InputDomainError } from './json';
import { ProjectReadError } from '../readPort';
import { ProjectTreeError } from './projectTree';

// Independent encoding of the public context facts; no production JSON parser/constructors.
function facts(value: unknown): { kind: string; value?: unknown } {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string')
    return { kind: 'str', value: Array.from(value, (char) => char.codePointAt(0)) };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (typeof value === 'number') return { kind: 'int', value: String(value) };
  if (Array.isArray(value)) return { kind: 'list', value: value.map(facts) };
  if (typeof value === 'object')
    return {
      kind: 'dict',
      value: Object.entries(value).map(([key, item]) => [
        Array.from(key, (char) => char.codePointAt(0)),
        facts(item),
      ]),
    };
  throw new TypeError('Non-JSON context fact');
}

it('judges every Python book.context case under the input domain', () => {
  const ids = golden.book_context.map((fixture) => fixture.id);
  expect(ids).toHaveLength(68);
  const judged = [DECLARATION_ERRORS, CACHE_INVALID_ORACLE, RELATIVE_ORACLE].map(
    (table) => Object.keys(table).filter((id) => ids.includes(id)).length,
  );
  expect(judged).toEqual([20, 19, 1]);
});

describe('real Python file-backed book.context replay', () => {
  for (const fixture of golden.book_context) {
    it(fixture.id, async () => {
      const { reader, root, trace } = contextFixtureReader(currentPresenceVersionFixture(fixture));
      const current =
        fixture.current === null
          ? null
          : fixture.current.kind === 'relative'
            ? fixture.current.path
            : `${root}/${fixture.current.path}`;
      const build = () => buildBookContext(reader, root, current, 'windows');
      const expectation = contextExpectation(fixture);
      if (expectation.kind === 'declaration-error') {
        await expect(build()).rejects.toThrow(InputDomainError);
        await expect(build()).rejects.toThrow(expectation.message);
      } else {
        const source = expectation.source;
        expect('error' in source && source.error).toBeFalsy();
        const context = await build();
        expect(facts(context)).toEqual(
          fixture.id === 'unicode-order'
            ? facts(JSON.parse(currentReadingOrderJson(fixture.id, source.context_json!)))
            : source.context_typed!,
        );
        const payload = context === null ? null : toBookContextPayload(context);
        expect(payload).toEqual(
          JSON.parse(currentReadingOrderJson(fixture.id, source.payload_json!)),
        );
        const prompt = payload?.prompt_block ?? null;
        const bytes =
          source.prompt_utf8_base64 === null
            ? null
            : Uint8Array.from(atob(source.prompt_utf8_base64!), (char) => char.charCodeAt(0));
        expect(prompt === null ? null : new TextEncoder().encode(prompt)).toEqual(bytes);
      }
      expect(fixture.write_trace).toEqual([]);
      expect(
        trace.filter(
          (event) => event.operation === 'bytes' && !event.path.startsWith('.storyforge/'),
        ).length,
      ).toBeLessThanOrEqual(1);
      if (!fixture.missing_root)
        expect(await captureCanonSourceRevision(reader, root)).toBe(
          REVISION_UNKNOWN.has(fixture.id)
            ? null
            : (fixture.source_revision?.replace(
                'canon-writeback-v1:',
                'canon-manuscript-order-v2:',
              ) ?? null),
        );
    });
  }
});

const base = () =>
  contextFixtureReader({
    files: { '正文/01.md': { chunks: [{ base64: btoa('abcdef'), repeat: 1 }] } },
    missing_root: false,
  });

it('shares mixed-padding reading order across book context, canon and both previous-tail readers', async () => {
  const encode = (text: string) => ({
    chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
  });
  const root = '/book';
  const first = '正文/第1章 旧馆.md';
  const second = '正文/第002章.md';
  const target = '正文/第003章.md';
  const project = memoryProject(root, {
    [first]: encode('第一章尾巴。'),
    [second]: encode('第二章尾巴。'),
    '正文/第10章.md': encode('未来章节。'),
  });
  expect([...(await chapterOrdinals(project.reader, root, '*.md', 'posix'))]).toEqual([
    [first, 1],
    [second, 2],
    ['正文/第10章.md', 3],
  ]);
  for (const [current, previous, tail] of [
    [second, first, '第一章尾巴。'],
    [target, second, '第二章尾巴。'],
  ]) {
    const context = await buildBookContext(project.reader, root, current, 'posix');
    expect(context?.chapters.map((chapter) => chapter.relative_path)).toEqual([
      first,
      second,
      '正文/第10章.md',
    ]);
    expect(context?.previous_chapter).toEqual([previous, tail]);
    expect(await previousChapterTail(project.reader, root, current, { platform: 'posix' })).toEqual(
      [previous, tail],
    );
  }
  expect(project.takeWrites()).toEqual({});
});

it('does not turn a programming error into an optional source', async () => {
  const { reader, root } = base();
  reader.inspectProjectPath = async () => {
    throw new TypeError('broken adapter');
  };
  await expect(buildBookContext(reader, root, null, 'windows')).rejects.toThrow('broken adapter');
});
it('returns no context for incomplete chapter traversal', async () => {
  const { reader, root } = base();
  reader.readProjectDirectory = async () => {
    throw new ProjectReadError('denied');
  };
  expect(await buildBookContext(reader, root, null, 'windows')).toBeNull();
});
it('does not suppress a knowledge traversal error after successful chapter traversal', async () => {
  const { reader, root } = base();
  const read = reader.readProjectDirectory;
  let rootReads = 0;
  reader.readProjectDirectory = async (base, path, cap) => {
    if (path === '.' && ++rootReads === 2) throw new ProjectReadError('knowledge denied');
    return read(base, path, cap);
  };
  await expect(buildBookContext(reader, root, null, 'windows')).rejects.toThrow(ProjectTreeError);
});
it('keeps a stat failure as zero size rather than discarding the chapter', async () => {
  const { reader, root } = base();
  const inspect = reader.inspectProjectPath;
  let chapterReads = 0;
  reader.inspectProjectPath = async (base, path) => {
    if (path === '正文/01.md' && ++chapterReads === 2)
      throw new ProjectReadError('moved after traversal');
    return inspect(base, path);
  };
  expect((await buildBookContext(reader, root, null, 'windows'))?.chapters).toEqual([
    { ordinal: 1, relative_path: '正文/01.md', size_bytes: 0 },
  ]);
});

it('drops the whole optional skeleton if its final stat disappears, not a fabricated zero-size entry', async () => {
  const { reader, root } = contextFixtureReader({
    files: { '大纲/总纲.md': { chunks: [{ base64: btoa('outline'), repeat: 1 }] } },
    missing_root: false,
  });
  const inspect = reader.inspectProjectPath;
  let inspections = 0;
  reader.inspectProjectPath = async (base, path) => {
    const result = await inspect(base, path);
    // General traversal, then knowledge traversal/is_file/validation/final stat.
    if (path === '大纲/总纲.md' && ++inspections === 5)
      return { ...result, entryKind: 'missing', targetKind: 'missing', sizeBytes: 0 };
    return result;
  };
  const context = await buildBookContext(reader, root, null, 'windows');
  expect(inspections).toBe(5);
  expect(context?.skeleton).toEqual([]);
  expect(context?.skeleton_total).toBe(0);
});

it('treats a presence cache holding a non-string id as invalid, not as a partial cache', async () => {
  const encode = (text: string) => ({
    chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
  });
  const canon = encode('{"entities":[{"id":"a","canonical_name":"林舟"}]}');
  const first = contextFixtureReader({
    files: { '.storyforge/canon/canon.json': canon },
    missing_root: false,
  });
  const revision = await captureCanonSourceRevision(first.reader, first.root);
  const roster = async (extra: string) => {
    const presence = `{"_storyforge_source_revision":"${revision}","entities":[{"id":"a","first_chapter":1,"last_chapter":2,"missing":false}${extra}]}`;
    const { reader, root } = contextFixtureReader({
      files: {
        '.storyforge/canon/canon.json': canon,
        '.storyforge/canon/derived/presence.json': encode(presence),
      },
      missing_root: false,
    });
    return (await buildBookContext(reader, root, null, 'windows'))!.roster[0];
  };
  expect(await roster('')).toMatchObject({ first_chapter: 1, last_chapter: 2 });
  expect(await roster(',{"id":7}')).toMatchObject({ first_chapter: null, last_chapter: null });
  expect(await roster(',{"id":null}')).toMatchObject({ first_chapter: 1, last_chapter: 2 });
});

it('accepts the optional detailKind the host now writes into a receipt outcome', async () => {
  const encode = (text: string) => ({
    chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
  });
  const operationId = '1'.repeat(64);
  const identity = { schemaVersion: 1, operationId, fingerprint: '2'.repeat(64) };
  const intent = { ...identity, relativePath: 'chapter.md', afterHash: '3'.repeat(64) };
  const revision = async (outcome: Record<string, unknown>) => {
    const { reader, root } = contextFixtureReader({
      files: {
        [`.storyforge/writeback-receipts/${operationId}.intent.json`]: encode(
          JSON.stringify(intent),
        ),
        [`.storyforge/writeback-receipts/${operationId}.outcome.json`]: encode(
          JSON.stringify({ ...identity, ...outcome }),
        ),
      },
      missing_root: false,
    });
    return captureCanonSourceRevision(reader, root);
  };
  expect(await revision({ state: 'applied', detail: null })).not.toBeNull();
  expect(
    await revision({ state: 'not_written', detail: '磁盘内容已变化', detailKind: 'drift' }),
  ).not.toBeNull();
  expect(
    await revision({
      state: 'applied',
      detail: 'canon 派生缓存未失效: locked',
      detailKind: 'canon-cache-stale',
    }),
  ).not.toBeNull();
  expect(await revision({ state: 'applied', detail: null, detailKind: 'future' })).toBeNull();
  expect(await revision({ state: 'applied', detail: null, detailKind: null })).toBeNull();
});
