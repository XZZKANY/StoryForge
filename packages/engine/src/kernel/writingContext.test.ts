import { describe, expect, it } from 'vitest';
import golden from '../../golden/p2-writing-context.windows.json';
import type { EncodedFile } from './contextFixture.test-support';
import type { Obj } from './contextValues';
import { GenerationSourceCapture } from './generationSources';
import { dumpJson } from './json';
import type { CollectedProjectKnowledge } from './knowledgeContext';
import {
  buildLlmContextSnapshot,
  buildLlmContextSnapshotFromCollected,
  llmContextSnapshotTraceSummary,
} from './llmContext';
import {
  llmContextSnapshotToPromptContextBundle,
  syntheticContextDelivery,
  syntheticContextSelectedValues,
} from './llmPromptContext';
import { memoryProject } from './memoryProject.test-support';
import { previousChapterTail } from './previousChapter';
import type { PlainJson } from './redaction';
import { sha256Hex } from './sha256';
import {
  ContextBundleValidationError,
  PreparedWritingContext,
  WritingContextConflictError,
  admitWritingRequest,
  validateAssistantContextBundle,
  writingContextFromGuardedBundle,
  writingContextFromSnapshot,
  type WritingRequest,
} from './writingContext';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const secrets = { values: [] };
const EMPTY: CollectedProjectKnowledge = {
  result: null,
  warnings: [],
  ordinary: null,
  recoveryJson: null,
};
const IDENTITY = {
  projectRoot: ROOT,
  filePath: '正文/第002章.md',
  content: '他回头。',
  intent: 'file.revise',
  platform,
};
const ESCAPED_ROOT = JSON.stringify(ROOT).slice(1, -1);
/** Python 输出把真实运行目录归一成 `$ROOT`；TS 侧把合成根换成同一占位再比。 */
const stable = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).split(ESCAPED_ROOT).join('$ROOT')) as T;
const rooted = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).split('$ROOT').join(ESCAPED_ROOT)) as T;

type PureRow = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string };
};

function projections(snapshot: Obj) {
  const output: Obj = {
    trace: llmContextSnapshotTraceSummary(snapshot),
    selected_values: syntheticContextSelectedValues(snapshot, secrets),
    synthetic: syntheticContextDelivery(snapshot, secrets) as unknown as PlainJson,
  };
  try {
    output.prompt_bundle = llmContextSnapshotToPromptContextBundle(snapshot, secrets);
  } catch (error) {
    output.prompt_bundle_error = (error as Error).message;
  }
  return output;
}

function preparedDict(prepared: PreparedWritingContext) {
  return { bundle: prepared.contextBundle, receipt: prepared.contextReceiptJson };
}

function runPure(row: PureRow): unknown {
  const args = JSON.parse(row.args_json);
  if (row.fn === 'collected_snapshot') {
    const snapshot = buildLlmContextSnapshotFromCollected(
      EMPTY,
      {
        runState: args.run_state ?? null,
        intent: args.intent,
        userMessage: args.user_message,
        filePath: args.file_path,
        content: args.content,
        contextBundle: args.context_bundle,
        roleHints: args.role_hints,
        roleMentions: args.role_mentions,
        reviewReport: args.review_report,
        artifacts: args.artifacts,
        eventHistory: args.event_history,
        extraContextFiles: args.extra_context_files,
      },
      { platform, secrets },
    );
    return { snapshot, ...projections(snapshot) };
  }
  if (row.fn === 'projections') return projections(args.snapshot);
  if (row.fn === 'guarded_bundle')
    return preparedDict(
      writingContextFromGuardedBundle(args.raw, {
        ...IDENTITY,
        contextReceipt: args.context_receipt ?? null,
      }),
    );
  if (row.fn === 'from_snapshot') {
    const target = { ...IDENTITY, secrets };
    if ('project_root' in args) target.projectRoot = args.project_root;
    if ('file_path' in args) target.filePath = args.file_path;
    if ('content' in args) target.content = args.content;
    if ('intent' in args) target.intent = args.intent;
    return preparedDict(writingContextFromSnapshot(args.snapshot, target));
  }
  throw new Error(`unknown pure fn ${row.fn}`);
}

function expectSameError(run: () => unknown, error: { type: string; message: string }) {
  let thrown: unknown;
  try {
    run();
  } catch (caught) {
    thrown = caught;
  }
  expect(thrown, 'TS 应当报错').toBeInstanceOf(Error);
  if (error.type === 'ValidationError') {
    // pydantic 的报错文本是它自己的格式，只比较错误类别。
    expect(thrown).toBeInstanceOf(ContextBundleValidationError);
    return;
  }
  if (error.type === 'ConflictError') expect(thrown).toBeInstanceOf(WritingContextConflictError);
  expect((thrown as Error).message).toBe(error.message);
}

describe('real Python LLM context snapshot / prompt projection / writing context', () => {
  for (const [index, row] of (golden.pure as PureRow[]).entries()) {
    const name = JSON.parse(row.args_json).name;
    it(`${index} ${row.fn} ${name}`, () => {
      if (row.error) return expectSameError(() => runPure(row), row.error);
      expect(runPure(row)).toEqual(JSON.parse(row.output_json!));
    });
  }
});

type Call = {
  fn: string;
  args: Record<string, unknown>;
  output_json?: string;
  error?: { type: string; message: string };
  writes: object;
};
const record = golden.projects[0] as unknown as {
  files: Record<string, EncodedFile>;
  calls: Call[];
};

