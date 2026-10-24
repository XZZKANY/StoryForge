import { describe, expect, it } from 'vitest';
import type { AssistantContextBundle } from '../kernel/writingContext';
import { buildDraftPrompt } from './prompts';

const file = (relative_path: string, kind: string, excerpt: string) => ({
  path: `D:\\book\\${relative_path.replace(/\//g, '\\')}`,
  relative_path,
  kind,
  title: relative_path,
  excerpt,
});

const bundle: AssistantContextBundle = {
  project_root: 'D:\\book',
  current_file: 'D:\\book\\正文\\第003章.md',
  files: [
    file('设定/世界观.md', 'setting', '设定开头……'),
    file('正文/第002章.md', 'draft', '……第二章结尾'),
    file('正文/第001章.md', 'draft', '……第一章结尾'),
  ],
  summary: {},
  budget: null,
};
const payload = { file_path: '正文/第003章.md', instruction: '写第三章', context_bundle: bundle };
const settings = {
  block:
    '立项资料（全文）：项目里的大纲、人物、设定等资料，起草须与之一致。\n### 设定/世界观.md\n<<<SETTING\n设定全文\nSETTING>>>',
  paths: ['设定/世界观.md'],
  truncated: [],
  omitted: [],
};
const previous = ['正文/第002章.md', '第二章全文'] as const;

describe('buildDraftPrompt', () => {
  it('puts setting files whole before the excerpts and drops their duplicate excerpts', () => {
    const prompt = buildDraftPrompt(payload, null, previous, {
      settings,
      previousTruncated: false,
    });
    expect(prompt.indexOf('立项资料（全文）')).toBeLessThan(prompt.indexOf('项目上下文摘录'));
    expect(prompt).not.toContain('设定开头……');
    expect(prompt).not.toContain('……第二章结尾');
    expect(prompt).toContain('……第一章结尾');
    expect(prompt).toContain(
      '上一章（正文/第002章.md）全文：\n<<<PREVIOUS\n第二章全文\nPREVIOUS>>>',
    );
  });

  it('says "the ending" when the previous chapter was cut', () => {
    const prompt = buildDraftPrompt(payload, null, previous, { previousTruncated: true });
    expect(prompt).toContain('上一章（正文/第002章.md）的结尾：');
    expect(prompt).not.toContain('……第二章结尾');
  });

  it('keeps the old prompt when called the old way', () => {
    const prompt = buildDraftPrompt(payload, null, previous);
    expect(prompt).not.toContain('立项资料');
    expect(prompt).toContain('设定开头……');
    expect(prompt).toContain('……第二章结尾');
    expect(prompt).toContain('上一章（正文/第002章.md）的结尾：');
  });

  it('matches excerpts by path regardless of slash direction or case', () => {
    const prompt = buildDraftPrompt(
      {
        ...payload,
        context_bundle: { ...bundle, files: [file('Setting\\World.md', 'setting', '摘录')] },
      },
      null,
      null,
      { settings: { ...settings, paths: ['setting/world.md'] } },
    );
    expect(prompt).not.toContain('摘录');
  });
});
