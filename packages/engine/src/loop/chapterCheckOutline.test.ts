import { describe, expect, it } from 'vitest';
import { buildCheck, checkOutlineFrom, checkPrompt, checkSource } from './chapterCheckProtocol';

type Obj = { [key: string]: unknown };
const brief: Obj = { brief_id: 'b-1', goal: '进城', target_chars_min: 1, target_chars_max: 5000 };
const content = '第三章\n\n沈禾带林舟穿过城门。\n守卫说：“今晚宵禁。”\n林舟在客栈门口站住。\n';
const outline = {
  path: '大纲/总纲.md',
  text: '### 第3章　入城\n本章事件：林舟入城，在城门被守卫盘查。',
};
const reply = (findings: unknown[]) => JSON.stringify({ ...checkSource(content, brief), findings });
const outlineFinding = (severity: string): Obj => ({
  rule: 'outline_violation',
  severity,
  message: '总纲安排守卫盘查林舟，正文只写了守卫报宵禁。',
  line: 4,
  evidence: '守卫说：“今晚宵禁。”',
});

describe('chapter check against the book outline node of the chapter', () => {
  it('leaves the prompt as before when no outline node is given', () => {
    const prompt = checkPrompt(brief, content);
    expect(prompt).toBe(checkPrompt(brief, content, null));
    expect(prompt).not.toContain('outline_violation');
    expect(prompt).not.toContain('BOOK_OUTLINE_CHAPTER');
    expect(prompt).toMatch(/\nbrief：\{[^\n]*\}\n正文：\n/u);
  });

  it('puts the node between the brief and the draft and says how to judge it', () => {
    const prompt = checkPrompt(brief, content, outline);
    expect(prompt).toContain(
      `总纲本章那段（大纲/总纲.md）：\n<<<BOOK_OUTLINE_CHAPTER\n${outline.text}\nBOOK_OUTLINE_CHAPTER>>>\n正文：\n${content}`,
    );
    expect(prompt.indexOf('brief：')).toBeLessThan(prompt.indexOf('<<<BOOK_OUTLINE_CHAPTER'));
    expect(prompt).toContain('advisory, continuity_violation, forbidden_content, goal_violation');
    expect(prompt).toContain('missing_required_beat, outline_violation, pov_violation');
    expect(prompt).toContain(
      '正文没写到其中的本章事件，或把它写成了相反的结果，用 outline_violation，severity 为 hard',
    );
    expect(prompt).toContain('brief 只是没提到的，照总纲查');
  });

  it('sends a hard outline violation to repair', () => {
    const result = buildCheck(content, brief, reply([outlineFinding('hard')]), {
      outlineSupplied: true,
    });
    expect(result.status).toBe('repairable');
    expect(result.manuscript_hard_failure_count).toBe(1);
    expect((result.findings as Obj[])[0]).toMatchObject({
      rule: 'outline_violation',
      severity: 'hard',
    });
  });

  it('keeps an advisory outline finding as a note that does not stop the chapter', () => {
    const result = buildCheck(content, brief, reply([outlineFinding('advisory')]), {
      outlineSupplied: true,
    });
    expect(result.status).toBe('pass');
    expect(result.advisory_count).toBe(1);
  });

  it('does not accept outline_violation when the checker was not given the node', () => {
    const result = buildCheck(content, brief, reply([outlineFinding('hard')]));
    expect(result.execution_status).toBe('failed');
    expect((result.findings as Obj[]).map((item) => item.rule)).toEqual(['checker_failure']);
  });

  it('reads the node from the tool payload only when it has a path and some text', () => {
    expect(checkOutlineFrom(outline)).toEqual(outline);
    expect(checkOutlineFrom({ path: '大纲/总纲.md', text: '  ' })).toBeNull();
    expect(checkOutlineFrom({ text: outline.text })).toBeNull();
    expect(checkOutlineFrom(undefined)).toBeNull();
  });
});
