import assert from 'node:assert/strict';
import { test } from 'vitest';

import { countProseChars } from '../src/lib/text-metrics';

test('网文计字：数非空白字符，标点计入，空白不计', () => {
  assert.equal(countProseChars(''), 0);
  assert.equal(countProseChars('   \n\t'), 0);
  assert.equal(countProseChars('夜雪压在檐角，铜灯只亮了一半。'), 15);
  assert.equal(countProseChars('第01章 雪灯\n\n正文开始。'), 11);
});

test('网文计字：增补面字符按码点计 1，不按 UTF-16 码元计 2', () => {
  assert.equal(countProseChars('𠀀𠀁'), 2);
});
