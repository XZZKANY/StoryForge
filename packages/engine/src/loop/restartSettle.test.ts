import { describe, expect, it } from 'vitest';
import { MemoryRunStore } from '../store/runs';
import { agentExecutionState, reapInterruptedRuns } from './runControlChannel';
import { startAgentExecution, startAgentUserMessageRun, type RunServices } from './runEvents';

describe('restarting after a pause that never settled', () => {
  it('settles the execution the previous process left running, so the paused run can be resumed', async () => {
    const store = new MemoryRunStore();
    const services: RunServices = { store, secrets: { values: [] } };
    const { run } = await startAgentUserMessageRun(services, {
      agentSessionId: 'sess',
      message: { user_message: '写下一章', run_id: 'run-p' },
      newRunId: () => 'unused',
    });
    await startAgentExecution(services, run);
    // 作者点了暂停，原执行还没来得及确认停下，应用就退出了。
    await store.updateRun(run.id, { status: 'paused', current_step: 'paused' });
    expect(await agentExecutionState(store, (await store.getRun(run.id))!)).toBe('in_flight');

    await reapInterruptedRuns(services);
    const after = (await store.getRun(run.id))!;
    expect(after.status).toBe('paused');
    expect(await agentExecutionState(store, after)).toBe('settled');
  });
});
