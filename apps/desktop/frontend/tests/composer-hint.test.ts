/**
 * 输入框「下一句」提示的规则：每条命中、优先级、问句尾巴、空章时的章号。
 */
import { describe, expect, test } from 'vitest';

import type { ProjectSetupFacts } from '../src/lib/api/project-setup';
import {
  COMPOSER_HINT_TAB_SUFFIX,
  composerHint,
  endsWithQuestion,
  type ComposerHintInput,
} from '../src/lib/composer-hint';

const chapters = [1, 2, 3, 4, 5].map((ordinal) => ({
  ordinal,
  relativePath: `正文/第00${ordinal}章.md`,
  estimatedChars: 3000,
}));
const emptyBook: ProjectSetupFacts = {
  hasManuscript: false,
  missing: ['outline', 'character', 'setting'],
};
const setupDone: ProjectSetupFacts = { hasManuscript: false, missing: [] };

function hint(overrides: Partial<ComposerHintInput>): string | null {
  return composerHint({
    running: false,
    newSession: false,
    lastAssistantText: null,
    justAcceptedPath: null,
    setup: null,
    chapters: null,
    ...overrides,
  });
}

describe('规则 1：AI 运行中不提示', () => {
  test('运行中压过刚接受、问句、新会话', () => {
    expect(
      hint({
        running: true,
        newSession: true,
        lastAssistantText: '要不要先写第四章？',
        justAcceptedPath: '正文/第003章.md',
        setup: setupDone,
        chapters,
      }),
    ).toBeNull();
  });
});

describe('规则 2：刚接受', () => {
  test('a. 接受最新一章正文 → 接着写第 N+1 章（反斜杠路径也认）', () => {
    expect(hint({ justAcceptedPath: '正文\\第005章.md', chapters })).toBe('接着写第 6 章');
    expect(hint({ justAcceptedPath: '正文/第005章.md', chapters })).toBe('接着写第 6 章');
  });

  test('a. 接受的是前面某章：下一章已经有了，不出这条，往下走', () => {
    expect(hint({ justAcceptedPath: '正文/第003章.md', chapters })).toBeNull();
    expect(
      hint({ justAcceptedPath: '正文/第003章.md', chapters, lastAssistantText: '还改哪里？' }),
    ).toBe('按你的建议来');
  });

  test('a. 最后一章还空着：接着写的就是那个空章', () => {
    const withBlank = [...chapters.slice(0, 4), { ...chapters[4], estimatedChars: 0 }];
    expect(hint({ justAcceptedPath: '正文/第004章.md', chapters: withBlank })).toBe(
      '接着写第 5 章',
    );
  });

  test('a. 章节列表还没刷新到这一章时不编章号', () => {
    expect(hint({ justAcceptedPath: '正文/第006章.md', chapters })).toBeNull();
    expect(hint({ justAcceptedPath: '正文/第001章.md', chapters: null })).toBeNull();
  });

  test('b. 接受立项文件、还缺总纲 → 接着写总纲；总纲有了缺人物 → 接着建主角人物', () => {
    expect(
      hint({
        justAcceptedPath: '人物/主角.md',
        setup: { hasManuscript: false, missing: ['outline', 'setting'] },
      }),
    ).toBe('接着写总纲');
    expect(
      hint({
        justAcceptedPath: '大纲/总纲.md',
        setup: { hasManuscript: false, missing: ['character', 'setting'] },
      }),
    ).toBe('接着建主角人物');
  });

  test('b. 只缺世界规则、或已经有正文、或接受的不是立项文件，都不出这一类', () => {
    const lastAssistantText = '这样写行吗？';
    expect(
      hint({
        justAcceptedPath: '大纲/总纲.md',
        setup: { hasManuscript: false, missing: ['setting'] },
        lastAssistantText,
      }),
    ).toBe('按你的建议来');
    expect(
      hint({
        justAcceptedPath: '人物/主角.md',
        setup: { hasManuscript: true, missing: ['outline'] },
      }),
    ).toBeNull();
    expect(
      hint({
        justAcceptedPath: '伏笔/线索.md',
        setup: { hasManuscript: false, missing: ['outline'] },
      }),
    ).toBeNull();
    expect(hint({ justAcceptedPath: '人物/主角.md', setup: null })).toBeNull();
  });

  test('c. 立项已齐、还没有正文 → 开写第一章（压过 AI 的问句）', () => {
    expect(
      hint({
        justAcceptedPath: '设定/世界规则.md',
        setup: setupDone,
        lastAssistantText: '还要再补点什么吗？',
      }),
    ).toBe('开写第一章');
  });

  test('刚接受压过问句', () => {
    expect(
      hint({
        justAcceptedPath: '正文/第005章.md',
        chapters,
        lastAssistantText: '下一章想往哪边走？',
      }),
    ).toBe('接着写第 6 章');
  });
});

