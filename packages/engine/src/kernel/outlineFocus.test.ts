import { describe, expect, it } from 'vitest';
import { codePoints } from './pythonText';
import { focusOutline, outlineFocusNote } from './outlineFocus';

const filler = (label: string, chars: number) =>
  `${label}。`.repeat(Math.ceil(chars / (label.length + 1)));
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 照真书总纲的骨架：定位、人物、八卷、开篇十章节点、伏笔，节点排在卷后面、不挂在卷下。 */
function bookOutline(): string {
  const volumes = NUMERALS.slice(0, 8)
    .map(
      (numeral, index) =>
        `### 第${numeral}卷：卷名${index + 1}\n\n${filler(`卷${index + 1}安排`, 300)}`,
    )
    .join('\n\n');
  const nodes = NUMERALS.map(
    (numeral, index) =>
      `### 第${numeral}章：节点${index + 1}\n\n${filler(`节点${index + 1}内容`, 110)}`,
  ).join('\n\n');
  return [
    '# 某书·总纲',
    '> 初稿待审。',
    `## 一、作品定位\n\n${filler('定位', 400)}`,
    `## 二、主要人物\n\n${filler('人物', 3000)}`,
    `## 三、八卷总纲\n\n${volumes}`,
    `## 四、开篇十章节点\n\n${nodes}`,
    `## 五、伏笔与回收\n\n${filler('伏笔', 700)}`,
  ].join('\n\n');
}

const headingsOf = (text: string) => text.split('\n').filter((line) => line.startsWith('#'));

describe('focusOutline', () => {
  it('returns null when the outline has no Markdown headings, so the caller keeps the head cut', () => {
    expect(focusOutline(filler('没有标题', 9000), 5, 6000)).toBeNull();
  });

  it('returns null when the headings alone do not fit', () => {
    const many = Array.from(
      { length: 400 },
      (_, index) => `## 第${index + 1}章：很长很长的标题`,
    ).join('\n');
    expect(focusOutline(many, 5, 600)).toBeNull();
  });

  it('keeps every heading and puts the chapter node and the next two in full, where the head cut lost them', () => {
    const text = bookOutline();
    expect(codePoints(text).length).toBeGreaterThan(6000);
    // 只取开头时第五章节点在截断处之后。
    expect(codePoints(text).slice(0, 6000).join('')).not.toContain('节点5内容');

    const focused = focusOutline(text, 5, 6000)!;
    expect(codePoints(focused).length).toBeLessThanOrEqual(6000);
    expect(headingsOf(focused)).toEqual(headingsOf(text));
    for (const node of [5, 6, 7]) expect(focused).toContain(`节点${node}内容`);
    expect(focused).not.toContain('节点8内容');
    // 写过的章的节点排在其余小节之后，额度先给定位、人物与卷。
    expect(focused).toContain('卷1安排');
    expect(focused).toContain('人物。');
  });

  it('fills the sections in their original order when there is no chapter number', () => {
    const text = bookOutline();
    const focused = focusOutline(text, null, 6000)!;
    expect(codePoints(focused).length).toBeLessThanOrEqual(6000);
    expect(headingsOf(focused)).toEqual(headingsOf(text));
    expect(focused).toContain('定位。');
    expect(focused).toContain('卷1安排');
    expect(focused).not.toContain('伏笔。');
  });

  it('puts the volume whose chapter range covers the chapter ahead of everything but the nodes', () => {
    const text = [
      '# 总纲',
      `## 世界\n\n${filler('世界', 2500)}`,
      `## 第一卷：起（第1—40章）\n\n${filler('第一卷安排', 1500)}`,
      `## 第二卷：承\n\n本卷第41—80章。\n\n${filler('第二卷安排', 1500)}`,
    ].join('\n\n');
    const focused = focusOutline(text, 50, 2500)!;
    expect(focused).toContain('第二卷安排');
    expect(focused).not.toContain('第一卷安排');
  });

  it('treats the volume holding the chapter node as the current volume when no ranges are written', () => {
    const text = [
      '# 总纲',
      `## 世界\n\n${filler('世界', 2000)}`,
      `## 第一卷：起\n\n${filler('第一卷概要', 300)}\n\n### 第三章：入城\n\n${filler('第三章安排', 200)}`,
      `## 第二卷：承\n\n${filler('第二卷概要', 300)}`,
    ].join('\n\n');
    const focused = focusOutline(text, 3, 700)!;
    expect(focused).toContain('第三章安排');
    expect(focused).toContain('第一卷概要');
    expect(focused).not.toContain('第二卷概要');
  });

  it('reads chapter ranges and Chinese numerals in node headings', () => {
    const text = [
      '# 总纲',
      `## 世界\n\n${filler('世界', 3000)}`,
      `## 第11—20章：入京\n\n${filler('入京安排', 200)}`,
      `## 第二十一章：出京\n\n${filler('出京安排', 200)}`,
    ].join('\n\n');
    const focused = focusOutline(text, 15, 300)!;
    expect(focused).toContain('入京安排');
    expect(focused).not.toContain('出京安排');
    expect(focusOutline(text, 21, 300)).toContain('出京安排');
  });

  it('cuts into the chapter node rather than leaving it out when only part of it fits', () => {
    const text = ['# 总纲', `## 第五章：大场面\n\n${filler('第五章安排', 3000)}`].join('\n\n');
    const focused = focusOutline(text, 5, 1000)!;
    expect(codePoints(focused).length).toBeLessThanOrEqual(1000);
    expect(focused).toContain('第五章安排');
    expect(focused.endsWith('……')).toBe(true);
  });

  it('does not take # lines inside a code block for headings', () => {
    const text = [
      '# 总纲',
      '```',
      '# 不是标题',
      '```',
      `## 第一章：开场\n\n${filler('开场', 200)}`,
    ].join('\n');
    // 当成标题的话，代码块会被拆成两段、中间多出空行。
    expect(focusOutline(text, 1, 800)).toContain('# 总纲\n```\n# 不是标题\n```\n\n## 第一章：开场');
  });

  it('stays inside the room for every chapter of the book', () => {
    const text = bookOutline();
    for (const room of [1500, 3000, 6000])
      for (let ordinal = 1; ordinal <= 30; ordinal += 1)
        expect(codePoints(focusOutline(text, ordinal, room)!).length).toBeLessThanOrEqual(room);
  });

  it('leaves the headings of an outline numbered across volumes as written', () => {
    expect(focusOutline(bookOutline(), 5, 6000)).not.toContain('全书第');
  });
});

