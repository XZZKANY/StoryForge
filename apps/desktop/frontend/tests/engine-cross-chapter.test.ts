import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  source: {} as Record<string, string>,
  sent: [] as { url: string; body: { messages: { role: string; content: string }[] } }[],
  reply: (): { status: number; text: string } => ({ status: 200, text: '' }),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.16' }));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async () => ({ source: fixture.source, secrets: { values: [] } }),
  nativeHttpPort: () => ({
    async send(request: { url: string; body: Uint8Array | null }) {
      fixture.sent.push({
        url: request.url,
        body: JSON.parse(new TextDecoder().decode(request.body!)),
      });
      const { status, text } = fixture.reply();
      return {
        status,
        headers: { 'content-type': 'application/json' },
        body: (async function* () {
          yield new TextEncoder().encode(text);
        })(),
        close() {},
      };
    },
  }),
}));

const CONFIGURED = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
  STORYFORGE_LLM_MODEL: ' deepseek-v4 ',
  STORYFORGE_LLM_RETRY_MAX_ATTEMPTS: '1',
};
const FINDINGS = JSON.stringify([
  {
    type: 'setting',
    severity: 'high',
    chapters: ['第1章', '第2章'],
    finding: '左右手矛盾',
    evidence: '左臂受伤/左手拔剑',
  },
]);
const completion = (content: string) =>
  JSON.stringify({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
  });
const TWO = [
  { name: '第1章', content: '林舟左臂受伤。' },
  { name: '第2章', content: '林舟用左手拔剑。' },
];

const request = async (
  body: Parameters<typeof import('../src/lib/api/cross-chapter').requestCrossChapterConsistency>[0],
) => (await import('../src/lib/api/cross-chapter')).requestCrossChapterConsistency(body);

beforeAll(async () => {
  await import('../src/lib/engine/crossChapter');
}, 60_000);
beforeEach(() => {
  fixture.source = CONFIGURED;
  fixture.sent = [];
  fixture.reply = () => ({ status: 200, text: completion(FINDINGS) });
  vi.stubEnv('DEV', true);
  localStorage.setItem('engine.assistant', 'ts');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('the ts route must not reach the Python API');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it('reviews whole chapters through the native port and returns the findings', async () => {
  const result = await request({ chapters: TWO, focus: ' 伤势 ' });
  expect(result.findings).toEqual(JSON.parse(FINDINGS));
  expect(result.model).toBe('deepseek-v4');
  expect(typeof result.latencyMs).toBe('number');
  expect(fixture.sent).toHaveLength(1);
  const [system, user] = fixture.sent[0].body.messages;
  expect(system.content).toContain('跨章一致性审校');
  expect(user.content).toContain('<<<第1章');
  expect(user.content).toContain('作者特别关注:伤势');
});

it("fails with the same texts as Python's route", async () => {
  fixture.source = { ...CONFIGURED, STORYFORGE_LLM_API_KEY: '' };
  await expect(request({ chapters: TWO })).rejects.toThrow(/^真实 LLM 未配置：/);
  expect(fixture.sent).toEqual([]);

  fixture.source = CONFIGURED;
  await expect(request({ chapters: TWO.slice(0, 1) })).rejects.toThrow('API 返回 422');
  await expect(request({ chapters: [TWO[0], { name: '第2章', content: '  ' }] })).rejects.toThrow(
    '跨章一致性检查至少需要两章有正文的章节。',
  );

  fixture.reply = () => ({ status: 500, text: '{"error":{"message":"上游出错"}}' });
  await expect(request({ chapters: TWO })).rejects.toThrow(/^跨章一致性 LLM 调用失败：/);
});

it('the Python route stays the default and does not load the engine', async () => {
  localStorage.setItem('engine.assistant', 'python');
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ findings: [], model: 'm', latency_ms: 5 }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  expect(await request({ chapters: TWO })).toEqual({ findings: [], model: 'm', latencyMs: 5 });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fixture.sent).toEqual([]);
});
