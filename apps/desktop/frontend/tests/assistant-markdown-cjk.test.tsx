import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AssistantMarkdown } from '../src/components/chat-window/AssistantMarkdown';
import { closeStreamingMarkdown } from '../src/components/chat-window/streaming-markdown';

test('bold that hugs Chinese text and starts with Chinese punctuation still renders bold', () => {
  // CommonMark 原规则下「是**「」**三」两侧都不算定界，星号会原样露出来；模型偏偏常这么写。
  const html = renderToStaticMarkup(
    <AssistantMarkdown content="第 5 章整体是**「醒来 → 处理伤口 → 决定下楼」**三段，前两段很稳。" />,
  );
  assert.match(html, /<strong>「醒来 → 处理伤口 → 决定下楼」<\/strong>/);
  assert.doesNotMatch(html, /\*\*/);
  const quote = renderToStaticMarkup(
    <AssistantMarkdown content="现在停在**「那块金属片」**，是个动作。" />,
  );
  assert.match(quote, /<strong>「那块金属片」<\/strong>/);
});

test('ordered and unordered lists keep their numbers and bullets', () => {
  const css = readFileSync('src/index.css', 'utf8');
  assert.match(css, /\.assistant-md ul\s*\{\s*list-style:\s*disc;/);
  assert.match(css, /\.assistant-md ol\s*\{\s*list-style:\s*decimal;/);
  assert.match(css, /\.assistant-md ul\.contains-task-list\s*\{\s*list-style:\s*none;/);
});

test('streaming text closes a half-written marker instead of showing raw asterisks', () => {
  assert.equal(closeStreamingMarkdown('关键在**节奏'), '关键在**节奏**');
  assert.equal(closeStreamingMarkdown('关键是**'), '关键是');
  assert.equal(closeStreamingMarkdown('**醒来*'), '**醒来**');
  assert.equal(closeStreamingMarkdown('**醒来** 然后'), '**醒来** 然后');
  assert.equal(closeStreamingMarkdown('读完了*'), '读完了');
  assert.equal(closeStreamingMarkdown('用 `fs.read'), '用 `fs.read`');
  assert.equal(closeStreamingMarkdown('`a**b` 然后'), '`a**b` 然后');
  assert.equal(closeStreamingMarkdown('```js\nconst a = 1'), '```js\nconst a = 1\n```');
  // 前面的段落已经完整，只补最后一段。
  assert.equal(closeStreamingMarkdown('第一段\n\n- **刘哥的伤'), '第一段\n\n- **刘哥的伤**');
  const html = renderToStaticMarkup(<AssistantMarkdown content="关键在**节奏" streaming />);
  assert.match(html, /<strong>节奏<span[^>]*sf-stream-caret/);
  assert.doesNotMatch(html, /\*\*/);
  // 结算后照原文渲染，不替模型补标记。
  const settled = renderToStaticMarkup(<AssistantMarkdown content="关键在**节奏" />);
  assert.match(settled, /\*\*节奏/);
});
