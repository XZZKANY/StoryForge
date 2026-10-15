// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compareCaptures,
  parsePythonCaptures,
  type PromptCapture,
} from '../src/lib/engine/shadowDiff';

const tool = (name: string, description = '') => ({
  type: 'function',
  function: { name, description, parameters: {} },
});
const request = (overrides: Record<string, unknown> = {}) => ({
  model: 'm',
  messages: [
    { role: 'system', content: '系统\n第二行' },
    { role: 'user', content: '正文' },
  ],
  tools: [tool('fs.read'), tool('fs.list')],
  temperature: 0.7,
  max_tokens: null,
  tool_choice: null,
  reasoning_effort: null,
  metadata: {},
  ...overrides,
});
const capture = (
  value: Record<string, unknown>,
  digest = 'a'.repeat(64),
  step = 'agent.model',
): PromptCapture => ({ step, streaming: true, request: value, requestDigest: digest });
const differ = (overrides: Record<string, unknown>) =>
  compareCaptures(capture(request()), capture(request(overrides), 'b'.repeat(64))).differences;

describe('compareCaptures', () => {
  it('same digest is a match; neither side dispatching is a match too', () => {
    expect(compareCaptures(capture(request()), capture(request()))).toEqual({
      outcome: 'match',
      differences: [],
      truncated: false,
    });
    expect(compareCaptures(null, null).outcome).toBe('match');
  });

  it('only one side dispatching, or a failed snapshot, is a difference', () => {
    expect(compareCaptures(null, capture(request())).differences).toEqual([
      { path: 'request', kind: 'extra_in_ts' },
    ]);
    expect(compareCaptures(capture(request()), null).differences).toEqual([
      { path: 'request', kind: 'missing_in_ts' },
    ]);
    const failed: PromptCapture = {
      step: 'agent.model',
      streaming: true,
      error: 'snapshot_failed',
    };
    expect(compareCaptures(failed, failed).differences).toEqual([
      { path: 'request', kind: 'capture_failed', side: 'python' },
      { path: 'request', kind: 'capture_failed', side: 'ts' },
    ]);
  });

  it('step and streaming are compared even when the digests agree', () => {
    const ts: PromptCapture = {
      ...capture(request(), 'a'.repeat(64), 'chapter.brief'),
      streaming: false,
    };
    expect(compareCaptures(capture(request()), ts).differences).toEqual([
      { path: 'step', kind: 'value' },
      { path: 'streaming', kind: 'value' },
    ]);
  });

  it('locates a text difference by line and column without carrying the text', () => {
    const messages = [
      { role: 'system', content: '系统\n第三行' },
      { role: 'user', content: '正文' },
    ];
    expect(differ({ messages })).toEqual([
      {
        path: 'messages[0].content',
        kind: 'text',
        python_chars: 6,
        ts_chars: 6,
        offset: 4,
        line: 2,
        column: 2,
        python_span: 1,
        ts_span: 1,
      },
    ]);
  });

  it('counts code points like Python and handles insertions at the end', () => {
    const messages = [
      { role: 'system', content: '系统\n第二行😀' },
      { role: 'user', content: '正文' },
    ];
    expect(differ({ messages })[0]).toMatchObject({
      python_chars: 6,
      ts_chars: 7,
      offset: 6,
      python_span: 0,
      ts_span: 1,
    });
  });

  it('reports message count, role and tool-call fields', () => {
    expect(
      differ({
        messages: [
          { role: 'user', content: '系统\n第二行' },
          { role: 'user', content: '正文', tool_call_id: 'c1' },
          { role: 'user', content: '多出来的' },
        ],
      }),
    ).toEqual([
      { path: 'messages', kind: 'count', python: 2, ts: 3 },
      { path: 'messages[0].role', kind: 'value', python: 'system', ts: 'user' },
      { path: 'messages[1].tool_call_id', kind: 'value' },
    ]);
  });

  it('reports scalar settings, metadata keys and tools by name', () => {
    expect(differ({ temperature: 1, metadata: { operation: 'x' } })).toEqual([
      { path: 'temperature', kind: 'value' },
      { path: 'metadata.operation', kind: 'value' },
    ]);
    expect(differ({ tools: [tool('fs.list'), tool('fs.read')] })).toEqual([
      { path: 'tools', kind: 'order' },
    ]);
    expect(differ({ tools: [tool('fs.read', '改过'), tool('fs.search')] })).toEqual([
      { path: 'tools[fs.read]', kind: 'value' },
      { path: 'tools[fs.list]', kind: 'missing_in_ts' },
      { path: 'tools[fs.search]', kind: 'extra_in_ts' },
    ]);
    expect(differ({ tools: [tool('fs.read')] })).toEqual([
      { path: 'tools', kind: 'count', python: 2, ts: 1 },
      { path: 'tools[fs.list]', kind: 'missing_in_ts' },
    ]);
  });

  it('equal values under different digests are an encoding difference', () => {
    expect(differ(request())).toEqual([{ path: 'request', kind: 'encoding' }]);
  });

  it('caps the list and says so', () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      role: 'user',
      content: `第${index}`,
    }));
    const result = compareCaptures(
      capture(request({ messages: many })),
      capture(
        request({ messages: many.map((item) => ({ ...item, content: `${item.content}改` })) }),
        'b'.repeat(64),
      ),
    );
    expect(result.differences).toHaveLength(40);
    expect(result.truncated).toBe(true);
  });
});

describe('parsePythonCaptures', () => {
  const digest = 'c'.repeat(64);
  it('accepts snapshots and failed snapshots', () => {
    expect(
      parsePythonCaptures([
        { step: 'agent.model', streaming: true, request: { model: 'm' }, request_digest: digest },
        { step: 'agent.model', streaming: false, error: 'snapshot_failed' },
      ]),
    ).toEqual([
      { step: 'agent.model', streaming: true, request: { model: 'm' }, requestDigest: digest },
      { step: 'agent.model', streaming: false, error: 'snapshot_failed' },
    ]);
    expect(parsePythonCaptures([])).toEqual([]);
  });

  it.each([
    ['not a list', undefined],
    ['missing step', [{ streaming: true, request: {}, request_digest: digest }]],
    ['bad digest', [{ step: 's', streaming: true, request: {}, request_digest: 'x' }]],
    [
      'request not an object',
      [{ step: 's', streaming: true, request: [], request_digest: digest }],
    ],
    ['streaming not a boolean', [{ step: 's', streaming: 1, request: {}, request_digest: digest }]],
  ])('rejects %s', (_name, value) => {
    expect(parsePythonCaptures(value)).toBeNull();
  });
});
