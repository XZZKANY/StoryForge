import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';
import {
  BRIEF_READY_PREFIX,
  briefConversation,
  briefPrompt,
  REPAIR_INSTRUCTION_PREFIX,
} from './chapterWritingContracts';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);

const user = (content: string) => ({ role: 'user', content });
const ai = (content: string) => ({ role: 'assistant', content });

describe('briefConversation', () => {
  it('keeps what the author and the AI said since the last brief, oldest first', () => {
    expect(
      briefConversation(
        [
          user('第二章先别让沈禾露面'),
          ai(`${BRIEF_READY_PREFIX}林舟出城。确认后才会开始起草。`),
          user('第三章节奏快一点，别写回忆'),
          ai('好，第三章我打算让沈禾在城门口截住他。'),
          user('可以'),
        ],
        '写第三章',
      ),
    ).toBe(
      '作者：第三章节奏快一点，别写回忆\nAI：好，第三章我打算让沈禾在城门口截住他。\n作者：可以',
    );
  });

  it('leaves out what the pipeline itself wrote into the session', () => {
    expect(
      briefConversation(
        [
          user('第四章让他受伤'),
          user(`${REPAIR_INSTRUCTION_PREFIX}\n- word_count_out_of_range: 正文 4828 字`),
          ai('已按指令修订 正文/第003章.md，修订后约 3100 字。'),
          user('写第四章'),
        ],
        '写第四章',
      ),
    ).toBe('作者：第四章让他受伤');
  });

  it('returns null when nothing was said since the last brief', () => {
    expect(briefConversation([], '写第一章')).toBeNull();
    expect(
      briefConversation([ai(`${BRIEF_READY_PREFIX}林舟出城。确认后才会开始起草。`)], '写第二章'),
    ).toBeNull();
  });

  // 10-31 起那句改说「章纲已准备：」；旧会话里留着的「Chapter Brief 已准备：」照样是分界。
  it.each([
    ['现在的说法', '章纲已准备：林舟夜行。'],
    ['旧会话里的旧说法', 'Chapter Brief 已准备：林舟夜行。确认后才会开始起草。'],
  ])('stops at the previous brief line (%s)', (_name, line) => {
    expect(
      briefConversation([user('第二章写夜行'), ai(line), user('第三章写入城')], '写第三章'),
    ).toBe('作者：第三章写入城');
  });

  it('caps each line and the total, keeping the newest', () => {
    const long = '长'.repeat(700);
    const lines = briefConversation(
      Array.from({ length: 12 }, (_, index) => user(`${index}${long}`)),
      '写第五章',
    )!.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[3].startsWith('作者：11')).toBe(true);
    expect(lines[3].endsWith('……')).toBe(true);
    expect(Array.from(lines.join('\n')).length).toBeLessThanOrEqual(3000);
  });

  it('puts the excerpt into the brief prompt only when there is one', () => {
    const seed = { target_path: '正文/第003章.md', chapter_ordinal: 3 };
    expect(briefPrompt(seed, '写第三章')).not.toContain('<<<CONVERSATION');
    const prompt = briefPrompt(seed, '写第三章', null, '作者：别写回忆');
    expect(prompt).toContain(
      '<<<CONVERSATION\n作者：别写回忆\nCONVERSATION>>>\n作者要求：写第三章',
    );
  });
});

describe('章纲调用读到对话节选', () => {
  async function briefRequest(history: [string, string][]) {
    const base = (golden.scenarios as Obj[]).find((item) => item.id === 'write-brief')!;
    const spec = JSON.parse(base.spec_json);
    spec.sessions = [{ title: '新的创作会话', project_path: '$ROOT' }];
    spec.message.assistant_session_id = 1;
    spec.history = history;
    const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    const messages = (record.requests as Obj[])[0].body.messages as Obj[];
    return messages[messages.length - 1].content as string;
  }

  it('carries what was said in the conversation into the brief call', async () => {
    const prompt = await briefRequest([
      ['user', '第三章别写回忆，沈禾要在城门口截住林舟'],
      ['assistant', '好，那第三章就从城门口开场。'],
    ]);
    expect(prompt).toContain(
      '<<<CONVERSATION\n作者：第三章别写回忆，沈禾要在城门口截住林舟\nAI：好，那第三章就从城门口开场。\nCONVERSATION>>>',
    );
  });

  it('starts after the previous chapter brief', async () => {
    const prompt = await briefRequest([
      ['user', '第二章写夜行'],
      ['assistant', `${BRIEF_READY_PREFIX}林舟夜行。确认后才会开始起草。`],
      ['user', '第三章写入城'],
    ]);
    expect(prompt).toContain('<<<CONVERSATION\n作者：第三章写入城\nCONVERSATION>>>');
    expect(prompt).not.toContain('第二章写夜行');
  });
});
