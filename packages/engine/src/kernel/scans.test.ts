import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-scans.windows.json';
import type { EncodedFile } from './contextFixture.test-support';
import { FsToolError } from './fsTools';
import { memoryProject } from './memoryProject.test-support';
import { buildPromiseLedger, checkPromises, promiseCheck } from './promiseScan';
import { checkProseStaticQuality, proseStaticScan } from './proseScan';
import { collapseScan, entityBudgetScan } from './sceneChecks';
import type { JsonObject } from './json';

type Call = {
  fn: string;
  args: Record<string, never>;
  output_json?: string;
  error?: { type: string; message: string };
  writes: Record<string, EncodedFile | null>;
};
type ProjectRecord = { id: string; files: Record<string, EncodedFile>; calls: Call[] };
const projects = golden.projects as unknown as ProjectRecord[];
const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';

function execute(project: ReturnType<typeof memoryProject>, call: Call): Promise<unknown> {
  const { reader } = project;
  const { path, ...args } = call.args;
  switch (call.fn) {
    case 'prose_static_scan':
      return proseStaticScan(reader, ROOT, path);
    case 'collapse_scan':
      return collapseScan(reader, ROOT, path, {
        beats: args.beats,
        emotionBefore: args.emotion_before,
        emotionAfter: args.emotion_after,
        irreversibleConsequence: args.irreversible_consequence,
        deletable: args.deletable,
      });
    case 'entity_budget_scan':
      return entityBudgetScan(reader, ROOT, path, {
        chapter: args.chapter,
        newKeyCharacters: args.new_key_characters,
        newCoreLocations: args.new_core_locations,
        newCoreEvidence: args.new_core_evidence,
        newMajorReversals: args.new_major_reversals,
        newMysteries: args.new_mysteries,
        newEquipment: args.new_equipment,
        budgetKeyCharacters: args.budget_key_characters,
        budgetCoreLocations: args.budget_core_locations,
        budgetCoreEvidence: args.budget_core_evidence,
        budgetMajorReversals: args.budget_major_reversals,
      });
    case 'promise_check':
      return promiseCheck(reader, ROOT, {
        platform,
        staleAfterChapters: args.stale_after_chapters,
      });
    default:
      throw new Error(`Unknown oracle call ${call.fn}`);
  }
}

describe('real Python scan replay', () => {
  for (const record of projects) {
    describe(record.id, () => {
      const project = memoryProject(ROOT, record.files);
      for (const [index, call] of record.calls.entries()) {
        it(`#${index} ${call.fn} ${JSON.stringify(call.args)}`, async () => {
          if (call.error) {
            await expect(execute(project, call)).rejects.toThrow(FsToolError);
            await expect(execute(project, call)).rejects.toThrow(call.error.message);
          } else {
            expect(await execute(project, call)).toEqual(JSON.parse(call.output_json!));
          }
          expect(project.takeWrites()).toEqual({});
          expect(call.writes).toEqual({});
        });
      }
    });
  }
});

type PureCase = {
  fn: string;
  id: string;
  text?: string;
  kwargs?: Record<string, never>;
  canon?: JsonObject;
  current_chapter?: number;
  stale_after_chapters?: number;
  output: unknown;
  ledger?: unknown;
};

describe('real Python pure scan functions', () => {
  for (const row of golden.pure as unknown as PureCase[]) {
    it(`${row.fn} ${row.id}`, async () => {
      if (row.fn === 'check_prose_static_quality') {
        const kwargs = row.kwargs!;
        expect(
          checkProseStaticQuality(row.text!, {
            characterConstraints: kwargs.character_constraints,
            continuityFacts: kwargs.continuity_facts,
            requiredFacts: kwargs.required_facts,
            sceneBeats: kwargs.scene_beats,
            endingHook: kwargs.ending_hook,
          }),
        ).toEqual(row.output);
      } else {
        const canon = (row.canon ?? golden.promise_canon) as unknown as JsonObject;
        const output = await checkPromises(canon, row.current_chapter!, row.stale_after_chapters);
        expect(output).toEqual(row.output);
        expect(buildPromiseLedger(canon, output)).toEqual(row.ledger);
      }
    });
  }
});
