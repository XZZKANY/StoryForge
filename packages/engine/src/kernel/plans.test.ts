import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-plans.windows.json';
import { canonDelta, readPendingProposals } from './canonDelta';
import { evaluateHookAdmission, hooksDelta } from './canonHooksDelta';
import { decodeFixtureBytes, type EncodedFile } from './contextFixture.test-support';
import { FsToolError } from './fsTools';
import { parseJson, type JsonObject, type JsonValue } from './json';
import { memoryProject } from './memoryProject.test-support';
import { runObservatoryScan } from './observatory';
import { buildPlan, buildPlanBlock, toPlanPayload } from './serialPlan';
import {
  applyPlanUpdate,
  markChapterWritten,
  mergePlanPayload,
  rejectPrematureDone,
  unmarkChapterWritten,
} from './serialPlanUpdate';

type Call = {
  fn: string;
  args: Record<string, never>;
  args_json?: string;
  output_json?: string;
  error?: { type: string; message: string };
  writes: Record<string, EncodedFile | null>;
};
type ProjectRecord = { id: string; files: Record<string, EncodedFile>; calls: Call[] };
const projects = golden.projects as unknown as ProjectRecord[];
const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const clocks = golden.fixed_now.map(
  ([year, month, day, hour, minute, second, micro]) =>
    new Date(Date.UTC(year, month - 1, day, hour, minute, second, micro / 1000)),
);
const stable = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).split(JSON.stringify(ROOT).slice(1, -1)).join('$ROOT'));

async function execute(project: ReturnType<typeof memoryProject>, call: Call): Promise<unknown> {
  const { reader, writer } = project;
  const args = (call.args_json ? parseJson(call.args_json, 'args') : call.args) as Record<
    string,
    never
  >;
  const target = (path: string) => (args.absolute ? `${ROOT}\\${path.replace(/\//g, '\\')}` : path);
  switch (call.fn) {
    case 'canon_delta':
      return canonDelta(
        reader,
        writer,
        ROOT,
        {
          entities: args.entities,
          holderClaims: args.holder_claims,
          exitClaims: args.exit_claims,
          timelineClaims: args.timeline_claims,
          promiseClaims: args.promise_claims,
        },
        platform,
      );
    case 'read_pending_proposals':
      return readPendingProposals(reader, ROOT);
    case 'hooks_delta':
      return hooksDelta(reader, ROOT, {
        observedHooks: args.observed_hooks,
        evidenceText: args.evidence_text,
      });
    case 'observatory_scan':
      return runObservatoryScan(reader, writer, ROOT, { platform, now: () => clocks[args.clock] });
    case 'plan_view': {
      const plan = await buildPlan(reader, ROOT, platform);
      return {
        block: await buildPlanBlock(reader, ROOT, platform),
        payload: plan === null ? null : toPlanPayload(plan),
      };
    }
    case 'apply_plan_update':
      return applyPlanUpdate(
        reader,
        writer,
        ROOT,
        {
          chapters: args.chapters,
          premise: args.premise,
          chapterWordCountMin: args.chapter_word_count_min,
          chapterWordCountMax: args.chapter_word_count_max,
          arcs: args.arcs,
          removeOrdinals: args.remove_ordinals,
        },
        platform,
      );
    case 'mark_chapter_written':
      return markChapterWritten(reader, writer, ROOT, target(args.path), platform);
    case 'unmark_chapter_written':
      return unmarkChapterWritten(reader, writer, ROOT, target(args.path), platform);
    default:
      throw new Error(`Unknown oracle call ${call.fn}`);
  }
}

describe('real Python proposal / plan / observatory replay', () => {
  for (const record of projects) {
    describe(record.id, () => {
      const project = memoryProject(ROOT, record.files);
      for (const [index, call] of record.calls.entries()) {
        it(`#${index} ${call.fn} ${JSON.stringify(call.args).slice(0, 80)}`, async () => {
          if (call.fn === 'author_write') {
            project.apply(call.writes);
            return;
          }
          if (call.error) {
            await expect(execute(project, call)).rejects.toThrow(FsToolError);
            await expect(execute(project, call)).rejects.toThrow(call.error.message);
          } else {
            expect(stable(await execute(project, call))).toEqual(JSON.parse(call.output_json!));
          }
          const writes = project.takeWrites();
          expect(Object.keys(writes).sort()).toEqual(Object.keys(call.writes).sort());
          for (const [path, file] of Object.entries(call.writes)) {
            const expected = decodeFixtureBytes(file!);
            expect(new TextDecoder().decode(writes[path]), path).toBe(
              new TextDecoder().decode(expected),
            );
            expect(writes[path], path).toEqual(expected);
          }
        });
      }
    });
  }
});

type PureCase = {
  fn: string;
  existing?: JsonObject;
  hook?: JsonObject;
  updates?: Record<string, never>;
  merged_json?: string;
  counts?: unknown;
  chapters?: JsonValue[] | null;
  written?: number[];
  output?: unknown;
};

describe('real Python pure proposal / plan functions', () => {
  for (const [index, row] of (golden.pure as unknown as PureCase[]).entries()) {
    it(`${index} ${row.fn}`, () => {
      if (row.fn === 'evaluate_hook_admission') {
        expect(evaluateHookAdmission(row.existing!, row.hook!)).toEqual(row.output);
      } else if (row.fn === 'merge_plan_payload') {
        const updates = row.updates!;
        const { merged, counts } = mergePlanPayload(row.existing!, {
          chapters: updates.chapters,
          chapterWordCountMin: updates.chapter_word_count_min,
          removeOrdinals: updates.remove_ordinals,
        });
        expect(JSON.stringify(merged)).toBe(
          row.merged_json!.replace(/, /g, ',').replace(/": /g, '":'),
        );
        expect(counts).toEqual(row.counts);
      } else {
        expect(rejectPrematureDone(row.chapters, new Set(row.written))).toEqual(row.output);
      }
    });
  }
});
