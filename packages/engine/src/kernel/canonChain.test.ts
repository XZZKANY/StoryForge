import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-canon-chain.windows.json';
import {
  formatChapterWindow,
  normalizeAssertionMetadata,
  renderAssertionMetadata,
} from './canonAssertions';
import { buildSceneConstraintBlock } from './canonContext';
import { rebuildPresence } from './canonRebuild';
import { buildCanonProjection } from './canonService';
import { consistencyScan } from './consistencyScan';
import {
  currentCanonOrderBytes,
  decodeFixtureBytes,
  type EncodedFile,
} from './contextFixture.test-support';
import { FsToolError } from './fsTools';
import { GenerationSourceCapture } from './generationSources';
import { isJsonObject, parseJson, type JsonObject } from './json';
import { memoryProject } from './memoryProject.test-support';

type Call = {
  fn: string;
  args: Record<string, unknown>;
  output_json?: string;
  error?: { type: string; message: string };
  writes: Record<string, EncodedFile | null>;
};
type ProjectRecord = { id: string; files: Record<string, EncodedFile>; calls: Call[] };
const projects = golden.projects as unknown as ProjectRecord[];
const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const absolute = (path: string) => `${ROOT}\\${path.replace(/\//g, '\\')}`;
const stable = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).split(JSON.stringify(ROOT).slice(1, -1)).join('$ROOT'));

async function execute(project: ReturnType<typeof memoryProject>, call: Call): Promise<unknown> {
  const { reader, writer } = project;
  const args = call.args as Record<string, never>;
  switch (call.fn) {
    case 'consistency_scan':
      return consistencyScan(reader, ROOT, args.terms, {
        platform,
        subpath: args.subpath,
        glob: args.glob,
      });
    case 'canon_projection':
      return (await buildCanonProjection(reader, writer, ROOT, { ...args, platform })).output;
    case 'rebuild_presence': {
      const entities = parseJson(JSON.stringify(args.entities), 'entities');
      return rebuildPresence(reader, ROOT, (entities as JsonObject[]).filter(isJsonObject), {
        platform,
      });
    }
    case 'scene_constraints': {
      const capture = await GenerationSourceCapture.create({
        root: ROOT,
        platform,
        secrets: { values: [] },
      });
      const current = args.current_file as string | null;
      const block = await buildSceneConstraintBlock(
        reader,
        ROOT,
        current === null ? null : args.absolute ? absolute(current) : current,
        { platform, capture },
      );
      return {
        block,
        sources: capture.sources,
        selections: capture.selections,
        projections: capture.projections.map(([row, text]) => ({ row, text })),
      };
    }
    default:
      throw new Error(`Unknown oracle call ${call.fn}`);
  }
}

describe('real Python canon chain replay', () => {
  for (const record of projects) {
    it(record.id, async () => {
      const project = memoryProject(ROOT, record.files);
      for (const [index, call] of record.calls.entries()) {
        const label = `${record.id}#${index} ${call.fn} ${JSON.stringify(call.args)}`;
        if (call.fn === 'author_write') {
          project.apply(call.writes);
          continue;
        }
        if (call.error) {
          await expect(execute(project, call), label).rejects.toThrow(FsToolError);
          await expect(execute(project, call), label).rejects.toThrow(call.error.message);
        } else {
          const output = await execute(project, call);
          const expected = JSON.parse(call.output_json!);
          // Unicode数字待写章按自然序插入：第１２章在已有012之后，第٣章在003之后，
          // 均早于第20章退场窗口。旧Python oracle保留，不再沿用其码点末尾插入结果。
          if (
            record.id === 'long-provenance' &&
            call.fn === 'scene_constraints' &&
            ['正文/第１２章.md', '正文/第٣章.md'].includes(String(call.args.current_file))
          ) {
            expected.block = null;
            expected.selections[0].value.current_ordinal =
              call.args.current_file === '正文/第１２章.md' ? 13 : 4;
            expected.projections = [
              {
                row: {
                  purpose: 'canon_constraints',
                  channel: 'user',
                  source_ids: [],
                  requested_source_count: 0,
                  selected_source_count: 0,
                  source_span: null,
                  truncated: false,
                  omission_reason: 'no_active_constraints',
                  transformation: 'identity',
                },
                text: null,
              },
            ];
          }
          expect(stable(output), label).toEqual(expected);
        }
        const writes = project.takeWrites();
        expect(Object.keys(writes).sort(), label).toEqual(Object.keys(call.writes).sort());
        for (const [path, file] of Object.entries(call.writes)) {
          expect(file, label).not.toBeNull();
          const bytes = currentCanonOrderBytes(path, decodeFixtureBytes(file!));
          const expected = new TextDecoder().decode(bytes);
          expect(new TextDecoder().decode(writes[path]), `${label} ${path}`).toBe(expected);
          expect(writes[path], `${label} ${path}`).toEqual(bytes);
        }
      }
    });
  }
});

describe('real Python canon assertion metadata', () => {
  for (const [index, row] of golden.assertions.entries()) {
    it(`${index} ${row.fn} ${row.entry_json}`, () => {
      const entry = parseJson(row.entry_json, 'entry') as JsonObject;
      if (row.fn === 'normalize') {
        if ('error' in row) {
          expect(() => normalizeAssertionMetadata(entry, row.label)).toThrow(FsToolError);
          expect(() => normalizeAssertionMetadata(entry, row.label)).toThrow(row.error as string);
        } else {
          const output = normalizeAssertionMetadata(entry, row.label);
          expect(JSON.parse(JSON.stringify(output))).toEqual(JSON.parse(row.output_json as string));
        }
      } else if (row.fn === 'render') {
        expect(renderAssertionMetadata(entry)).toBe(row.output);
      } else {
        expect(formatChapterWindow(entry)).toBe(row.output);
      }
    });
  }
});