/** 照 10-31 实验书总纲的骨架：卷是二级标题、章是卷下的三级标题，每卷都从第1章编起。 */
function perVolumeOutline(): string {
  const volume = (numeral: string, name: string, chapters: number) =>
    [
      `## 第${numeral}卷：${name}\n\n${filler(`${name}卷目标`, 120)}`,
      ...Array.from(
        { length: chapters },
        (_, index) =>
          `### 第${index + 1}章\u3000${name}${index + 1}\n${filler(`${name}卷第${index + 1}章场景`, 150)}`,
      ),
    ].join('\n\n');
  return [
    '# 总纲',
    `## 一、作品定位\n\n${filler('定位', 2000)}`,
    '## 六、卷→章→场景三级总目',
    volume('一', '起', 18),
    volume('二', '承', 24),
    volume('三', '转', 30),
    volume('四', '合', 30),
  ].join('\n\n');
}

describe('focusOutline on an outline that restarts chapter numbers in every volume', () => {
  it('picks the second volume’s first chapter for book chapter 19, not the later volumes’ chapter 19', () => {
    const text = perVolumeOutline();
    const focused = focusOutline(text, 19, 6000)!;
    expect(codePoints(focused).length).toBeLessThanOrEqual(6000);
    for (const chapter of [1, 2, 3]) expect(focused).toContain(`承卷第${chapter}章场景`);
    expect(focused).toContain('### 第1章　承1（全书第19章）');
    expect(focused).toContain('承卷目标');
    expect(focused).not.toContain('转卷第19章场景');
    expect(focused).not.toContain('合卷第19章场景');
    // 只给本章及其后两章注全书章号，其余标题照原样。
    expect(focused).toContain('\n### 第4章　承4\n');
    expect(headingsOf(focused).filter((line) => line.includes('全书第'))).toHaveLength(3);
  });

  it('maps chapter 25 to the second volume’s seventh chapter and chapter 43 to the third volume’s first', () => {
    const text = perVolumeOutline();
    const at25 = focusOutline(text, 25, 6000)!;
    expect(at25).toContain('### 第7章　承7（全书第25章）');
    expect(at25).not.toContain('承卷第24章场景');
    expect(at25).not.toContain('转卷第25章场景');
    const at43 = focusOutline(text, 43, 6000)!;
    expect(at43).toContain('### 第1章　转1（全书第43章）');
    expect(at43).toContain('转卷第1章场景');
    expect(at43).not.toContain('合卷第1章场景');
  });

  it('still reads the first volume by its own numbers', () => {
    const focused = focusOutline(perVolumeOutline(), 5, 6000)!;
    expect(focused).toContain('### 第5章　起5（全书第5章）');
    expect(focused).toContain('起卷第5章场景');
    expect(focused).not.toContain('承卷第5章场景');
  });

  it('stays inside the room for every chapter of the book', () => {
    const text = perVolumeOutline();
    for (const room of [1500, 3000, 6000])
      for (let ordinal = 1; ordinal <= 102; ordinal += 1)
        expect(codePoints(focusOutline(text, ordinal, room)!).length).toBeLessThanOrEqual(room);
  });
});

describe('outlineFocusNote', () => {
  it('says how the sections were picked and what a bare heading means', () => {
    expect(outlineFocusNote(7797, 5)).toContain('按第 5 章挑');
    expect(outlineFocusNote(7797, null)).toContain('按原顺序');
    expect(outlineFocusNote(7797, 5)).toContain('只有标题的小节是略去了正文');
  });
});
