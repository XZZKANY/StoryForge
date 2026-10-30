import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-host.windows.json';
import {
  AgentHostRejection,
  FramePump,
  postAgentControl,
  streamAgentUserMessage,
  TEXT_COALESCE_WINDOW_SECONDS,
  TextDeltaCoalescer,
  type AgentHostDeps,
} from './agentHost';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';
import {
  MemoryRunStore,
  type ArtifactRecord,
  type RunEventRecord,
  type RunRecord,
} from '../store/runs';
import { LoopCheckpointStore } from './chatLoopCheckpoints';
import { agentRunSavePoints, buildSavePointProjection, listAgentRunEvents } from './savePoints';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);
const HOST_KEYS = ['payloads', 'host_controls', 'reads', 'body'];

/**
 * 接受的差异（P3-5c 已记）：Python 检查点落库前脱敏，含密钥的检查点诊断为 checkpoint_content_redacted；
 * TS 检查点只在内存、不脱敏，同一个已完成的 run 报的是下一条理由。只在这一个场景改写期望值。
 */
function expectedHost(scenario: Obj, key: string) {
  if (scenario.id !== 'host-secret-in-message' || key !== 'reads') return scenario[key];
  const reads = structuredClone(scenario.reads);
  for (const read of reads) {
    const resume = read.save_points.runtime_recovery.checkpoint_resume;
    expect(resume.reason).toBe('checkpoint_content_redacted');
    resume.reason = 'terminal_checkpoint_requires_delivery_reconciliation';
  }
  return reads;
}

describe('agent host (SSE route, control route, run reads) replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(17);
    expect(golden.scenarios).toHaveLength(37);
  });

  it.each((golden.scenarios as Obj[]).map((item) => [item.id, item] as const))(
    '%s',
    async (_id, scenario) => {
      const { record, error } = await replay(scenario);
      if (error) throw error;
      for (const key of HOST_KEYS)
        if (key in scenario) expectSame(record[key], expectedHost(scenario, key), key);
        else expect(record[key], key).toBeUndefined();
      for (const key of REPLAY_KEYS) expectSame(record[key], scenario[key], key);
    },
  );
});

describe('save point projection replays the Python records', () => {
  it.each((golden.save_point_records as Obj[]).map((item) => [item.id, item] as const))(
    '%s',
    (_id, record) => {
      const run = { id: 1, ...record.run } as RunRecord;
      const events = (record.events as Obj[]).map((row) => ({
        ...row,
        run_id: 1,
        actor: 'agent',
      })) as RunEventRecord[];
      const artifacts = (record.artifacts as Obj[]).map((row) => ({
        ...row,
        run_id: 1,
      })) as ArtifactRecord[];
      expect(
        buildSavePointProjection(run, events, artifacts, { values: [golden.secret as string] }),
      ).toEqual(record.output);
    },
  );
});

describe('run reads', () => {
  it('redacts and projects raw event rows on the way out, like the Python read model', async () => {
    const store = new MemoryRunStore();
    const run = await store.insertRun({
      public_id: 'run-1',
      session_id: 's',
      assistant_session_id: 1,
      goal: '',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'paused',
      root_plan: [],
      current_step: 'paused',
    });
    const secret = 'sk-direct-secret-0001';
    // 绕过 sink 直接写库：读模型自己也要脱敏、也要把未决调用投影成摘要。
    await store.appendEvent({
      run_id: run.id,
      event_type: 'agent_artifact',
      actor: 'agent',
      message: `key ${secret}`,
      payload: {
        kind: 'runtime_pending_call',
        artifact_id: 3,
        requires_confirmation: false,
        payload: { status: 'pending', intent: 'file.review', private_body: 'x', note: secret },
      },
    });
    const deps = {
      store,
      secrets: { values: [secret] },
      reader: null as never,
      checkpoints: new LoopCheckpointStore(),
    };
    await store.appendEvent({
      run_id: run.id,
      event_type: 'pause_run',
      actor: 'author',
      message: '暂停',
      payload: { reason: secret },
    });
    const [pending, pause] = await listAgentRunEvents(deps, 'run-1');
    expect(pending.message).toBe('key [REDACTED]');
    expect((pending.payload as Obj).payload).not.toHaveProperty('private_body');
    expect(pause.payload).toEqual({ reason: '[REDACTED]' });
    await expect(listAgentRunEvents(deps, 'run-404')).rejects.toThrow('找不到这次 AI 运行。');
    await expect(agentRunSavePoints(deps, 'run-404')).rejects.toThrow('找不到这次 AI 运行。');
  });
});

/**
 * 检查点能否续跑叠在保存点投影上（Python `checkpoint_recovery_projection`）。端到端的读都发生在 run 停稳之后，
 * 「暂停但执行仍在途」「停在权限确认却有可续跑的检查点」在那里走不到，这里按 Python 的分支直接钉住。
 */
