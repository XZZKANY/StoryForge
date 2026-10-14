import { describe, expect, it } from 'vitest';
import golden from '../../../golden/p3-tool-handlers.windows.json';
import { decodeFixtureBytes, type EncodedFile } from '../../kernel/contextFixture.test-support';
import {
  fsList,
  fsSearch,
  readProjectFileRaw,
  resolveNewProjectFile,
} from '../../kernel/fsProjectTools';
import { FsBinaryFileError, FsToolError, nativeProjectPath } from '../../kernel/fsTools';
import { InputDomainError, parseJson } from '../../kernel/json';
import { memoryProject } from '../../kernel/memoryProject.test-support';
import { sha256Hex } from '../../kernel/sha256';
import { LlmError } from '../../llm/payload';
import { AgentOrchestrationError } from '../runPayloads';
import { traceAsDict } from '../traces';
import { canonToolHandlers } from './canonHandlers';
import { checkToolHandlers } from './checkHandlers';
import type { ToolExecutionContext, ToolHandler, ToolRunServices } from './execution';
import { fsToolHandlers } from './fsHandlers';
import type { ToolDeps } from './handlerDeps';

type Obj = { [key: string]: unknown };
type Call = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string };
  writes: Record<string, EncodedFile | null>;
};
type ProjectRecord = { id: string; files: Record<string, EncodedFile>; calls: Call[] };
const projects = golden.projects as unknown as ProjectRecord[];
const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const ESCAPED_ROOT = JSON.stringify(ROOT).slice(1, -1);
const stable = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).split(ESCAPED_ROOT).join('$ROOT'));
const ERRORS: Record<string, new (...args: never[]) => Error> = {
  FsToolError,
  FsBinaryFileError,
  AgentOrchestrationError,
  ValueError: RangeError,
};

/** 这些处理器不调模型、不读会话：用到 run 服务就是回归。 */
const UNUSED_SERVICES = new Proxy({} as ToolRunServices, {
  get() {
    throw new Error('只读 / 检查 / canon 处理器不该用到 run 服务');
  },
});

function harness(record: ProjectRecord) {
  const project = memoryProject(ROOT, record.files);
  let uuid = 0;
  let tick = 0;
  const state = { session: null as Obj | null, replies: [] as Obj[], llmCalls: [] as Obj[] };
  const deps: ToolDeps = {
    reader: project.reader,
    writer: project.writer,
    platform,
    secrets: { values: [golden.secret] },
    proposals: {
      newUuid: () => `00000000-0000-4000-8000-${(++uuid).toString(16).padStart(12, '0')}`,
      now: () => new Date(golden.fixed_now),
    },
    artifacts: {
      runHasArtifact: async () => state.session !== null && state.session.existing !== null,
      artifactPayloads: async () =>
        state.session === null ? [] : (state.session.payloads as unknown[]),
    },
    crossChapter: {
      model: ' cross-model ',
      callLlm: async ({ systemPrompt, userPrompt }) => {
        state.llmCalls.push({ system: systemPrompt, user: userPrompt });
        const reply = state.replies.shift()!;
        if ('error' in reply) throw new LlmError(reply.error as string);
        return reply as { content: unknown; latency_ms?: unknown };
      },
    },
    clock: () => (tick += 0.001),
    newHex: () => {
      throw new Error('只读 / 检查 / canon 处理器不产补丁 id');
    },
  };
  const handlers: Record<string, ToolHandler> = {
    ...fsToolHandlers(deps),
    ...checkToolHandlers(deps),
    ...canonToolHandlers(deps),
  };
  return { project, state, handlers };
}

async function runHandler(h: ReturnType<typeof harness>, call: Call, spec: Obj) {
  h.state.session = spec.session as Obj | null;
  h.state.replies = (spec.replies as Obj[] | null) ?? [];
  h.state.llmCalls.length = 0;
  const args = { ...(spec.args as Obj) };
  const context: ToolExecutionContext = {
    run: {
      public_id: 'run-1',
      permission_profile: 'ask',
      goal: '帮我看看',
      status: 'running',
      current_step: 'agent.loop',
      events: spec.events as Obj[],
      artifacts: spec.artifacts as Obj[],
    },
    agentSessionId: 'sess-1',
    assistantSessionId: 7,
    userMessage: spec.user_message as string,
    args,
    currentReviewReport: null,
    writingReadSources: [],
    services: UNUSED_SERVICES,
    deliveries: null,
  };
  const payload = spec.payload as Obj;
  const full = 'project_root' in payload ? payload : { ...payload, project_root: ROOT };
  const output = await h.handlers[call.fn](context, full);
  return {
    status: output.status,
    output: output.output,
    trace: traceAsDict(output.trace),
    summary: output.summary ?? null,
    payload: output.payload ?? null,
    artifacts: (output.artifacts ?? []).map((a) => [a.kind, a.payload, a.requires_confirmation]),
    metrics: output.metrics ?? {},
    ...(spec.replies !== null ? { llm_calls: [...h.state.llmCalls] } : {}),
    args_after: args,
  };
}

