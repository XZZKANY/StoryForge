// 10-28 丢稿事故：整文件修订的新稿截在半句，原文第五卷与七、八两节整段没了，作者接受后落盘。
import { describe, expect, it } from 'vitest';
import { truncationWarning } from './revisionTruncation';

const BEFORE = [
  '# 总纲',
  '',
  '## 一、作品定位',
  '',
  '底层散修林远以誊抄、搬运起家，在寿元与资源的压迫下慢慢经营。',
  '',
  '## 五、主要人物关系',
  '',
  '许文山是货栈掌柜，只认账目不认交情。',
  '',
  '## 六、分卷路线',
  '',
  '## 第一卷：一席之地',
  '',
  '林远在坊市站稳脚跟，代价是一次主动退赔。',
  '',
  '## 第五卷：筑基以后',
  '',
  '筑基后只逐步打开新局面，不提前透支金丹以上细节。',
  '',
  '## 七、伏笔与资源账目原则',
  '',
  '每一笔灵石进出都要有来处与去处。',
  '',
  '## 八、不可违背的写作边界',
  '',
  '配角按自身利益行动，不集体降智。',
  '',
].join('\n');

/** 前五节照抄、第六节扩成章目，写到第一卷第 2 章半句就断了；比原文还长。 */
const TRUNCATED = [
  '# 总纲',
  '',
  '## 一、作品定位',
  '',
  '底层散修林远以誊抄、搬运起家，在寿元与资源的压迫下慢慢经营。',
  '',
  '## 五、主要人物关系',
  '',
  '许文山是货栈掌柜，只认账目不认交情。',
  '',
  '## 六、卷→章→场景三级总目',
  '',
  '## 第一卷：一席之地',
  '',
  '### 第1章　坊市零工',
  '本章事件：林远在坊市打零工，替货栈誊抄旧账，第一次看见样本册的价钱。',
  '',
  '### 第2章　一笔损耗',
  '本章事件：搬运途中摔碎两只药瓶，林远照价赔付，攒了半年的灵石去了一半。',
  '',
  '### 第3章　账目与货样',
  '本章事件：许文山让他核对一批旧货样，他发现账上多记了三成损耗，没有声张。',
  '',
  '### 第4章　册外之学',
  '本章事件：冲关牵动多年旧伤，林远只能依靠既有积累与',
].join('\n');

describe('整文件修订的截断检测', () => {
  it('事故形状：原文第五卷与七、八节整段缺失、新稿停在半句，即便新稿比原文长也报', () => {
    expect(Array.from(TRUNCATED).length).toBeGreaterThan(Array.from(BEFORE).length);
    const warning = truncationWarning(BEFORE, TRUNCATED);
    expect(warning).not.toBeNull();
    expect(warning!.missing_headings).toEqual([
      '第五卷：筑基以后',
      '七、伏笔与资源账目原则',
      '八、不可违背的写作边界',
    ]);
    expect(warning!.missing_line_count).toBe(7);
    expect(warning!.message).toContain('AI 的输出可能没写完');
    expect(warning!.message).toContain('『七、伏笔与资源账目原则』『八、不可违背的写作边界』');
    expect(warning!.message).toContain('停在半句（「…，林远只能依靠既有积累与」）');
  });

  it('新稿停在空节标题上同样算没写完', () => {
    const cut = TRUNCATED.split('\n').slice(0, -1).join('\n');
    expect(truncationWarning(BEFORE, cut)?.missing_headings).toContain('八、不可违背的写作边界');
  });

  it('作者要求删减：新稿变短但以句号收尾，不报', () => {
    const shortened = BEFORE.split('\n').slice(0, 20).join('\n');
    expect(truncationWarning(BEFORE, shortened)).toBeNull();
  });

  it('删掉末尾几节、停在原文某一整行上（哪怕那行没有句号），不报', () => {
    const before = [
      '## 一、设定',
      '- 境界：练气。',
      '- 灵根：三灵根。',
      '- 寿元：一百二十载',
      '## 二、路线',
      '林远先求活。',
      '## 三、边界',
      '不写降智配角。',
    ].join('\n');
    const after = before.split('\n').slice(0, 4).join('\n');
    expect(truncationWarning(before, after)).toBeNull();
  });

  it('列表项本来就不带句号的稿子，末尾改写成不带句号的列表不算停在半句', () => {
    const before = [
      '## 生存法则',
      '- **资源**：灵石是硬通货。',
      '- **寿元**：时间是最大的敌人。',
      '- **宗门**：外门弟子朝不保夕。',
      '- **散修**：独来独往，处处受限。',
    ].join('\n');
    const after = [
      '## 生存法则(分层动态)',
      '- **资源**：灵石是硬通货。',
      '- **底层**:先活下来,再谈修炼',
      '- **中层**:靠师门,也受师门所制',
      '- **寿元焦虑始终存在**:时间是每个修士最大的敌人',
    ].join('\n');
    expect(truncationWarning(before, after)).toBeNull();
  });

  it('只差最后一行：改写了末行不报，照抄末行抄到一半才报', () => {
    const before =
      '第一章 风起\n\n林舟推开门。\n\n院子里的雪已经积到脚踝。\n\n沈禾在廊下等他，手里提着一盏快灭的灯。\n';
    const rewrittenLast =
      '第一章 风起\n\n林舟推开门。\n\n院子里的雪已经积到脚踝。\n\n沈禾候在廊下，灯火将熄未熄\n';
    expect(truncationWarning(before, rewrittenLast)).toBeNull();
    const cutCopy =
      '第一章 风起\n\n林舟一脚踹开了门。\n\n院子里的雪已经积到脚踝。\n\n沈禾在廊下等他，手里提着\n';
    const warning = truncationWarning(before, cutCopy);
    expect(warning?.missing_line_count).toBe(1);
    expect(warning?.missing_headings).toEqual([]);
    expect(warning?.message).toContain('原文最后 1 段（从「沈禾在廊下等他，手里提着」起）');
  });

  it('整篇重写、新稿里找不到任何原文行时不下结论', () => {
    expect(truncationWarning(BEFORE, '全新的一份大纲，写到这里')).toBeNull();
  });
});