describe('checkpoint resume on save points', () => {
  async function savePoints(options: {
    step: string;
    events: string[];
    dispatch?: 'checkpointed' | 'model_outcome_unknown';
  }) {
    const store = new MemoryRunStore();
    const run = await store.insertRun({
      public_id: 'run-1',
      session_id: 's',
      assistant_session_id: 1,
      goal: '',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'paused',
      root_plan: [],
      current_step: options.step,
    });
    for (const type of options.events)
      await store.appendEvent({
        run_id: run.id,
        event_type: type,
        actor: 'agent',
        message: '',
        payload: {},
      });
    const checkpoints = new LoopCheckpointStore();
    checkpoints.append('run-1', {
      checkpoint: { runId: 'run-1', phase: 'tool_completed', pending: null } as never,
      assistantSessionId: 1,
      permissionProfile: 'ask',
      resumeMessage: { args: { project_path: 'D:/book' } },
      outcome: {},
      dispatchState: options.dispatch ?? 'checkpointed',
      sources: { project_root: 'D:/book', files: {} },
    });
    const projection: Obj = await agentRunSavePoints(
      { store, secrets: { values: [] }, reader: null as never, checkpoints },
      'run-1',
    );
    return {
      resume: projection.runtime_recovery.checkpoint_resume,
      recoverability: projection.recoverability,
      manual: projection.runtime_recovery.manual_restart_required,
    };
  }
  const settled = ['agent_execution_started', 'agent_execution_settled'];

  it('offers to continue a settled paused run with a resumable checkpoint', async () => {
    expect(await savePoints({ step: 'paused', events: settled })).toEqual({
      resume: {
        kind: 'runtime_checkpoint_resume',
        can_resume: true,
        reason: 'durable_checkpoint_ready',
        resume_strategy: 'continue_checkpoint',
        requires_manual_restart: false,
        resume_via_control_channel: true,
      },
      recoverability: {
        terminal_event_id: null,
        resume_strategy: 'continue_checkpoint',
        can_resume: true,
      },
      manual: false,
    });
  });

  it('waits for settlement while the execution is still in flight', async () => {
    const view = await savePoints({ step: 'paused', events: ['agent_execution_started'] });
    expect(view.resume).toMatchObject({
      can_resume: false,
      reason: 'execution_in_flight',
      resume_strategy: 'await_settlement',
      resume_via_control_channel: false,
    });
    expect(view.recoverability).toMatchObject({
      resume_strategy: 'await_settlement',
      can_resume: false,
    });
  });

  it('leaves a permission wait to its own protocol', async () => {
    const view = await savePoints({ step: 'permission.confirm', events: settled });
    expect(view.resume).toMatchObject({ can_resume: false, reason: 'durable_checkpoint_ready' });
    expect(view.recoverability).toEqual({
      terminal_event_id: null,
      resume_strategy: 'none',
      can_resume: false,
    });
  });

  it('asks for reconciliation when the checkpoint cannot be continued', async () => {
    const view = await savePoints({
      step: 'paused',
      events: settled,
      dispatch: 'model_outcome_unknown',
    });
    expect(view.resume).toMatchObject({ can_resume: false, reason: 'model_outcome_unknown' });
    expect(view.recoverability).toMatchObject({ resume_strategy: 'reconciliation_required' });
  });
});

describe('TextDeltaCoalescer replays the router coalescer', () => {
  it('uses the router window and character budget', () => {
    expect(TEXT_COALESCE_WINDOW_SECONDS).toBe(golden.coalescer_limits.window_seconds);
    // 字数上限不导出：用「恰好不超」与「超一个」两个记录钉住（char-budget-exact / -astral）。
    expect(golden.coalescer_limits.max_chars).toBe(4096);
  });

  it.each(Object.entries(golden.coalescer as Obj))('%s', (_name, record) => {
    const coalescer = new TextDeltaCoalescer();
    const outputs = (record.ops as [string, Obj?][]).map(([op, payload]) => {
      if (op === 'feed') {
        const [frames, armed] = coalescer.feed(structuredClone(payload!));
        return { frames, armed };
      }
      return { flushed: coalescer.flush() };
    });
    expect(outputs).toEqual(record.outputs);
  });
});