/** 循环外壳（P3-5）才会用到的文件函数，以及列表 / 检索的上限参数。 */
async function runDirect(h: ReturnType<typeof harness>, call: Call, args: Obj) {
  const { reader } = h.project;
  const native = (relative: string) => nativeProjectPath(ROOT, relative, platform);
  switch (call.fn) {
    case 'resolve_new_project_file':
      return native(await resolveNewProjectFile(reader, ROOT, args.path as string));
    case 'read_project_file_raw': {
      const read = await readProjectFileRaw(reader, ROOT, args.path as string);
      return {
        target: native(read.target),
        content: read.content,
        raw_sha256: sha256Hex(read.raw),
      };
    }
    case 'fs_list':
      return fsList(
        reader,
        ROOT,
        args.max_entries === 3 ? '正文' : null,
        args.max_entries as number,
      );
    default:
      return fsSearch(reader, ROOT, args.query as string, {
        platform,
        maxMatches: args.max_matches as number,
      });
  }
}

describe.each(projects.map((record) => [record.id, record] as const))(
  'P3-3b 工具处理器与文件工具（Python 预言机）%s',
  (_id, record) => {
    const h = harness(record);
    for (const [index, call] of record.calls.entries()) {
      const spec = parseJson(call.args_json, 'args') as Obj;
      const label = JSON.stringify(spec.payload ?? spec.direct).slice(0, 70);
      it(`#${index} ${call.fn} ${label}`, async () => {
        let result: unknown = null;
        let caught: unknown = null;
        try {
          result = spec.direct
            ? await runDirect(h, call, spec.direct as Obj)
            : await runHandler(h, call, spec);
        } catch (error) {
          caught = error;
        }
        if (call.error) {
          expect(caught, String(caught)).toBeInstanceOf(ERRORS[call.error.type]);
          if (call.error.message.startsWith('正则表达式无效：'))
            // 正则方言与报错原文属于接受的差异：JS RegExp 与 Python regex 的错误文本不同。
            expect((caught as Error).message.startsWith('正则表达式无效：')).toBe(true);
          else expect((caught as Error).message).toBe(call.error.message);
        } else {
          if (caught) throw caught;
          expect(stable(result)).toEqual(JSON.parse(call.output_json!));
        }
        const writes = h.project.takeWrites();
        expect(Object.keys(writes).sort()).toEqual(Object.keys(call.writes).sort());
        for (const [path, file] of Object.entries(call.writes))
          expect(writes[path], path).toEqual(decodeFixtureBytes(file!));
      });
    }
  },
);

describe('P3-3b 接受的差异', () => {
  it('canon.json 写错时一致性检查直接报错（Python 静默丢掉 canon 别名）', async () => {
    const h = harness({
      id: 'bad',
      files: {
        '正文/第001章.md': { chunks: [{ base64: btoa('x'), repeat: 1 }] },
        '.storyforge/canon/canon.json': {
          chunks: [{ base64: btoa('{"entities": [{"id": 3}]}'), repeat: 1 }],
        },
      },
      calls: [],
    });
    const context = {
      run: {
        public_id: 'r',
        permission_profile: 'ask',
        goal: '',
        status: 'running',
        current_step: null,
        events: [],
        artifacts: [],
      },
      agentSessionId: 's',
      assistantSessionId: 1,
      userMessage: '',
      args: {},
      currentReviewReport: null,
      writingReadSources: [],
      services: UNUSED_SERVICES,
      deliveries: null,
    };
    await expect(
      h.handlers['project.consistency'](context, { project_root: ROOT, terms: ['x'] }),
    ).rejects.toThrow(InputDomainError);
  });
});
