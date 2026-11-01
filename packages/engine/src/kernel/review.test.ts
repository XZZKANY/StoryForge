import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-review.windows.json';
import type { EncodedFile } from './contextFixture.test-support';
import {
  checkCrossChapterConsistency,
  crossChapterReview,
  crossChapterUserPrompt,
  parseCrossChapterFindings,
} from './crossChapter';
import { LlmConfigError } from '../llm/config';
import { LlmError } from '../llm/payload';
import { FsToolError } from './fsTools';
import { InputDomainError } from './json';
import { memoryProject } from './memoryProject.test-support';
import { pythonSplitlines, pythonStrip } from './pythonText';
import { sha256Hex } from './sha256';
import {
  heuristicResult,
  llmReviewReasoner,
  parseLlmIssues,
  REVIEW_AGENT_KEYS,
  reviewSystemPrompt,
  reviewUserPrompt,
  heuristicReviewReasoner,
  type ReviewSubagentResult,
} from './reviewReasoning';
import {
  buildMultiAgentReviewReport,
  continuitySubagentHandler,
  reviewReportSummary,
} from './reviewReport';
import { reviewContextSummary, suggestedActionsForReview, type ReviewIssue } from './reviewSkills';
import {
  AgentOrchestrationError,
  composeScopedInstruction,
  verifyReviewSource,
} from './reviseDelivery';
import {
  parseOrdinal,
  publicReviseScope,
  resolveReviseScope,
  reviseDriftCounts,
  reviseDriftRatio,
  reviseSummaryWithScope,
  revisionReferencesReview,
  scopedReviseInstruction,
  scopeWarning,
} from './reviseScope';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const REPORT = golden.report as { [key: string]: unknown };
const NO_SECRETS = { values: [] };

/** Python 异常类型 → TS 错误类；JSON 解析失败的措辞不模仿（只核类型）。 */
const ERROR_TYPES: Record<string, new (...args: never[]) => Error> = {
  ValueError: RangeError,
  JSONDecodeError: InputDomainError,
  AgentOrchestrationError,
  LLMError: LlmError,
  LLMConfigError: LlmConfigError,
  FsToolError,
};

type Reply = { content?: unknown; latency_ms?: unknown } | { raise: string; message: string };

/** 按调用顺序回放脚本化模型回复；记录每次调用与中断检查点，和 Python 预言机同形。 */
function scripted(replies: Reply[]) {
  const calls: object[] = [];
  let index = 0;
  const callLlm = async (request: { systemPrompt: string; userPrompt: string }) => {
    calls.push({ system: request.systemPrompt, user: request.userPrompt });
    const reply = replies[index++];
    if ('raise' in reply)
      throw reply.raise === 'LLMConfigError'
        ? new LlmConfigError(reply.message)
        : new LlmError(reply.message);
    return { content: reply.content, latency_ms: reply.latency_ms };
  };
  const checkInterruption = () => {
    calls.push({ interrupt: 'before_review_role' });
  };
  return { calls, callLlm, checkInterruption };
}

const paragraphsOf = (text: string) => pythonSplitlines(text).map(pythonStrip).filter(Boolean);

const executor = {
  async run(role: string, payload: { [key: string]: unknown }) {
    if (role === 'continuity_reviewer') return continuitySubagentHandler(payload.content);
    return { issues: (payload.result as ReviewSubagentResult).issues };
  },
};

type PureRow = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string };
};

