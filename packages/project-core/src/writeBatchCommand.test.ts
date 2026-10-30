import { describe, expect, it } from 'vitest';

import { invokedSkillNames } from './conversationSkills';
import { parseWriteBatchCommand } from './writeBatchCommand';

const range = (from: number, to: number, note: string | null = null) => ({
  kind: 'range',
  from,
  to,
  note,
});
const kind = (message: string) => parseWriteBatchCommand(message)?.kind ?? null;

describe('/写 批量写章指令', () => {
  it('范围的各种写法都认', () => {
    for (const text of [
      '/写 1-10',
      '/写 1–10',
      '/写 1—10',
      '/写 1——10',
      '/写 1~10',
      '/写 1～10',
      '/写 1至10',
      '/写 1到10',
      '/写 第1-10章',
      '/写 第1章到第10章',
      '/写 1 - 10',
      '/写 １－１０',
      '/写 １-10',
    ])
      expect(parseWriteBatchCommand(text), text).toEqual(range(1, 10));
  });

  it('单个数字只写那一章', () => {
    expect(parseWriteBatchCommand('/写 5')).toEqual(range(5, 5));
    expect(parseWriteBatchCommand('/写 第5章')).toEqual(range(5, 5));
    expect(parseWriteBatchCommand('/写 ５')).toEqual(range(5, 5));
    expect(parseWriteBatchCommand('/写 7-7')).toEqual(range(7, 7));
  });

  it('三种触发符、全角空格、goal 不分大小写都认', () => {
    expect(parseWriteBatchCommand('／写 2-3')).toEqual(range(2, 3));
    expect(parseWriteBatchCommand('、写 2-3')).toEqual(range(2, 3));
    expect(parseWriteBatchCommand('  /写　2-3')).toEqual(range(2, 3));
    expect(parseWriteBatchCommand('/goal 2-3')).toEqual(range(2, 3));
    expect(parseWriteBatchCommand('/GOAL 2-3')).toEqual(range(2, 3));
    expect(parseWriteBatchCommand('、Goal')).toEqual({ kind: 'resume' });
  });

  it('不带范围是续写上一批', () => {
    expect(parseWriteBatchCommand('/写')).toEqual({ kind: 'resume' });
    expect(parseWriteBatchCommand('/写   ')).toEqual({ kind: 'resume' });
    expect(parseWriteBatchCommand('、写')).toEqual({ kind: 'resume' });
  });

  it('范围后面跟的话原样当 note', () => {
    expect(parseWriteBatchCommand('/写 4-6 这几章节奏快一点')).toEqual(
      range(4, 6, '这几章节奏快一点'),
    );
    expect(parseWriteBatchCommand('/写 第4-6章　打斗少一点\n多写对白')).toEqual(
      range(4, 6, '打斗少一点\n多写对白'),
    );
    expect(parseWriteBatchCommand('/写 5 到这里收住')).toEqual(range(5, 5, '到这里收住'));
  });

  it('不是指令的不认：指令词后面不是空白、不在开头、别的点名', () => {
    expect(parseWriteBatchCommand('/写法 看看')).toBeNull();
    expect(parseWriteBatchCommand('/写作规范')).toBeNull();
    expect(parseWriteBatchCommand('/goals 1-3')).toBeNull();
    expect(parseWriteBatchCommand('帮我 /写 1-3')).toBeNull();
    expect(parseWriteBatchCommand('写 1-3')).toBeNull();
    expect(parseWriteBatchCommand('/立项流程 /写 1-3')).toBeNull();
    expect(parseWriteBatchCommand('')).toBeNull();
  });

  it('格式不对给提示：起点大于终点、第 0 章、超过 5 位数、没写数字、范围后面没空格', () => {
    const message = (text: string) => {
      const parsed = parseWriteBatchCommand(text);
      return parsed?.kind === 'invalid' ? parsed.message : null;
    };
    expect(message('/写 10-4')).toBe('起点比终点大：要写第 4 到第 10 章，就写 /写 4-10。');
    expect(message('/写 0-3')).toBe('章序从 1 开始，没有第 0 章。');
    expect(message('/写 0')).toBe('章序从 1 开始，没有第 0 章。');
    expect(message('/写 123456')).toBe('章序最多 5 位数。');
    expect(message('/写 1-000001')).toBe('章序最多 5 位数。');
    expect(parseWriteBatchCommand('/写 99999')).toEqual(range(99999, 99999));
    expect(message('/写 第一章')).toContain('章序用数字写');
    expect(message('/写 这几章快一点')).toContain('/写 4-10');
    expect(message('/写 4-')).toContain('没认出来');
    expect(message('/写 4-6章节奏快')).toContain('中间空一格');
    expect(kind('/写 4-6x')).toBe('invalid');
  });

  it('和技能共存：/写、/goal 不再点名叫这两个名字的技能，其余照旧', () => {
    const names = ['写', 'goal', 'Goal', '写法', '立项流程'];
    expect(invokedSkillNames('/写', names)).toEqual([]);
    expect(invokedSkillNames('/写 1-3', names)).toEqual([]);
    expect(invokedSkillNames('/goal', names)).toEqual([]);
    expect(invokedSkillNames('/Goal 看看', names)).toEqual([]);
    expect(invokedSkillNames('/写法 /立项流程', names)).toEqual(['写法', '立项流程']);
    expect(invokedSkillNames('/立项流程 /写', names)).toEqual(['立项流程']);
    expect(kind('/写 1-3')).toBe('range');
  });
});