/** 只测宿主自己的那层：不跑循环，模型未配置也到不了模型。 */
function fakeTimers() {
  const timers: { callback: () => void; seconds: number; cleared: boolean }[] = [];
  return {
    timers,
    scheduler: {
      setTimer: (callback: () => void, seconds: number) => {
        const timer = { callback, seconds, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer: unknown) => {
        (timer as { cleared: boolean }).cleared = true;
      },
    },
  };
}

describe('host request validation', () => {
  const unusedDeps = new Proxy({} as AgentHostDeps, {
    get() {
      throw new Error('被拒的请求不该碰到运行时');
    },
  });

  it.each([
    ['not an object', 'x'],
    ['a numeric user message', { user_message: 3 }],
    ['a string session id', { assistant_session_id: '3' }],
    ['a boolean session id', { assistant_session_id: true }],
    ['a fractional session id', { assistant_session_id: 1.5 }],
    ['null args', { args: null }],
    ['array args', { args: [] }],
    ['an unknown protocol', { execution_protocol: 'v2' }],
    ['an unknown permission profile', { permission_profile: 'bogus' }],
    ['a numeric intent', { intent: 1 }],
  ])('rejects %s with 422 before running anything', async (_name, body) => {
    const frames: unknown[] = [];
    const failure = await streamAgentUserMessage(unusedDeps, 's', body, (frame) =>
      frames.push(frame),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentHostRejection);
    expect(failure).toMatchObject({ status: 422, detail: null, message: 'API 返回 422' });
    expect(frames).toEqual([]);
  });

  it('refuses the external writeback protocol with 409', async () => {
    const failure = await streamAgentUserMessage(
      unusedDeps,
      's',
      { user_message: 'x', execution_protocol: 'external_writeback_v1' },
      () => undefined,
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 409, detail: '当前宿主未开放连续写入协议' });
  });

  it.each([
    ['not an object', null],
    ['a missing type', { run_id: 'r' }],
    ['a missing run id', { type: 'pause_run' }],
    ['a numeric run id', { type: 'pause_run', run_id: 1 }],
  ])('rejects a control body with %s', async (_name, body) => {
    await expect(postAgentControl(unusedDeps, 's', body)).rejects.toMatchObject({ status: 422 });
  });
});

describe('frame pump windows', () => {
  const delta = (text: string, round = 1) => ({
    type: 'agent_text_delta',
    run_id: 'run-1',
    stream_id: 's1',
    round_index: round,
    chunk_sequence: 0,
    text_delta: text,
  });
  const step = { type: 'agent_step', run_id: 'run-1', step: 'x', status: 'running' };

  function harness() {
    const { timers, scheduler } = fakeTimers();
    const frames: Obj[] = [];
    const pump = new FramePump((frame) => frames.push(frame), scheduler);
    const fire = () => {
      for (const timer of timers) if (!timer.cleared) timer.callback();
    };
    const view = () =>
      frames.map((frame) => [frame.type, frame.text_delta ?? null, frame.chunk_sequence ?? null]);
    return { pump, timers, frames, fire, view };
  }

  it('ships the first delta of a round at once and holds later ones for a fixed window', () => {
    const h = harness();
    h.pump.push(delta('a'));
    h.pump.push(delta('b'));
    h.pump.push(delta('c'));
    expect(h.view()).toEqual([['agent_text_delta', 'a', 1]]);
    // 后续增量不顺延窗口：只挂了一个计时器。
    expect(h.timers.map((timer) => [timer.seconds, timer.cleared])).toEqual([
      [TEXT_COALESCE_WINDOW_SECONDS, false],
    ]);
    h.fire();
    expect(h.view()).toEqual([
      ['agent_text_delta', 'a', 1],
      ['agent_text_delta', 'bc', 2],
    ]);
  });

  it('flushes buffered text before a non-delta frame and disarms the window', () => {
    const h = harness();
    h.pump.push(delta('a'));
    h.pump.push(delta('b'));
    h.pump.push(step);
    expect(h.view()).toEqual([
      ['agent_text_delta', 'a', 1],
      ['agent_text_delta', 'b', 2],
      ['agent_step', null, null],
    ]);
    expect(h.timers.every((timer) => timer.cleared)).toBe(true);
  });

  it('opens a new window when a size or round boundary ships a frame', () => {
    const h = harness();
    h.pump.push(delta('a'));
    h.pump.push(delta('b'));
    h.pump.push(delta('x', 2));
    expect(h.timers.map((timer) => timer.cleared)).toEqual([true, false]);
    h.fire();
    expect(h.view()).toEqual([
      ['agent_text_delta', 'a', 1],
      ['agent_text_delta', 'b', 2],
      ['agent_text_delta', 'x', 1],
    ]);
  });

  it('flushes pending text before the terminal frame', () => {
    const h = harness();
    h.pump.push(delta('a'));
    h.pump.push(delta('b'));
    h.pump.finish({ type: 'agent_result' });
    expect(h.view()).toEqual([
      ['agent_text_delta', 'a', 1],
      ['agent_text_delta', 'b', 2],
      ['agent_result', null, null],
    ]);
    expect(h.timers.every((timer) => timer.cleared)).toBe(true);
  });
});
