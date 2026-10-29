import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { escapeStrayQuotes, parseJson } from '../kernel/json';
import { OpenAIToolStream } from '../llm/openaiStream';
import type { ProjectReader } from '../readPort';
import { agentRunReplay } from './agentRunReplay.test-support';
import { buildCheck } from './chapterCheckProtocol';
import { programAdvisoryNote } from './chapterWritingPipeline';
import { parseBrief } from './chapterWritingContracts';
import { providerFailureMessage } from './chatLoop';
import { normalizedChapterPath } from './tools/patchHandlers';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const DRAFT_TAIL = '请输出该文件的完整初稿正文。';

// 作者 10-25：能用程序拦住的就用程序，别让模型整份重来。
describe('结构化 JSON 里没转义的直引号由程序修好', () => {
  it('escapes a quote that is followed by text instead of the end of the string', () => {
    const text = '{"goal": "临终前说过"阵下有东西在等"，怀疑旧阵是陷阱"}';
    expect(parseJson(escapeStrayQuotes(text), 'test')).toEqual({
      goal: '临终前说过"阵下有东西在等"，怀疑旧阵是陷阱',
    });
  });

  it('treats a quote before a half-width comma as content when no value follows the comma', () => {
    const text = '{"line": "他说"好",她笑了", "count": 1}';
    expect(parseJson(escapeStrayQuotes(text), 'test')).toEqual({
      line: '他说"好",她笑了',
      count: 1,
    });
  });

  it('leaves well-formed JSON untouched', () => {
    const text = '{"a": "x", "b": ["y", "z"], "c": {"d": -1, "e": true, "f": null}}';
    expect(escapeStrayQuotes(text)).toBe(text);
  });
});

describe('无参数工具的空参数串按空对象收下', () => {
  it('completes a tool call whose arguments arrived as an empty string', () => {
    const stream = new OpenAIToolStream();
    stream.feed({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'tooluse_1',
                type: 'function',
                function: { name: 'fs_list', arguments: '' },
              },
            ],
          },
        },
      ],
    });
    expect(stream.complete('tool_calls')).toEqual([
      { id: 'tooluse_1', type: 'function', function: { name: 'fs_list', arguments: '{}' } },
    ]);
  });
});

describe('模型调用失败的原因说对', () => {
  it('names a broken tool call instead of a dropped connection', () => {
    expect(providerFailureMessage('Incomplete streamed tool response.', 2)).toBe(
      '模型调用失败：模型返回的工具调用不完整或参数格式不对，已自动重试 2 次仍未成功，可以再试一次，反复出现请换个支持工具调用的模型。',
    );
    expect(providerFailureMessage('Invalid streamed tool response.', 0)).toBe(
      '模型调用失败：模型返回的工具调用不完整或参数格式不对，可以再试一次，反复出现请换个支持工具调用的模型。',
    );
  });

  it('keeps the dropped-connection wording for real stream breaks', () => {
    expect(providerFailureMessage('read timeout', 2)).toBe(
      '模型调用失败：输出途中连接断开，已自动重试 2 次仍未成功，可以再试一次，反复出现请检查网络或中转。',
    );
    expect(providerFailureMessage('read timeout', 0)).toBe(
      '模型调用失败：原因未能归类，原始错误已记进本轮运行记录。',
    );
    expect(providerFailureMessage('真实 LLM 流式读取中断（已输出 0 字）：IncompleteRead', 0)).toBe(
      '模型调用失败：输出途中连接断开，可以再试一次，反复出现请检查网络或中转。',
    );
  });

  it('names the HTTP status class without echoing the response body', () => {
    const http = (status: number) =>
      providerFailureMessage(
        `真实 LLM 流式返回 HTTP ${status}（耗时 120ms，尝试 1/3）：{"error":"sk-secret upstream text"}`,
        0,
      );
    expect(http(401)).toBe(
      '模型调用失败：模型服务拒绝了密钥（HTTP 401），请到设置里检查 API Key。',
    );
    expect(http(404)).toBe('模型调用失败：服务地址或模型名不对（HTTP 404），请到设置里检查。');
    expect(http(400)).toBe(
      '模型调用失败：模型服务不接受这次请求（HTTP 400），中转或模型可能不认某个参数（例如思考等级），可以把思考等级调回「关」，或到设置里核对模型名。',
    );
    expect(http(429)).toBe('模型调用失败：请求太频繁或额度用完（HTTP 429），可以稍后重试。');
    expect(http(502)).toBe('模型调用失败：模型服务端出错（HTTP 502），可以稍后重试。');
    for (const status of [400, 401, 402, 403, 404, 408, 418, 422, 429, 500, 502, 504])
      expect(http(status)).not.toContain('sk-secret');
  });

  it('names connection failures and truncation', () => {
    expect(
      providerFailureMessage(
        '真实 LLM 调用超时或连接失败（耗时 60000ms，timeout=60.0s，尝试 3/3）：TimeoutError',
        0,
      ),
    ).toBe('模型调用失败：等模型回复超时，可以稍后重试，反复超时请检查网络和服务地址。');
    expect(providerFailureMessage('真实 LLM 输出被截断或过滤，不能把未完成正文当成稿。', 0)).toBe(
      '模型调用失败：模型输出被截断或被过滤，可以把要求拆小或换个说法再试。',
    );
  });
});

