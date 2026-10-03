import { expect, it } from 'vitest';
import { parseAgentSseFrame } from '../src/lib/api/agent-sse-frame';

it.each(['null', 'true', '1', '"text"', '[]', '{broken'])(
  'ignores non-object or malformed SSE data: %s',
  (value) => {
    expect(parseAgentSseFrame('data: ' + value)).toBeNull();
  },
);
it('decodes multiline data without treating SSE metadata as JSON', () => {
  expect(
    parseAgentSseFrame('event: message\ndata: {"type":"error",\ndata: "detail":"failed"}'),
  ).toEqual({ type: 'error', detail: 'failed' });
  expect(parseAgentSseFrame(': heartbeat\nevent: message')).toBeNull();
});
