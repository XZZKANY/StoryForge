import { expect, it } from 'vitest';
import { pythonStrip } from './pythonText';

// 作者名字与正文段落按 Python str.strip 的空白集合裁剪：两边自然行为一致，不是模仿。
it('strips the Python whitespace set, which differs from String.prototype.trim', () => {
  expect(pythonStrip('\u001c 林舟 \u001f')).toBe('林舟');
  expect(pythonStrip('　老王\u0085')).toBe('老王');
  expect(pythonStrip('﻿林舟')).toBe('﻿林舟');
  expect('﻿林舟'.trim()).toBe('林舟');
  expect(pythonStrip(' \t\r\n')).toBe('');
});
