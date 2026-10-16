import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db, ProjectReader } from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const ROOT = 'D:\\book';
const fixture = vi.hoisted(() => ({ db: null as Db | null, reader: null as ProjectReader | null }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('./support/http-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./support/http-config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async () => {
    throw new Error('模型配置读不出');
  },
}));
vi.mock('../src/lib/engine/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/assistant')>()),
  platform: () => 'windows' as const,
}));
vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: new Proxy({} as ProjectReader, {
    get: (_target, key) => (fixture.reader as unknown as Record<string, unknown>)[key as string],
  }),
}));
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (...args: Parameters<Db['select']>) => fixture.db!.select(...args),
    transaction: (...args: Parameters<Db['transaction']>) => fixture.db!.transaction(...args),
  },
}));

const encoded = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ items: [], pending_count: 0 }), { status: 200 }),
);

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载
// （之后每条用例 resetModules 只重新求值，不再转换）。
beforeAll(async () => {
  await import('../src/lib/engine/store');
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  fixture.db = nodeSqliteDb();
  fixture.reader = memoryProject(ROOT, { '设定/钟楼.md': encoded('钟楼在城北。\n') }).reader;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('knowledge inbox follows the agent loop flag', () => {
  it('runs on the engine database on ts, even when the model config cannot be read', async () => {
    const api = await import('../src/lib/api/knowledge-proposals');
    expect(await api.refreshKnowledgeProposals(ROOT)).toEqual({ items: [], pending_count: 0 });
    // 一次 ts 档 run 留下的提议（与 agent 循环里 knowledge.propose 落的是同一种 artifact）。
    const engine = {
      ...(await import('@storyforge/engine')),
      ...(await import('../../../../packages/engine/src/loop/runEvents')),
    };
    const { engineRuns } = await import('../src/lib/engine/store');
    const { store } = await engineRuns();
    const services = { store, secrets: { values: [] } };
    const { run } = await engine.startAgentUserMessageRun(services, {
      agentSessionId: 's',
      message: { user_message: '记下钟楼', run_id: 'run-k' },
      newRunId: () => 'unused',
    });
    const group = await engine.buildKnowledgeProposalGroup(
      fixture.reader!,
      ROOT,
      {
        proposals: [
          {
            target_path: '设定/新规.md',
            operation: 'create',
            title: '钟楼',
            claim: '钟楼在城北。',
            kind: 'world_rule',
            confidence: 'author_declared',
            reason: '设定文件写的',
            sources: [{ type: 'project_file', path: '设定/钟楼.md' }],
          },
        ],
      },
      { newUuid: () => crypto.randomUUID(), now: () => new Date(), platform: 'windows' },
    );
    const { artifact } = await engine.recordAgentArtifact(services, run, {
      kind: 'knowledge_proposal',
      payload: group,
    });
    const inbox = await api.refreshKnowledgeProposals(ROOT);
    expect(inbox.pending_count).toBe(1);
    const [item] = inbox.items;
    expect(item).toMatchObject({ artifact_id: artifact.id, run_id: 'run-k', state: 'pending' });
    const proposalId = item.proposals[0].proposal_id;
    const patch = await api.materializeKnowledgeProposal({
      projectRoot: ROOT,
      artifactId: artifact.id,
      revision: 1,
      proposalId,
    });
    expect(patch).toMatchObject({
      file_path: 'D:\\book\\设定\\新规.md',
      before: '',
      requires_confirmation: true,
    });
    // 409 照 Python 路由的 detail 交给调用方，是普通 Error。
    const refused = await api
      .resolveKnowledgeProposal({
        project_root: ROOT,
        artifact_id: artifact.id,
        revision: 1,
        proposal_id: proposalId,
        resolution: 'accepted',
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).constructor).toBe(Error);
    expect((refused as Error).message).toBe(
      'accepted resolution 缺少 patch identity 或作者确认 event id。',
    );
    // 身份对上了，但补丁还没落盘：两个 id 都要原样传到引擎。
    await expect(
      api.resolveKnowledgeProposal({
        project_root: ROOT,
        artifact_id: artifact.id,
        revision: 1,
        proposal_id: proposalId,
        resolution: 'accepted',
        patch_identity: patch.id,
        author_confirmation_event_id: patch.author_confirmation_event_id,
      }),
    ).rejects.toThrow('磁盘上未找到与确认 patch 对应的 Project Knowledge entry。');
    const resolved = await api.resolveKnowledgeProposal({
      project_root: ROOT,
      artifact_id: artifact.id,
      revision: 1,
      proposal_id: proposalId,
      resolution: 'rejected',
    });
    expect(resolved.items[0].proposals[0].state).toBe('rejected');
    await expect(
      api.reviseKnowledgeProposalGroup({
        projectRoot: ROOT,
        artifactId: artifact.id,
        revision: 1,
        proposals: [],
      }),
    ).rejects.toThrow('Knowledge proposal 编辑项与当前 revision 不匹配。');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
