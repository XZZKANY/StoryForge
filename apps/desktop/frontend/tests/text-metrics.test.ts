import assert from 'node:assert/strict';
import { test } from 'vitest';

import { countCjkChars, countParagraphs, countProseChars } from '../src/lib/text-metrics';

test('网文计字：数非空白字符，标点计入，空白不计', () => {
  assert.equal(countProseChars(''), 0);
  assert.equal(countProseChars('   \n\t'), 0);
  assert.equal(countProseChars('夜雪压在檐角，铜灯只亮了一半。'), 15);
  assert.equal(countProseChars('第01章 雪灯\n\n正文开始。'), 11);
});

test('网文计字：增补面字符按码点计 1，不按 UTF-16 码元计 2', () => {
  assert.equal(countProseChars('𠀀𠀁'), 2);
});

test('严格汉字口径只数汉字，与网文口径是两套数——别指望它们相等', () => {
  const line = '夜雪压在檐角，铜灯只亮了一半。';
  assert.equal(countCjkChars(line), 13); // 逗号、句号不算
  assert.equal(countProseChars(line), 15); // 标点算
  assert.equal(countCjkChars('Chapter 1 雪灯'), 2);
  assert.equal(countCjkChars(''), 0);
});

test('段落按空行切分，纯空白段不计', () => {
  assert.equal(countParagraphs(''), 0);
  assert.equal(countParagraphs('第一段。\n\n第二段。'), 2);
  assert.equal(countParagraphs('第一段。\n\n   \n\n第二段。'), 2);
  assert.equal(countParagraphs('单段无空行\n换行不分段'), 1);
});