describe('章纲：直引号与目标字数', () => {
  const options = (seed: Obj) => ({ seed, provenance: {}, newHex: () => '0'.repeat(32) });
  const seed = (min: number, max: number) => ({
    target_path: '正文/第019章.md',
    chapter_ordinal: 19,
    chapter_title: null,
    goal: '起草第19章',
    target_chars_min: min,
    target_chars_max: max,
  });
  const reply = (fields: string) =>
    `{"target_path": "正文/第019章.md", "goal": "温清婆说过"阵下有东西在等"，陆沉起疑", ${fields}}`;

  it('parses a brief whose goal copies the plan with bare quotes', () => {
    const brief = parseBrief(
      reply('"target_chars_min": 2500, "target_chars_max": 3000'),
      options(seed(2400, 3600)),
    );
    expect(brief.goal).toBe('温清婆说过"阵下有东西在等"，陆沉起疑');
  });

  it('pins the model target into the range set from the book or plan', () => {
    const wide = parseBrief(
      reply('"target_chars_min": 4300, "target_chars_max": 6500'),
      options(seed(2400, 3600)),
    );
    expect([wide.target_chars_min, wide.target_chars_max]).toEqual([2400, 3600]);
    const inside = parseBrief(
      reply('"target_chars_min": 2500, "target_chars_max": 3000'),
      options(seed(2400, 3600)),
    );
    expect([inside.target_chars_min, inside.target_chars_max]).toEqual([2500, 3000]);
    const overlap = parseBrief(
      reply('"target_chars_min": 3000, "target_chars_max": 5000'),
      options(seed(2400, 3600)),
    );
    expect([overlap.target_chars_min, overlap.target_chars_max]).toEqual([3000, 3600]);
  });

  it('lets the model choose while the book has no length to go by yet', () => {
    const fresh = parseBrief(
      reply('"target_chars_min": 3000, "target_chars_max": 4000'),
      options(seed(1600, 2600)),
    );
    expect([fresh.target_chars_min, fresh.target_chars_max]).toEqual([3000, 4000]);
  });
});

describe('程序查出的字数与章号只提示，不拦稿', () => {
  const brief = golden.check_brief as Obj;
  const findings = (content: string) =>
    (buildCheck(content, brief, null, { providerFailed: true }).findings as Obj[]).filter(
      (item) => item.rule !== 'checker_failure',
    );

  it('flags an over-long draft as advisory', () => {
    const [finding] = findings('长'.repeat(600));
    expect(finding).toMatchObject({ rule: 'word_count_out_of_range', severity: 'advisory' });
  });

  it('still blocks a draft too short to be a chapter', () => {
    const [finding] = findings('短');
    expect(finding).toMatchObject({ rule: 'word_count_out_of_range', severity: 'hard' });
  });

  it('points at chapter numbers written into the prose, not at the heading', () => {
    const content = `# 第三章 入城\n\n${'夜'.repeat(40)}\n他想起第八章时那场雨。\n${'夜'.repeat(40)}`;
    expect(findings(content)).toEqual([
      {
        rule: 'chapter_number_in_prose',
        severity: 'advisory',
        message: '正文里出现章号「第八章」：章号是目录用的，写进叙述会出戏。',
        line: 4,
        evidence: '他想起第八章时那场雨。',
      },
    ]);
  });

  it('says the program advisories in the reply', () => {
    expect(
      programAdvisoryNote({
        findings: [
          {
            rule: 'word_count_out_of_range',
            severity: 'advisory',
            message: '正文 9000 字，严重偏离 2400–3600 字。',
          },
          { rule: 'advisory', severity: 'advisory', message: '节奏偏慢' },
        ],
      }),
    ).toBe('程序提示：正文 9000 字，严重偏离 2400–3600 字。');
    expect(programAdvisoryNote({ findings: [] })).toBe('');
  });
});