async function runPure(row: PureRow): Promise<unknown> {
  const args = JSON.parse(row.args_json);
  switch (row.fn) {
    case 'context_summary':
      return reviewContextSummary(args.bundle);
    case 'heuristics':
      return REVIEW_AGENT_KEYS.map((key) =>
        heuristicResult(key, args.content, paragraphsOf(args.content), args.bundle),
      );
    case 'suggested_actions':
      return suggestedActionsForReview({
        plotIssues: args.plot as ReviewIssue[],
        characterIssues: args.character as ReviewIssue[],
        proseIssues: args.prose as ReviewIssue[],
      });
    case 'system_prompt':
      return reviewSystemPrompt(args.key);
    case 'user_prompt':
      return reviewUserPrompt('plot', args.content, args.bundle, args.instruction);
    case 'parse_issues':
      return parseLlmIssues('prose', args.raw);
    case 'llm_reasoner': {
      const { calls, callLlm, checkInterruption } = scripted(args.replies);
      const reasoner = llmReviewReasoner({ callLlm, model: args.model, checkInterruption });
      const content: string = args.repeat ? args.repeat[0].repeat(args.repeat[1]) : args.content;
      const results = await reasoner.reviewAll({
        content,
        paragraphs: paragraphsOf(content),
        contextBundle: args.bundle,
        authorInstruction: args.instruction,
      });
      if (!args.repeat) return { results, calls };
      // 26 万字的提示词按摘要比对，不逐字存进 golden。
      const digested = (calls as { system?: string; user?: string }[]).map((call) =>
        call.user === undefined
          ? call
          : {
              system: call.system,
              user_sha256: sha256Hex(call.user),
              user_chars: Array.from(call.user).length,
            },
      );
      return { results, calls: digested };
    }
    case 'build_report': {
      const reasoner =
        args.reasoner === 'heuristic'
          ? heuristicReviewReasoner
          : llmReviewReasoner({ ...scripted(args.replies), model: args.model });
      const [report, traces] = await buildMultiAgentReviewReport(executor, {
        reasoner,
        newReportId: () => '0123456789abcdef0123456789abcdef',
        filePath: args.file_path,
        content: args.content,
        contextBundle: args.bundle,
        userMessage: args.user_message,
        requestedRoleHints: args.hints,
        requestedRoleMentions: args.mentions,
      });
      return { report, summary: reviewReportSummary(report), traces };
    }
    case 'report_summary':
      return reviewReportSummary(args.report);
    case 'revise_scope': {
      const scope = resolveReviseScope(REPORT, args.args, { authorInstruction: args.author });
      const instruction = args.author || args.args.instruction || '改一下';
      return {
        scope,
        public: publicReviseScope(scope),
        instruction: scopedReviseInstruction(instruction, REPORT, scope, NO_SECRETS),
        summary: reviseSummaryWithScope('已修订。', scope),
        references_review: revisionReferencesReview(instruction),
      };
    }
    case 'parse_ordinal':
      return String(parseOrdinal(args.raw));
    case 'scoped_instruction':
      return args.case === 'no-report-broad'
        ? scopedReviseInstruction('全文重写', null, { narrow: false }, NO_SECRETS)
        : scopedReviseInstruction(
            '全文重写',
            REPORT,
            resolveReviseScope(REPORT, { instruction: '全文重写' }),
            NO_SECRETS,
          );
    case 'drift':
      return {
        counts: reviseDriftCounts(args.before, args.after),
        ratio: reviseDriftRatio(args.before, args.after),
        warning: scopeWarning({ narrow: args.narrow }, args.before, args.after),
      };
    case 'compose':
      return composeScopedInstruction(args.blocks, args.issues, args.actions, NO_SECRETS);
    case 'cross_prompt':
      return crossChapterUserPrompt(args.chapters, args.focus);
    case 'cross_parse':
      return parseCrossChapterFindings(args.raw);
    case 'cross_check': {
      const { calls, callLlm } = scripted(args.replies);
      const result = await checkCrossChapterConsistency(args.chapters, args.focus, {
        callLlm,
        model: args.model,
      });
      return { result, calls };
    }
    default:
      throw new Error(`Unknown pure oracle ${row.fn}`);
  }
}

async function expectPythonError(
  run: () => Promise<unknown>,
  error: { type: string; message: string },
) {
  const expected = ERROR_TYPES[error.type];
  if (!expected) throw new Error(`Unmapped Python error ${error.type}`);
  const caught = await run().then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(caught).toBeInstanceOf(expected);
  if (error.type !== 'JSONDecodeError') expect((caught as Error).message).toBe(error.message);
}

describe('real Python review / revise-scope pure functions', () => {
  for (const [index, row] of (golden.pure as PureRow[]).entries()) {
    it(`${index} ${row.fn} ${row.args_json.slice(0, 60)}`, async () => {
      if (row.error) return expectPythonError(() => runPure(row), row.error);
      const output = await runPure(row);
      if (row.fn === 'parse_ordinal') expect(output).toBe(row.output_json);
      else expect(output).toEqual(JSON.parse(row.output_json!));
    });
  }
});

type Call = {
  fn: string;
  args: { [key: string]: never };
  output_json?: string;
  error?: { type: string; message: string };
  writes: object;
};
const projects = golden.projects as unknown as {
  id: string;
  files: Record<string, EncodedFile>;
  calls: Call[];
}[];

describe('real Python review project replay', () => {
  for (const record of projects) {
    describe(record.id, () => {
      const { reader } = memoryProject(ROOT, record.files);
      for (const [index, call] of record.calls.entries()) {
        it(`#${index} ${call.fn} ${JSON.stringify(call.args).slice(0, 60)}`, async () => {
          expect(call.writes).toEqual({});
          const { args } = call;
          let run: () => Promise<unknown>;
          if (call.fn === 'verify_review_source')
            run = async () => {
              await verifyReviewSource(
                reader,
                args.report,
                args.file_path,
                '林舟左臂受伤。',
                args.rooted ? ROOT : null,
              );
              return null;
            };
          else if (call.fn === 'cross_chapter_review')
            run = async () => {
              const { calls, callLlm } = scripted(args.replies);
              const output = await crossChapterReview(reader, ROOT, args.paths, {
                platform,
                focus: args.focus,
                callLlm,
                model: args.model,
              });
              return { output, calls };
            };
          else throw new Error(`Unknown project oracle ${call.fn}`);
          if (call.error) return expectPythonError(run, call.error);
          expect(await run()).toEqual(JSON.parse(call.output_json!));
        });
      }
    });
  }
});

// 10-31 实验书复盘：顿号列项的长指令被截在第 20 个字，「硬约束」只剩半个词。
describe('revision constraints keep the whole clause', () => {
  it('does not cut a long list of things to keep at 20 characters', () => {
    const scope = resolveReviseScope(REPORT, {
      instruction: '保留主角视角、三条暗线、旧账本与师门旧案的全部细节，其余按审稿意见改',
    });
    expect(scope.constraints).toEqual(['保留主角视角、三条暗线、旧账本与师门旧案的全部细节']);
  });

  it('still stops at the next punctuation mark', () => {
    const scope = resolveReviseScope(REPORT, { instruction: '保留结尾。不要改主角名字，其余随意' });
    expect(scope.constraints).toEqual(['保留结尾', '不要改主角名字']);
  });
});
