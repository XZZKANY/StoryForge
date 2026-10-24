import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_SKILLS_MAX,
  BreakdownSkillsError,
  craftMetrics,
  craftMetricsText,
  parseBreakdownSkills,
} from './breakdownSkills';
import { parseWritingSkill } from './writingSkills';

describe('craftMetrics', () => {
  it('measures length, paragraphs, dialogue share, first line of dialogue and hook endings', () => {
    const metrics = craftMetrics([
      '主角在门外站了很久。\n“你来了。”她说。\n他没答话？',
      '雨下了一夜。\n第二天一早，城门开了。',
    ]);
    // 24 + 17 字、5 段、对白 6 字、第一句对白前 10 字。
    expect(metrics).toEqual({
      chapter_count: 2,
      avg_chapter_chars: 21,
      avg_paragraph_chars: 8,
      dialogue_percent: 15,
      first_dialogue_offset: 10,
      hook_endings: 1,
    });
    expect(craftMetricsText(metrics!)).toBe(
      '程序从代表章节实测（2 章）：\n- 每章平均 21 字\n- 段落平均 8 字\n- 对白约占 15%\n' +
        '- 每章第一句对白出现在第 10 字前后（中位数）\n- 1 / 2 章最后一段是对白或问句',
    );
  });

  it('returns null without any text and leaves out the dialogue line without dialogue', () => {
    expect(craftMetrics(['', '  \n'])).toBeNull();
    expect(craftMetricsText(craftMetrics(['没有对白的一章。'])!)).not.toContain('第一句对白');
  });
});

describe('parseBreakdownSkills', () => {
  const skill = (name: string) => ({ name, when: '写第 1 章', body: '- 先让事情发生。' });

  it('keeps complete skills, writes files the skill reader understands', () => {
    const skills = parseBreakdownSkills(
      `好的：\n{"skills": [${JSON.stringify(skill('开篇: 抓人/快'))}]}\n以上。`,
      '拆书 · 参考/书.txt',
    );
    expect(skills).toHaveLength(1);
    expect(skills[0].file_name).toBe('01-开篇-抓人-快.md');
    expect(parseWritingSkill(`写法/${skills[0].file_name}`, skills[0].content)).toEqual({
      path: `写法/${skills[0].file_name}`,
      name: '开篇: 抓人/快',
      when: '写第 1 章',
      body: '- 先让事情发生。',
    });
    expect(skills[0].content).toContain('来源：拆书 · 参考/书.txt');
  });

  it('drops incomplete and repeated ones and keeps at most five', () => {
    const many = Array.from({ length: BREAKDOWN_SKILLS_MAX + 3 }, (_, index) =>
      skill(`写法${index}`),
    );
    const raw = JSON.stringify({
      skills: [{ name: '缺用途', body: 'x' }, skill('写法0'), ...many],
    });
    const names = parseBreakdownSkills(raw, '拆书').map((item) => item.name);
    expect(names).toEqual(['写法0', '写法1', '写法2', '写法3', '写法4']);
  });

  it('says why when nothing usable came back', () => {
    expect(() => parseBreakdownSkills('', '拆书')).toThrow(BreakdownSkillsError);
    expect(() => parseBreakdownSkills('不是 JSON', '拆书')).toThrow('写法 skill 不是有效 JSON。');
    expect(() => parseBreakdownSkills('{"skills": []}', '拆书')).toThrow('一份可用的都没有');
    expect(() => parseBreakdownSkills('{"items": []}', '拆书')).toThrow('缺少 skills 列表');
  });
});