describe('对话 AI 新建正文章节时文件名统一成第NNN章.md', () => {
  const reader = (existing: string[]): ProjectReader =>
    ({
      async inspectProjectPath(_root: string, path: string) {
        const found = existing.includes(path);
        return {
          entryKind: found ? 'file' : 'missing',
          targetKind: found ? 'file' : 'missing',
          isReparsePoint: false,
          sizeBytes: 0,
        };
      },
    }) as unknown as ProjectReader;

  it('renames a chapter named with Chinese numerals or a title', async () => {
    expect(
      await normalizedChapterPath(
        reader([]),
        'D:\\书',
        'D:\\书\\正文\\第一章 筑基前夜.md',
        '正文/第一章 筑基前夜.md',
      ),
    ).toEqual({
      filePath: 'D:\\书\\正文\\第001章.md',
      relativePath: '正文/第001章.md',
    });
    expect(
      await normalizedChapterPath(reader([]), 'D:\\书', '正文/第十二章.md', '正文/第十二章.md'),
    ).toEqual({
      filePath: '正文/第012章.md',
      relativePath: '正文/第012章.md',
    });
  });

  it('leaves names alone when they already fit, the target exists, or the file is not a chapter', async () => {
    expect(
      await normalizedChapterPath(reader([]), 'D:\\书', '正文/第003章.md', '正文/第003章.md'),
    ).toBeNull();
    expect(
      await normalizedChapterPath(
        reader(['正文/第001章.md']),
        'D:\\书',
        '正文/第一章.md',
        '正文/第一章.md',
      ),
    ).toBeNull();
    expect(
      await normalizedChapterPath(reader([]), 'D:\\书', '大纲/第一章.md', '大纲/第一章.md'),
    ).toBeNull();
    expect(
      await normalizedChapterPath(reader([]), 'D:\\书', '正文/楔子.md', '正文/楔子.md'),
    ).toBeNull();
  });
});

describe('章纲管线：起草带上章纲看到的对话节选', () => {
  async function run(id: string, change: (spec: Obj) => void) {
    const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
    const spec = JSON.parse(base.spec_json);
    change(spec);
    const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    return record;
  }
  const withHistory = (history: [string, string][]) => (spec: Obj) => {
    spec.sessions = [{ title: '新的创作会话', project_path: '$ROOT' }];
    spec.message.assistant_session_id = 1;
    spec.history = history;
  };
  const draftPrompt = (record: Obj) => {
    const prompts = (record.requests as Obj[]).map((request) => {
      const messages = request.body.messages as Obj[];
      return messages[messages.length - 1].content as string;
    });
    const drafts = prompts.filter((prompt) => prompt.endsWith(DRAFT_TAIL));
    expect(drafts).toHaveLength(1);
    return drafts[0];
  };

  it('carries the agreed design from the conversation into the draft', async () => {
    const record = await run(
      'write-brief-then-pass',
      withHistory([
        ['user', '城门三更关，沈禾手里有出城令牌'],
        ['assistant', '好，那就让沈禾用令牌带林舟夜里入城。'],
      ]),
    );
    expect(draftPrompt(record)).toContain(
      '<<<CONVERSATION\n作者：城门三更关，沈禾手里有出城令牌\nAI：好，那就让沈禾用令牌带林舟夜里入城。\nCONVERSATION>>>',
    );
  });

  it('adds nothing when nothing was said', async () => {
    const record = await run('write-brief-then-pass', () => undefined);
    expect(draftPrompt(record)).not.toContain('<<<CONVERSATION');
  });

  it('keeps going when the brief reply copies bare quotes', async () => {
    const record = await run('write-brief', (spec) => {
      const body = JSON.parse(spec.replies[0].body);
      const content = body.choices[0].message.content as string;
      const brief = JSON.parse(content);
      body.choices[0].message.content = content.replace(
        JSON.stringify(brief.goal),
        '"沈禾说过"城门三更关"，带林舟入城"',
      );
      spec.replies[0].body = JSON.stringify(body);
    });
    expect(record.result.agent_result.chapter_brief.goal).toBe('沈禾说过"城门三更关"，带林舟入城');
  });
});
