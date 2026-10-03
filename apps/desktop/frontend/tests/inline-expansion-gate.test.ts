import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

// T08-F3：扩写授权由后端按作者指令单一事实源判定（剥离锚定正文块 + 否定闸）。
// 行间修订恒发 polish 档，前端不得再自带一份关键词表——Python/TS 两份判据必然各自漂移。
const source = readFileSync('src/components/editor/useInlineChat.ts', 'utf8');

test('行间修订恒请求 polish 档，扩写策略交后端判定', () => {
  assert.match(source, /qualityGate: 'polish'/);
});

test('前端不再自带扩写关键词判定（单一事实源在后端）', () => {
  assert.doesNotMatch(source, /instructionAuthorizesExpansion/);
  assert.doesNotMatch(source, /EXPANSION_INSTRUCTION_KEYWORDS/);
});
