import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-style.windows.json';
import {
  authorEditPolicyFailures,
  authorEditPolicyPrompt,
  authorEditPolicySummary,
  AuthorEditPolicyError,
  buildAuthorEditPolicy,
  type AuthorEditPolicy,
} from './authorEditPolicy';
import {
  appendAuthorInstructionsToSystemPrompt,
  buildGenerationSystemPrompt,
  editPolicyFromGenerationPrompt,
  GENERATION_PREFIX,
  readAuthorInstructions,
} from './authorVoice';
import type { EncodedFile } from './contextFixture.test-support';
import {
  craftPromptClause,
  reviewRubricClause,
  sceneDisciplineClause,
  sceneDisciplineGuardClause,
} from './craft';
import { GenerationDeliveryCapture, generationDeliveryReference } from './generationDelivery';
import { GenerationSourceCapture } from './generationSources';
import { parseJson, pythonFloatRepr, type JsonObject } from './json';
import { pythonFloatSum } from './math';
import { memoryProject } from './memoryProject.test-support';
import {
  isRoleAllowedTool,
  listAgentRoles,
  listSubagentRoles,
  normalizeAgentRoleInputs,
  resolveAgentRoleAlias,
} from './roleCatalog';
import { agentPlanPayload, listAgentSkills } from './skillCatalog';
import {
  buildStyleBaseline,
  splitSentences,
  styleBaselineClause,
  styleFingerprint,
} from './styleBaseline';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';

/** TS 下标是 UTF-16 码元，Python 是码点：比较前换算。 */
const codePointOffset = (text: string, offset: number) => Array.from(text.slice(0, offset)).length;

function policyDict(policy: AuthorEditPolicy, original: string) {
  return {
    ...authorEditPolicySummary(policy),
    author_requirements: policy.author_requirements,
    instruction: policy.instruction,
    baseline: policy.baseline,
    protected_spans: policy.protected_spans.map((span) => [
      codePointOffset(original, span.start),
      codePointOffset(original, span.end),
    ]),
    prompt: authorEditPolicyPrompt(policy),
  };
}

type PureRow = { fn: string; args_json: string; output_json?: string; error?: { message: string } };

function runPure(row: PureRow): unknown {
  const args = JSON.parse(row.args_json);
  switch (row.fn) {
    case 'craft':
      if (args.fn === 'craft_prompt_clause')
        return craftPromptClause({ withExamples: args.with_examples });
      if (args.fn === 'scene_discipline_clause') return sceneDisciplineClause();
      if (args.fn === 'scene_discipline_guard_clause') return sceneDisciplineGuardClause();
      return reviewRubricClause(args.key);
    case 'float_sum':
      return pythonFloatRepr(pythonFloatSum(JSON.parse(args.values_json)));
    case 'fingerprint':
      return { fingerprint: styleFingerprint(args.text), sentences: splitSentences(args.text) };
    case 'policy':
      return policyDict(
        buildAuthorEditPolicy(args.original, {
          instruction: args.instruction,
          authorRequirements: args.requirements,
          baseline: args.baseline,
        }),
        args.original,
      );
    case 'failures': {
      const policy = buildAuthorEditPolicy(golden_original(), { instruction: args.instruction });
      return authorEditPolicyFailures(args.original, args.candidate, policy);
    }
    case 'edit_policy_from_prompt':
      return policyDict(
        editPolicyFromGenerationPrompt(args.original, {
          instruction: '改为第一人称',
          systemPrompt: args.system_prompt,
          admittedAuthorRequirements: args.admitted,
        }),
        args.original,
      );
    case 'delivery':
      return JSON.parse(generationDeliveryReference(args.id, args.manifest));
    case 'delivery_bind': {
      const manifest = JSON.parse(
        (golden.pure as PureRow[]).find((item) => item.fn === 'delivery')!.args_json,
      ).manifest;
      const seen: unknown[] = [];
      const capture = new GenerationDeliveryCapture((refs) => seen.push(refs));
      const before = capture.bind({ a: 1, generation_delivery_refs: ['forged'] });
      capture.record(3, manifest);
      capture.record(4, { ...manifest, version: 'v2' });
      return { before, after: capture.bind({ generation_delivery_refs: ['forged'], b: 2 }), seen };
    }
    case 'roles':
      return args.fn === 'subagents'
        ? listSubagentRoles().map((role) => role.name)
        : listAgentRoles();
    case 'normalize_roles':
      return normalizeAgentRoleInputs(args);
    case 'role_tool':
      return isRoleAllowedTool(args.role, args.tool);
    case 'role_alias':
      return resolveAgentRoleAlias(args.alias);
    case 'skills':
      return listAgentSkills();
    case 'plan_payload':
      return agentPlanPayload({
        intent: args.intent,
        goal: args.goal,
        scope: args.scope,
        plan: [{ step: 's' }],
      });
    default:
      throw new Error(`Unknown pure oracle ${row.fn}`);
  }
}

