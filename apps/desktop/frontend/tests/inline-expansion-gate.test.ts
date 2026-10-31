import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

// T08-F3：扩写授权由后端按作者指令单一事实源判定（剥离锚定正文块 + 否定闸）。
// 行间修订恒发 polish 档，前端不得再自带一份关键词表——Python/TS 两份判据必然各自漂移。
// 行间对话已按职责拆成几个文件：发请求的是 useInlineRequest，负断言覆盖整组。
const requestSource = readFileSync('src/components/editor/useInlineRequest.ts', 'utf8');
const source = [
  'useInlineChat.ts',
  'useInlineSession.ts',
  'useInlineDiff.ts',
  'useInlineRequest.ts',
  'inline-chat-session.ts',
]
  .map((name) => readFileSync(`src/components/editor/${name}`, 'utf8'))
  .join('\n');

test('行间修订恒请求 polish 档，扩写策略交后端判定', () => {
  assert.match(requestSource, /qualityGate: 'polish'/);
});

test('前端不再自带扩写关键词判定（单一事实源在后端）', () => {
  assert.doesNotMatch(source, /instructionAuthorizesExpansion/);
  assert.doesNotMatch(source, /EXPANSION_INSTRUCTION_KEYWORDS/);
});
