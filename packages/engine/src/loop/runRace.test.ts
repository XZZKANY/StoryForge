import { describe, expect, it } from 'vitest';
import {
  MemoryRunStore,
  RunPublicIdConflictError,
  type RunEventFields,
  type RunPatch,
  type RunRecord,
} from '../store/runs';
import {
  AgentRunEventSink,
  AgentRunNotFoundError,
  createOrResumeAgentRun,
  type RunServices,
} from './runEvents';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 每次存储调用先让出一拍（模拟异步驱动）；control 直写不让，代表另一路的控制通道。 */
class YieldingRunStore extends MemoryRunStore {
  override async findRun(publicId: string) {
    await tick();
    return super.findRun(publicId);
  }
  override async getRun(id: number) {
    await tick();
    return super.getRun(id);
  }
  override async insertRun(fields: Omit<RunRecord, 'id'>) {
    await tick();
    return super.insertRun(fields);
  }
  override async updateRun(id: number, patch: RunPatch) {
    await tick();
    return super.updateRun(id, patch);
  }
  override async settleRun(
    id: number,
    from: string,
    patch: RunPatch,
    event: (run: RunRecord) => RunEventFields,
  ) {
    await tick();
    return super.settleRun(id, from, patch, event);
  }
  control(id: number, patch: RunPatch) {
    return super.updateRun(id, patch);
  }
}

const runFields = (sessionId: string) => ({
  publicId: 'run-synthetic',
  sessionId,
  goal: '目标',
  scope: {},
  permissionProfile: null,
  budget: {},
});

const result = { intent: 'chat.explain', agent_result: { summary: '完成' }, proposed_patch: null };

describe('run 结算与控制通道交错（验收 F1）', () => {
  const settle = {
    complete: (sink: AgentRunEventSink, run: RunRecord) => sink.complete(run, result),
    fail: (sink: AgentRunEventSink, run: RunRecord) => sink.fail(run, '出错'),
    permission: (sink: AgentRunEventSink, run: RunRecord) =>
      sink.recordPermissionRequired(run, result, 'requires_user_confirmation'),
  };
  for (const [name, call] of Object.entries(settle))
    for (const status of ['stopped', 'paused'])
      it(`${name}：结算落库前控制通道写入 ${status}，不覆盖、不记事件、不发帧`, async () => {
        const store = new YieldingRunStore();
        const services: RunServices = { store, secrets: { values: [] } };
        const run = await createOrResumeAgentRun(services, runFields('session-a'));
        const frames: string[] = [];
        const sink = new AgentRunEventSink(services, (event) => frames.push(event.event_type));
        const worker = call(sink, run);
        await store.control(run.id, { status, current_step: status });
        await worker;
        const final = await store.getRun(run.id);
        expect([final.status, final.current_step]).toEqual([status, status]);
        expect(await store.events(run.id)).toEqual([]);
        expect(frames).toEqual([]);
      });

  it('结算先落库则控制通道的写入在其之后（事件只记一次）', async () => {
    const store = new YieldingRunStore();
    const services: RunServices = { store, secrets: { values: [] } };
    const run = await createOrResumeAgentRun(services, runFields('session-a'));
    const sink = new AgentRunEventSink(services);
    expect((await sink.complete(run, result)).status).toBe('completed');
    expect((await sink.complete(run, result)).status).toBe('completed');
    expect((await store.events(run.id)).map((event) => event.event_type)).toEqual([
      'agent_run_completed',
    ]);
  });
});

describe('同 public_id 并发创建（验收 F2）', () => {
  const stores: [string, () => MemoryRunStore][] = [
    ['同步存储', () => new MemoryRunStore()],
    ['异步存储', () => new YieldingRunStore()],
  ];
  for (const [label, make] of stores)
    it(`跨会话：后到者按续接被归属守卫拒绝，库里只有一条（${label}）`, async () => {
      const store = make();
      const services: RunServices = { store, secrets: { values: [] } };
      const outcomes = await Promise.allSettled([
        createOrResumeAgentRun(services, runFields('session-a')),
        createOrResumeAgentRun(services, runFields('session-b')),
      ]);
      const won = outcomes.filter((item) => item.status === 'fulfilled');
      const lost = outcomes.filter((item) => item.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(AgentRunNotFoundError);
      const stored = (await store.findRun('run-synthetic'))!;
      expect(stored).toEqual((won[0] as PromiseFulfilledResult<RunRecord>).value);
      await expect(store.getRun(2)).rejects.toThrow(RangeError);
    });

  it('同会话：两个都成功、指向同一条 run', async () => {
    const store = new MemoryRunStore();
    const services: RunServices = { store, secrets: { values: [] } };
    const [first, second] = await Promise.all([
      createOrResumeAgentRun(services, runFields('session-a')),
      createOrResumeAgentRun(services, runFields('session-a')),
    ]);
    expect([first.id, second.id]).toEqual([1, 1]);
    await expect(store.getRun(2)).rejects.toThrow(RangeError);
  });
});

describe('RunStore 原子操作的契约', () => {
  const fields = {
    public_id: 'run-x',
    session_id: 's',
    assistant_session_id: null,
    goal: 'g',
    scope: {},
    permission_profile: 'ask',
    budget: {},
    status: 'running',
    root_plan: [],
    current_step: null,
  };

  it('insertRun 拒绝重复的 public_id，不覆盖原行', async () => {
    const store = new MemoryRunStore();
    await store.insertRun(fields);
    await expect(store.insertRun({ ...fields, session_id: 'other' })).rejects.toBeInstanceOf(
      RunPublicIdConflictError,
    );
    expect((await store.getRun(1)).session_id).toBe('s');
    await expect(store.getRun(2)).rejects.toThrow(RangeError);
  });

  it('settleRun 状态不符时什么都不写', async () => {
    const store = new MemoryRunStore();
    const run = await store.insertRun({ ...fields, status: 'stopped' });
    const event = () => ({ run_id: run.id, event_type: 'x', actor: 'a', message: '', payload: {} });
    expect(await store.settleRun(run.id, 'running', { status: 'completed' }, event)).toBeNull();
    expect((await store.getRun(run.id)).status).toBe('stopped');
    expect(await store.events(run.id)).toEqual([]);
  });

  it('settleRun 的事件回调抛错时状态也不变', async () => {
    const store = new MemoryRunStore();
    const run = await store.insertRun(fields);
    const boom = () => {
      throw new Error('boom');
    };
    await expect(store.settleRun(run.id, 'running', { status: 'completed' }, boom)).rejects.toThrow(
      'boom',
    );
    expect((await store.getRun(run.id)).status).toBe('running');
    expect(await store.events(run.id)).toEqual([]);
  });

  it('settleRun 成功时事件看到的是更新后的行', async () => {
    const store = new MemoryRunStore();
    const run = await store.insertRun(fields);
    const settled = await store.settleRun(
      run.id,
      'running',
      { status: 'completed', current_step: 'completed' },
      (updated) => ({
        run_id: updated.id,
        event_type: 'done',
        actor: 'a',
        message: `${updated.status}/${updated.current_step}`,
        payload: {},
      }),
    );
    expect(settled!.run.status).toBe('completed');
    expect([settled!.event.message, settled!.event.sequence]).toEqual(['completed/completed', 1]);
  });
});
