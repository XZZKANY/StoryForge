import { expect, test } from 'vitest';

import {
  buildChapterHandoff,
  discussNextChapterPrompt,
  excerptChapterTail,
  HANDOFF_EXCERPT_MAX_CHARS,
  pickUpPromisePrompt,
  stalePromiseDetail,
} from '../src/lib/chapter-handoff';
import type { ObservatoryPromise, ObservatoryPromises } from '../src/lib/observations';

const chapters = [1, 2, 3, 4, 5].map((ordinal) => ({
  ordinal,
  relativePath: `正文/第00${ordinal}章.md`,
}));

function promise(overrides: Partial<ObservatoryPromise> = {}): ObservatoryPromise {
  return {
    id: 'p1',
    title: '十七楼幸存者目击线',
    status: 'planted',
    kind: 'foreshadow',
    plantedChapter: 1,
    dueChapter: null,
    resolvedChapter: null,
    lastTouchChapter: 1,
    issues: [],
    ...overrides,
  };
}

function ledger(...entries: ObservatoryPromise[]): ObservatoryPromises {
  return { currentChapter: 5, ledger: entries };
}

const TAIL = [
  '陈默没接话。他把面饼掰成小块，一块一块送进嘴里。',
  '就在这时，远处传来一声喇叭。',
  '窗外的雾还没散。三声之后，再也没有别的声响。陈默把最后一块面饼塞进嘴里，嚼碎，咽下去。',
].join('\n\n');

test('交接取阅读序最后一章、下一章与起草按钮同一推导，并摘上一章最后一段', () => {
  const handoff = buildChapterHandoff({
    chapters,
    previousChapter: { relativePath: '正文/第005章.md', tail: TAIL },
    promises: ledger(promise()),
  });
  expect(handoff.lastChapter?.ordinal).toBe(5);
  expect(handoff.next).toMatchObject({ chapterOrdinal: 6, targetPath: '正文/第006章.md' });
  expect(handoff.excerpt).toEqual([
    '窗外的雾还没散。三声之后，再也没有别的声响。陈默把最后一块面饼塞进嘴里，嚼碎，咽下去。',
  ]);
  expect(handoff.excerptClipped).toBe(true);
  expect(handoff.excerptSource).toBe('正文/第005章.md');
});

test('后端给的上一章不是阅读序最后一章时不引用，宁可不说也不说错', () => {
  const handoff = buildChapterHandoff({
    chapters,
    previousChapter: { relativePath: '正文/第004章.md', tail: TAIL },
    promises: null,
  });
  expect(handoff.excerpt).toBeNull();
  expect(handoff.excerptSource).toBeNull();
});

test('路径比较忽略反斜杠与大小写', () => {
  const handoff = buildChapterHandoff({
    chapters,
    previousChapter: { relativePath: '正文\\第005章.MD', tail: '短。' },
    promises: null,
  });
  expect(handoff.excerpt).toEqual(['短。']);
});

test('最后一段太短时向前补段，补不下整段就从句首截后半', () => {
  const longParagraph = `${'他走了很久。'.repeat(30)}终于看见了门。`;
  const excerpt = excerptChapterTail(`${longParagraph}\n\n“毛子。”`);
  expect(excerpt?.paragraphs.at(-1)).toBe('“毛子。”');
  expect(excerpt?.paragraphs).toHaveLength(2);
  expect(excerpt?.clipped).toBe(true);
  const first = excerpt!.paragraphs[0];
  expect(first.endsWith('终于看见了门。')).toBe(true);
  expect(first.startsWith('他走了很久。')).toBe(true);
  expect(excerpt!.paragraphs.join('').length).toBeLessThanOrEqual(HANDOFF_EXCERPT_MAX_CHARS);
});

test('单段超长从句子开头截断；没有句号时退到分句开头，不从词中间起', () => {
  const excerpt = excerptChapterTail(`${'甲乙丙丁戊己庚辛壬癸，'.repeat(20)}最后一句。`);
  expect(excerpt?.clipped).toBe(true);
  const [only] = excerpt!.paragraphs;
  expect(only.length).toBeLessThanOrEqual(HANDOFF_EXCERPT_MAX_CHARS);
  expect(only.endsWith('最后一句。')).toBe(true);
  expect(only.startsWith('甲乙丙')).toBe(true);
});

test('摘录跳过空行与标题行；全是空白就没有摘录', () => {
  expect(excerptChapterTail('# 第五章\n\n他笑了。')?.paragraphs).toEqual(['他笑了。']);
  expect(excerptChapterTail('\n\n  \n')).toBeNull();
});

test('只提久未推进或已到期的未回收伏笔，到期优先、再按闲置章数', () => {
  const handoff = buildChapterHandoff({
    chapters,
    previousChapter: null,
    promises: ledger(
      promise({ id: 'fresh', title: '新埋的线', plantedChapter: 4, lastTouchChapter: 4 }),
      promise({ id: 'old', title: '老线', plantedChapter: 1, lastTouchChapter: 1 }),
      promise({ id: 'resolved', title: '已收', resolvedChapter: 3, status: 'resolved' }),
      promise({
        id: 'due',
        title: '到期线',
        plantedChapter: 3,
        lastTouchChapter: 4,
        dueChapter: 6,
      }),
      promise({ id: 'older', title: '更老的线', plantedChapter: 2, lastTouchChapter: 2 }),
    ),
  });
  expect(handoff.stalePromises.map((entry) => entry.title)).toEqual(['到期线', '老线']);
  expect(stalePromiseDetail(handoff.stalePromises[0])).toBe('第 3 章埋下，计划第 6 章回收');
  expect(stalePromiseDetail(handoff.stalePromises[1])).toBe('第 1 章埋下，之后 4 章没再碰');
});

test('空手稿：没有上一章，下一章是第 1 章，提示词先问问题不写正文', () => {
  const handoff = buildChapterHandoff({ chapters: [], previousChapter: null, promises: null });
  expect(handoff.lastChapter).toBeNull();
  expect(handoff.next.chapterOrdinal).toBe(1);
  expect(handoff.stalePromises).toEqual([]);
  expect(discussNextChapterPrompt(handoff)).toContain('先别写正文');
  expect(discussNextChapterPrompt(handoff)).toContain('第 1 章');
});

test('聊下一章与接伏笔的提示词都点名章号并要求先别写正文', () => {
  const handoff = buildChapterHandoff({
    chapters,
    previousChapter: null,
    promises: ledger(promise()),
  });
  const discuss = discussNextChapterPrompt(handoff);
  expect(discuss).toContain('第 6 章还没动笔');
  expect(discuss).toContain('第 5 章的结尾');
  expect(discuss).toContain('先别写正文');
  expect(pickUpPromisePrompt(handoff, handoff.stalePromises[0])).toBe(
    '第 6 章想接上「十七楼幸存者目击线」（第 1 章埋下，之后 4 章没再碰）。先别写正文，给我三种接法，每种两三句话。',
  );
});
