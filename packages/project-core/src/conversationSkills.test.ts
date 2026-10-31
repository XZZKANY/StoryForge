import { describe, expect, it } from 'vitest';

import {
  completeSkillCommand,
  invokedSkillNames,
  isWriteBatchCommandWord,
  skillCommandQuery,
  startsWithSkillCommand,
} from './conversationSkills';

const NAMES = ['立项流程', '审稿口径', '审稿', '本书禁用词'];

describe('消息开头的技能点名', () => {
  it('认开头连着的几个点名，名字后面是空白或消息结尾', () => {
    expect(invokedSkillNames('/立项流程', NAMES)).toEqual(['立项流程']);
    expect(invokedSkillNames('  /立项流程 下一步干什么', NAMES)).toEqual(['立项流程']);
    expect(invokedSkillNames('/立项流程 /本书禁用词\n写第一章', NAMES)).toEqual([
      '立项流程',
      '本书禁用词',
    ]);
    expect(invokedSkillNames('/立项流程　下一步', NAMES)).toEqual(['立项流程']);
  });

  it('中文输入法打出的「、」和全角「／」也认', () => {
    expect(invokedSkillNames('、立项流程 下一步', NAMES)).toEqual(['立项流程']);
    expect(invokedSkillNames('／审稿口径', NAMES)).toEqual(['审稿口径']);
  });

  it('按最长名字匹配，名字只是前缀时不算', () => {
    expect(invokedSkillNames('/审稿口径 看看', NAMES)).toEqual(['审稿口径']);
    expect(invokedSkillNames('/审稿 看看', NAMES)).toEqual(['审稿']);
    expect(invokedSkillNames('/审稿口径看看', NAMES)).toEqual([]);
  });

  it('不在开头、认不出、或认不出之后的点名都不算', () => {
    expect(invokedSkillNames('按 /立项流程 来', NAMES)).toEqual([]);
    expect(invokedSkillNames('/不存在 /立项流程', NAMES)).toEqual([]);
    expect(invokedSkillNames('/立项流程 按 /审稿口径', NAMES)).toEqual(['立项流程']);
    expect(invokedSkillNames('比例是 1/2', NAMES)).toEqual([]);
    expect(invokedSkillNames('', NAMES)).toEqual([]);
    expect(invokedSkillNames('/立项流程', [])).toEqual([]);
  });

  it('去重，最多三个', () => {
    expect(invokedSkillNames('/立项流程 /立项流程 /审稿', NAMES)).toEqual(['立项流程', '审稿']);
    expect(invokedSkillNames('/立项流程 /审稿口径 /审稿 /本书禁用词', NAMES)).toEqual([
      '立项流程',
      '审稿口径',
      '审稿',
    ]);
  });

  it('/写、/goal 是批量写章指令，不再点名叫这两个名字的技能', () => {
    expect(invokedSkillNames('/写 4-10', ['写', ...NAMES])).toEqual([]);
    expect(invokedSkillNames('、写', ['写'])).toEqual([]);
    expect(invokedSkillNames('/GOAL', ['GOAL', 'goal'])).toEqual([]);
    expect(invokedSkillNames('/立项流程 /写', ['写', ...NAMES])).toEqual(['立项流程']);
    expect(isWriteBatchCommandWord('写')).toBe(true);
    expect(isWriteBatchCommandWord('Goal')).toBe(true);
    expect(isWriteBatchCommandWord('写法')).toBe(false);
    expect(isWriteBatchCommandWord('goals')).toBe(false);
  });

  it('只看触发符的开头判断', () => {
    expect(startsWithSkillCommand(' /x')).toBe(true);
    expect(startsWithSkillCommand('、')).toBe(true);
    expect(startsWithSkillCommand('写 /x')).toBe(false);
  });
});

describe('输入框里正在打的点名', () => {
  it('只有开头的点名、最后一个还没打空格时才给出正在打的字', () => {
    expect(skillCommandQuery('/')).toBe('');
    expect(skillCommandQuery('、立项')).toBe('立项');
    expect(skillCommandQuery('/立项流程 /审')).toBe('审');
    expect(skillCommandQuery('/立项流程 ')).toBeNull();
    expect(skillCommandQuery('/立项流程 下一步')).toBeNull();
    expect(skillCommandQuery('写 /')).toBeNull();
    expect(skillCommandQuery('')).toBeNull();
  });

  it('补全时把正在打的那个换成半角 / 加名字和空格', () => {
    expect(completeSkillCommand('、立项', '立项流程')).toBe('/立项流程 ');
    expect(completeSkillCommand('/立项流程 ／审', '审稿口径')).toBe('/立项流程 /审稿口径 ');
  });
});
