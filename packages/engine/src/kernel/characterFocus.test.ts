import { describe, expect, it } from 'vitest';
import { selectCharacterSources } from './characterFocus';

const characters =
  '# 主要人物\n作者说明。\n\n## 一、林舟\n### 性格\n林舟始终谨慎。\n\n## 二、沈禾\n沈禾不识字。\n\n## 三、统一写作边界\n不得让能力替代调查。';

describe('按本章需要取人物整节', () => {
  it('keeps a named character with all child sections and shared constraints', () => {
    const selected = selectCharacterSources(
      [{ path: '人物/主要人物.md', text: characters }],
      '林舟入城',
    );
    expect(selected[0].body).toContain('作者说明。');
    expect(selected[0].body).toContain('### 性格\n林舟始终谨慎。');
    expect(selected[0].body).not.toContain('沈禾不识字。');
    expect(selected[0].body).toContain('不得让能力替代调查。');
    expect(selected[0].focused).toBe(true);
  });

  it('keeps the whole source when names cannot be established or the author explicitly requests it', () => {
    for (const hint of ['', '继续写下一章', '读取人物/主要人物.md全部内容']) {
      expect(
        selectCharacterSources([{ path: '人物/主要人物.md', text: characters }], hint),
      ).toEqual([{ path: '人物/主要人物.md', body: characters, focused: false }]);
    }
  });

  it('selects named files and always carries a shared rules file', () => {
    const selected = selectCharacterSources(
      [
        { path: '人物/林舟.md', text: '# 林舟\n## 性格\n谨慎\n## 经历\n被人欺骗过' },
        { path: '人物/沈禾.md', text: '沈禾不识字。' },
        { path: '人物/通用规则.md', text: '人名与能力保持一致。' },
      ],
      '林舟独自行动',
    );
    expect(selected.map((item) => item.path)).toEqual(['人物/林舟.md', '人物/通用规则.md']);
    expect(selected[0].body).toContain('被人欺骗过');
  });

  it('ignores headings inside fenced examples', () => {
    const text = characters.replace('林舟始终谨慎。', '林舟始终谨慎。\n~~~\n## 假人物\n示例\n~~~');
    const selected = selectCharacterSources([{ path: '人物/主要人物.md', text }], '林舟入城');
    expect(selected[0].body).toContain('## 假人物\n示例');
    expect(selected[0].body).not.toContain('沈禾不识字。');
  });
});