function golden_original(): string {
  const row = (golden.pure as PureRow[]).find((item) => item.fn === 'failures')!;
  return JSON.parse(row.args_json).original;
}

describe('real Python style / strategy pure functions', () => {
  for (const [index, row] of (golden.pure as PureRow[]).entries()) {
    it(`${index} ${row.fn} ${row.args_json.slice(0, 60)}`, () => {
      if (row.error) {
        // Python 的 KeyError 文本带引号（repr），TS 只给键名。
        expect(() => runPure(row)).toThrow(row.error.message.replace(/^'(.*)'$/, '$1'));
        if (row.fn === 'policy') expect(() => runPure(row)).toThrow(AuthorEditPolicyError);
        return;
      }
      expect(runPure(row)).toEqual(JSON.parse(row.output_json!));
    });
  }
});

type Call = { fn: string; args: Record<string, unknown>; output_json?: string; writes: object };
const projects = golden.projects as unknown as {
  id: string;
  files: Record<string, EncodedFile>;
  calls: Call[];
}[];

async function withCapture(run: (capture: GenerationSourceCapture) => Promise<unknown>) {
  const capture = await GenerationSourceCapture.create({
    root: ROOT,
    platform,
    secrets: { values: [] },
  });
  const value = await run(capture);
  return {
    value,
    sources: capture.sources,
    selections: capture.selections,
    projections: capture.projections.map(([row, text]) => ({ row, text })),
  };
}

describe('real Python style / voice project replay', () => {
  for (const record of projects) {
    describe(record.id, () => {
      const project = memoryProject(ROOT, record.files);
      const { reader } = project;
      for (const [index, call] of record.calls.entries()) {
        it(`#${index} ${call.fn}`, async () => {
          const root = 'project' in call.args ? null : ROOT;
          let output: unknown;
          if (call.fn === 'baseline')
            output = await withCapture(async (capture) => {
              const baseline = await buildStyleBaseline(reader, root, { platform, capture });
              return baseline === null
                ? null
                : { ...baseline, clause: styleBaselineClause(baseline) };
            });
          else if (call.fn === 'generation_prompt')
            output = await withCapture((capture) =>
              buildGenerationSystemPrompt(reader, '基础提示。', root, { platform, capture }),
            );
          else if (call.fn === 'author_instructions')
            output = await withCapture((capture) => readAuthorInstructions(reader, root, capture));
          else
            output = await withCapture((capture) =>
              appendAuthorInstructionsToSystemPrompt(reader, '基础', root, capture),
            );
          expect(output).toEqual(JSON.parse(call.output_json!));
          expect(project.takeWrites()).toEqual({});
        });
      }
    });
  }
});

it('records an author-instructions link that escapes the project as outside_project', async () => {
  const project = memoryProject(ROOT, {});
  const reader = {
    ...project.reader,
    resolveProjectPath: async (root: string, path: string) => {
      if (path === '.storyforge/agent-instructions.md')
        throw new (await import('../readPort')).ProjectReadError('outside', 'outside-project');
      return project.reader.resolveProjectPath(root, path);
    },
  };
  const output = await withCapture((capture) => readAuthorInstructions(reader, ROOT, capture));
  expect(output.value).toBeNull();
  expect(output.sources).toMatchObject([
    { relative_path: null, omission_reason: 'outside_project' },
  ]);
  expect(output.projections).toMatchObject([{ row: { omission_reason: 'unreadable_source' } }]);
});

it('keeps the generation prefix and parsed JSON helpers in sync', () => {
  expect(GENERATION_PREFIX.endsWith('\n')).toBe(true);
  expect((parseJson('{"a":1}', 'x') as JsonObject).a).toBe(1);
});