describe('规则 3：AI 最后一句是问句', () => {
  test.each([
    '你想先写哪条线？',
    '要不要叫「雾港」？」',
    '**先定主角吗?**',
    '就按这个来？  \n\n',
    '> 你觉得呢？\n',
    '还是换成第二种（更慢一点）？）',
    '`要改名吗？`',
  ])('%j 算问句', (text) => {
    expect(endsWithQuestion(text)).toBe(true);
    expect(hint({ lastAssistantText: text })).toBe('按你的建议来');
  });

  test.each(['好的，已经写进去了。', '你确定？不，我是说先放一放。', '', '「这是谁？」他说'])(
    '%j 不算问句',
    (text) => {
      expect(endsWithQuestion(text)).toBe(false);
      expect(hint({ lastAssistantText: text })).toBeNull();
    },
  );

  test('问句压过立项已齐的「开写第一章」', () => {
    expect(hint({ lastAssistantText: '先聊聊主角？', setup: setupDone })).toBe('按你的建议来');
  });
});

describe('规则 4：立项已齐、还没有正文', () => {
  test('旧会话里也提示开写第一章', () => {
    expect(hint({ setup: setupDone })).toBe('开写第一章');
    expect(hint({ setup: setupDone, newSession: true })).toBe('开写第一章');
  });

  test('已经有正文就不提示', () => {
    expect(hint({ setup: { hasManuscript: true, missing: [] } })).toBeNull();
  });
});

describe('规则 5：新会话、空书', () => {
  test('三类立项文件一份都没有、也没有正文 → 先聊聊这本书想写什么', () => {
    expect(hint({ newSession: true, setup: emptyBook, chapters: [] })).toBe('先聊聊这本书想写什么');
  });

  test('有一类立项文件、读不出立项事实、或不是新会话，都不算空书', () => {
    expect(
      hint({
        newSession: true,
        setup: { hasManuscript: false, missing: ['character', 'setting'] },
        chapters: [],
      }),
    ).toBeNull();
    expect(hint({ newSession: true, setup: null, chapters: [] })).toBeNull();
    expect(hint({ newSession: false, setup: emptyBook, chapters: [] })).toBeNull();
  });
});

describe('规则 6：新会话、已写到第 N−1 章', () => {
  test('N 取「接着写」的下一章', () => {
    expect(hint({ newSession: true, chapters })).toBe('先聊聊第 6 章怎么写');
  });

  test('最后一章空着时 N 就是那个空章', () => {
    const withBlank = [
      ...chapters.slice(0, 2),
      { ordinal: 3, relativePath: '正文/第003章.md', estimatedChars: 5 },
    ];
    expect(hint({ newSession: true, chapters: withBlank })).toBe('先聊聊第 3 章怎么写');
  });

  test('只有一个空章、还没写到任何一章，不出这一条', () => {
    const onlyBlank = [{ ordinal: 1, relativePath: '正文/第001章.md', estimatedChars: 0 }];
    expect(hint({ newSession: true, chapters: onlyBlank })).toBeNull();
  });

  test('旧会话、章节还没读到都不提示', () => {
    expect(hint({ newSession: false, chapters })).toBeNull();
    expect(hint({ newSession: true, chapters: null })).toBeNull();
  });
});

test('灰字后缀是全角空格加 Tab 说明', () => {
  expect(COMPOSER_HINT_TAB_SUFFIX).toBe('\u3000· Tab 填入');
});