async function withCapture(run: (capture: GenerationSourceCapture) => Promise<unknown>) {
  const capture = await GenerationSourceCapture.create({ root: ROOT, platform, secrets });
  const value = await run(capture);
  return {
    value,
    sources: capture.sources,
    selections: capture.selections,
    projections: capture.projections.map(([row, text]) => ({ row, text })),
    context_delivery: capture.contextDelivery,
  };
}

const RUN_STATE = { public_id: 'run-9', goal: '写完', status: 'running', current_step: 'draft' };

/** 与 Python oracle 同算法：去掉 snapshot_id，按占位根重算一次稳定 id。 */
function stableSnapshot(snapshot: Obj) {
  const body = stable(
    Object.fromEntries(Object.entries(snapshot).filter(([k]) => k !== 'snapshot_id')),
  );
  const encoded = dumpJson(body, { ensureAscii: false, sortKeys: true, separators: [',', ':'] });
  return { snapshot: body, stable_id: `llmctx-${sha256Hex(encoded).slice(0, 16)}` };
}

function requestPayload(data: Record<string, unknown>): WritingRequest {
  const payload = rooted(data) as WritingRequest & { context_bundle?: unknown };
  return {
    ...payload,
    context_bundle:
      payload.context_bundle === undefined
        ? null
        : validateAssistantContextBundle(payload.context_bundle as PlainJson),
  };
}

describe('real Python writing context project replay', () => {
  const project = memoryProject(ROOT, record.files);
  const { reader } = project;
  const options = { platform, secrets };
  let prepared: PreparedWritingContext | null = null;
  const preparedContext = async () => {
    prepared ??= writingContextFromSnapshot(
      await buildLlmContextSnapshot(
        reader,
        {
          runState: null,
          intent: 'file.revise',
          userMessage: '改',
          filePath: '正文/第002章.md',
          content: '他回头。',
          contextBundle: {
            project_root: ROOT,
            current_file: '正文/第002章.md',
            files: golden.prepared_files as PlainJson,
          },
        },
        options,
      ),
      { ...IDENTITY, secrets },
    );
    return prepared;
  };

  for (const [index, call] of record.calls.entries()) {
    const name = (call.args.name as string | undefined) ?? JSON.stringify(call.args);
    it(`#${index} ${call.fn} ${name}`, async () => {
      const args = call.args;
      let run: () => Promise<unknown>;
      if (call.fn === 'previous_chapter') {
        const root = 'project' in args ? null : ROOT;
        run = () =>
          withCapture((capture) =>
            previousChapterTail(reader, root, rooted(args.current_file) as string | null, {
              platform,
              capture,
            }),
          );
      } else if (call.fn === 'live_snapshot') {
        run = async () => {
          const snapshot = await buildLlmContextSnapshot(
            reader,
            {
              runState: RUN_STATE,
              intent: (args.intent as string) ?? 'chat.explain',
              userMessage: (args.user_message as string) ?? '灵力 钟楼',
              filePath: '正文/第002章.md',
              content: '他回头。',
              contextBundle: rooted(args.bundle) as PlainJson,
              extraContextFiles: (args.extra_context_files as PlainJson[] | undefined) ?? null,
            },
            options,
          );
          const view = projections(snapshot);
          // trace 里的 snapshot_id 依赖真实根；先确认它就是本快照的 id，再换成占位根下的稳定 id。
          expect((view.trace as Obj).snapshot_id).toBe(snapshot.snapshot_id);
          const stableView = stableSnapshot(snapshot);
          (view.trace as Obj).snapshot_id = stableView.stable_id;
          return { ...stableView, ...view };
        };
      } else if (call.fn === 'admit') {
        run = () =>
          withCapture(async (capture) => {
            const result = await admitWritingRequest(reader, requestPayload(args.data as Obj), {
              intent: args.intent as string,
              ...options,
              capture,
            });
            return result.context_bundle ?? null;
          });
      } else {
        run = async () => {
          const context = await preparedContext();
          return withCapture(async (capture) => {
            const result = await admitWritingRequest(reader, requestPayload(args.data as Obj), {
              intent: args.intent as string,
              preparedContext: context,
              ...options,
              capture,
            });
            return result.context_bundle ?? null;
          });
        };
      }
      if (call.error) {
        const thrown = await run().catch((error: unknown) => error);
        expect(thrown).toBeInstanceOf(WritingContextConflictError);
        expect((thrown as Error).message).toBe(call.error.message);
      } else {
        expect(stable(await run())).toEqual(JSON.parse(call.output_json!));
      }
      expect(project.takeWrites()).toEqual({});
    });
  }
});

describe('writing context boundaries', () => {
  it('only the admission module can construct a prepared context', () => {
    expect(() => new PreparedWritingContext(Symbol('forged') as never, '[]', '{}', null)).toThrow(
      TypeError,
    );
  });

  it('a request with neither bundle nor root is returned unchanged', async () => {
    const payload = { file_path: 'a.md', content: 'x', instruction: '改' };
    const project = memoryProject(ROOT, {});
    const result = await admitWritingRequest(project.reader, payload, {
      intent: 'file.revise',
      platform,
      secrets,
    });
    expect(result).toBe(payload);
  });

  it('every consumer receives a fresh bundle value', async () => {
    const context = writingContextFromGuardedBundle(
      { project_root: '.', current_file: 'a.md', files: [] },
      { ...IDENTITY },
    );
    const first = context.contextBundle;
    first.files.push({ path: 'x', relative_path: 'x', kind: 'x', title: 'x', excerpt: 'x' });
    expect(context.contextBundle.files).toEqual([]);
  });
});
