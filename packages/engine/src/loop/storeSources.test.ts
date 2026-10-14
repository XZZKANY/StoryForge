import { describe, expect, it } from 'vitest';
import { MemoryRunStore } from '../store/runs';
import { storeRunSources, storeToolArtifactQuery } from './storeSources';

async function seeded() {
  const store = new MemoryRunStore();
  const run = (publicId: string, sessionId: number | null) =>
    store.insertRun({
      public_id: publicId,
      session_id: 's',
      assistant_session_id: sessionId,
      goal: '',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'completed',
      root_plan: [],
      current_step: 'completed',
    });
  const a = await run('run-a', 1);
  const b = await run('run-b', 2);
  const c = await run('run-c', 1);
  const event = (runId: number, type: string) =>
    store.appendEvent({
      run_id: runId,
      event_type: type,
      actor: 'agent',
      message: '',
      payload: {},
    });
  await event(c.id, 'c1');
  await event(a.id, 'a1');
  await event(b.id, 'b1');
  await event(a.id, 'a2');
  const artifact = (runId: number, kind: string, payload: { [key: string]: unknown }) =>
    store.insertArtifact({ run_id: runId, kind, payload, requires_confirmation: false });
  await artifact(c.id, 'knowledge_proposal', { n: 1 });
  await artifact(b.id, 'knowledge_proposal', { n: 2 });
  await artifact(a.id, 'review_report', { n: 3 });
  return store;
}

describe('store-backed sources', () => {
  it('checks the named run only, but dedupes proposals across every run in id order', async () => {
    const query = storeToolArtifactQuery(await seeded());
    expect(await query.runHasArtifact('run-c', 'knowledge_proposal')).toBe(true);
    expect(await query.runHasArtifact('run-a', 'knowledge_proposal')).toBe(false);
    expect(await query.runHasArtifact('run-missing', 'knowledge_proposal')).toBe(false);
    expect(await query.artifactPayloads('knowledge_proposal')).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await query.artifactPayloads('nothing')).toEqual([]);
  });

  it('lists the events and artifacts of one assistant session in id order', async () => {
    const store = await seeded();
    const sources = storeRunSources(store);
    expect((await sources.runEvents(1)).map((row) => row.event_type)).toEqual(['c1', 'a1', 'a2']);
    expect((await sources.runArtifacts(1)).map((row) => row.kind)).toEqual([
      'knowledge_proposal',
      'review_report',
    ]);
    expect(await sources.runEvents(9)).toEqual([]);
    expect((await sources.artifact(2))?.payload).toEqual({ n: 2 });
    expect((await sources.artifact(3))?.kind).toBe('review_report');
    expect(await sources.artifact(99)).toBeNull();
  });
});
