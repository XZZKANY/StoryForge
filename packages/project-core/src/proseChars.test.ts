import { describe, expect, it } from 'vitest';

import { countProseChars } from './proseChars';

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const EM_SPACE = ch(0x2003);
const BOM = ch(0xfeff);
const LINE_SEPARATOR = ch(0x2028);
// JS 正则 \s 的全部 25 个码点。
const WHITESPACE = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

describe('countProseChars', () => {
  it('counts every non-whitespace code point, punctuation included', () => {
    expect(countProseChars('')).toBe(0);
    expect(countProseChars('夜雪压在檐角，铜灯只亮了一半。')).toBe(15);
    expect(countProseChars('第01章 雪灯\n\n正文开始。')).toBe(11);
    expect(countProseChars('他 推\t门。' + ch(0x3000, 0xa0) + '\r\n')).toBe(4);
  });

  it('counts a supplementary-plane character once', () => {
    expect(countProseChars(ch(0x20000, 0x20001))).toBe(2);
    expect(countProseChars('林' + ch(0x2a6d6) + '舟')).toBe(3);
  });

  it('skips em-space indentation, a leading BOM and a pasted line separator', () => {
    expect(countProseChars(EM_SPACE + EM_SPACE + '他走了。')).toBe(4);
    expect(countProseChars(BOM + '第一章\n他走了。')).toBe(7);
    expect(countProseChars('他走了。' + LINE_SEPARATOR + '她来了。')).toBe(8);
    expect(countProseChars('100' + ch(0x202f) + 'km')).toBe(5);
  });

  it('treats exactly the 25 code points of JS \\s as whitespace', () => {
    expect(countProseChars(ch(...WHITESPACE))).toBe(0);
    for (const code of WHITESPACE) expect(countProseChars('字' + ch(code) + '字')).toBe(2);
    // 零宽空格与 NEL 不在 \s 里，照样算字。
    expect(countProseChars('字' + ch(0x200b) + '字')).toBe(3);
    expect(countProseChars('字' + ch(0x85) + '字')).toBe(3);
  });
});
