import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-context.windows.json';
import { buildBookContext } from './buildBookContext';
import { toBookContextPayload } from './bookContext';
import { captureCanonSourceRevision } from './canonStore';
import { contextFixtureReader } from './contextFixture.test-support';
import {
  CACHE_INVALID_ORACLE,
  contextExpectation,
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
      const { reader, root, trace } = contextFixtureReader(fixture);
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
        expect(facts(context)).toEqual(source.context_typed!);
        const payload = context === null ? null : toBookContextPayload(context);
        expect(payload).toEqual(JSON.parse(source.payload_json!));
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
          REVISION_UNKNOWN.has(fixture.id) ? null : fixture.source_revision,
        );
    });
  }
});

const base = () =>
  contextFixtureReader({
    files: { '正文/01.md': { chunks: [{ base64: btoa('abcdef'), repeat: 1 }] } },
    missing_root: false,
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
