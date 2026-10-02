import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendAgentUserMessage } from '../src/lib/api/agent-socket';
import { decodeExternalWriteback, getExternalWriteback } from '../src/lib/api/external-writeback';
import type { AgentRunWaitingMessage } from '../src/lib/api/types';

const host = vi.hoisted(() => ({ config: {
  baseUrl: 'http://fixture', apiKey: 'fixture-key', managedHostGeneration: 'a'.repeat(64),
  executionProtocols: ['external_writeback_v1'] as readonly 'external_writeback_v1'[],
} }));
vi.mock('../src/lib/api/config', () => ({ getApiConfig: async () => host.config, trimApiBaseUrl: (url: string) => url }));
const frame: AgentRunWaitingMessage = { type: 'agent_run_waiting', protocol: 'external_writeback_v1',
  execution_epoch: 'live', run_id: 'run', session_id: 'session', assistant_session_id: 7,
  event_id: 4, sequence: 4, wait_id: 'wait', revision: 1, stage: 'await_authorization' };
const capability = { execution_protocols: ['external_writeback_v1'], managed_host_generation: 'a'.repeat(64), disabled_reason: null };
const wait = { protocol: 'external_writeback_v1', run_id: 'run', session_id: 'session', assistant_session_id: 7,
  event_id: 6, event_sequence: 6, wait_id: 'wait', revision: 1, stage: 'await_authorization',
  run_status: 'paused', runtime_state: 'settled', project_path: 'D:/fixture', requested_path: 'chapter.md',
  raw_before: 'before', before_hash: 'a'.repeat(64), after_hash: 'b'.repeat(64), operation_key: 'patch:whole', source: '[]',
  proposal: { id: 'patch', before: 'before', after: 'after', requires_confirmation: true }, identity: null,
  decision: null, observation: null, historical_applied: false, feedback_consumed: false,
  delivery_complete: false, permission_profile: 'ask', continuation_available: true };
function stream(frames: unknown[], fail = false) {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (index < frames.length) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frames[index++])}\n\n`));
    else if (fail) controller.error(new Error('connection lost')); else controller.close();
  } }, { highWaterMark: 0 }));
}
beforeEach(() => { vi.useFakeTimers(); host.config.executionProtocols = ['external_writeback_v1']; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('live wait is a distinct result; a durable notification cannot retain live execution authority', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(capability))
    .mockResolvedValueOnce(stream([{ ...frame, execution_epoch: null }, frame]));
  vi.stubGlobal('fetch', fetchMock);
  const events = vi.fn();
  const result = await sendAgentUserMessage({ sessionId: 'session', runId: 'run', userMessage: 'Revise',
    executionProtocol: 'external_writeback_v1', onEvent: events });
  expect(result).toEqual(frame); expect(result.type).not.toBe('agent_result');
  expect(events).toHaveBeenCalledTimes(2);
  const [url, options] = fetchMock.mock.calls[1];
  expect(String(url)).toContain('/api/ide/agent/sessions/session/stream');
  expect(JSON.parse(String(options?.body)).execution_protocol).toBe('external_writeback_v1');
  expect(options?.headers).toMatchObject({ 'X-StoryForge-Host-Generation': 'a'.repeat(64) });
});
it('cold transport recovery returns a wait with no epoch and never repeats POST', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(capability))
    .mockResolvedValueOnce(stream([], true)).mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(wait));
  vi.stubGlobal('fetch', fetchMock);
  const pending = sendAgentUserMessage({ sessionId: 'session', runId: 'run', userMessage: 'Revise', executionProtocol: 'external_writeback_v1' });
  await vi.advanceTimersByTimeAsync(3000);
  const result = await pending;
  expect(result).toMatchObject({ type: 'agent_run_waiting', execution_epoch: null, event_id: 6, sequence: 6 });
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('http://fixture/api/agent-runs/run/writeback?session_id=session');
});
it.each(['native', 'api'] as const)('missing %s capability refuses new protocol instead of downgrading to legacy', async (missing) => {
  if (missing === 'native') host.config.executionProtocols = [];
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(missing === 'api'
    ? { ...capability, managed_host_generation: 'b'.repeat(64) } : capability));
  vi.stubGlobal('fetch', fetchMock);
  await expect(sendAgentUserMessage({ sessionId: 'session', runId: 'run', userMessage: 'Revise', executionProtocol: 'external_writeback_v1' }))
    .rejects.toThrow('未开放');
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
});
it('a wrong run live frame never routes into another run or a legacy patch', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(capability))
    .mockResolvedValueOnce(stream([{ ...frame, run_id: 'other' }])));
  await expect(sendAgentUserMessage({ sessionId: 'session', runId: 'run', userMessage: 'Revise', executionProtocol: 'external_writeback_v1' }))
    .rejects.toThrow('不属于');
});
it('one REST decoder keeps missing confirmation, malformed identity and unknown observations fail closed', async () => {
  expect(decodeExternalWriteback(wait).proposal.requires_confirmation).toBe(true);
  expect(() => decodeExternalWriteback({ ...wait, proposal: { ...wait.proposal, requires_confirmation: undefined } })).toThrow();
  expect(() => decodeExternalWriteback({ ...wait, identity: { operationId: 'spoof' } })).toThrow();
  expect(() => decodeExternalWriteback({ ...wait, observation: { state: 'success', current: 'after', receipt_persisted: true } })).toThrow();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(wait)); vi.stubGlobal('fetch', fetchMock);
  await getExternalWriteback(host.config, 'run', 'session');
  expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
});
