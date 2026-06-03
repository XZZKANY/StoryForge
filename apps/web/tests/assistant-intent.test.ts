import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAssistantIntent } from '../components/home/assistant-intent';

test('parseAssistantIntent 解析三章试读生成目标', () => {
  const intent = parseAssistantIntent('写一个玄幻三章试读，主角林岚，宗门覆灭后追查灵矿阴谋');

  assert.equal(intent.taskType, 'trial_generation');
  assert.equal(intent.targetChapterCount, 3);
  assert.equal(intent.premise, '写一个玄幻三章试读，主角林岚，宗门覆灭后追查灵矿阴谋');
  assert.equal(intent.tone, '玄幻');
  assert.deepEqual(intent.requestedArtifacts, ['blueprint', 'chapters', 'review', 'repair']);
});

test('parseAssistantIntent 解析明确章节数和目标字数', () => {
  const intent = parseAssistantIntent('写 10 章短篇，分 2 卷，目标 3-5 万字，先生成前三章');

  assert.equal(intent.taskType, 'trial_generation');
  assert.equal(intent.targetChapterCount, 10);
  assert.equal(intent.targetChapterOrdinal, undefined);
  assert.equal(intent.targetWordCount, 50000);
  assert.equal(intent.volumeCount, 2);
  assert.equal(intent.batchChapterCount, 3);
  assert.deepEqual(intent.requestedArtifacts, ['blueprint', 'chapters', 'review', 'repair']);
});

test('parseAssistantIntent 识别章节修订审阅任务', () => {
  const intent = parseAssistantIntent('审阅第二章，角色有点崩，给我修复建议');

  assert.equal(intent.taskType, 'chapter_review');
  assert.equal(intent.targetChapterCount, 1);
  assert.equal(intent.targetChapterOrdinal, 2);
  assert.deepEqual(intent.requestedArtifacts, ['review', 'repair']);
});

test('parseAssistantIntent 支持章节审阅的阿拉伯数字序号', () => {
  const intent = parseAssistantIntent('审阅第2章，节奏有问题');

  assert.equal(intent.taskType, 'chapter_review');
  assert.equal(intent.targetChapterOrdinal, 2);
});

test('parseAssistantIntent 支持章节审阅的省略第字序号', () => {
  const intent = parseAssistantIntent('审阅2章，给我修复建议');

  assert.equal(intent.taskType, 'chapter_review');
  assert.equal(intent.targetChapterOrdinal, 2);
});

test('parseAssistantIntent 识别导出审计报告任务', () => {
  const intent = parseAssistantIntent('导出这次 BookRun 的 Markdown、EPUB 和审计报告');

  assert.equal(intent.taskType, 'artifact_export');
  assert.equal(intent.targetChapterCount, 1);
  assert.deepEqual(intent.requestedArtifacts, ['markdown', 'epub', 'audit']);
});

test('parseAssistantIntent 识别试读 EPUB 与审计报告导出请求', () => {
  const intent = parseAssistantIntent('导出这次试读的 EPUB 和审计报告');

  assert.equal(intent.taskType, 'artifact_export');
  assert.deepEqual(intent.requestedArtifacts, ['markdown', 'epub', 'audit']);
});

test('parseAssistantIntent 对空输入抛出明确错误', () => {
  assert.throws(() => parseAssistantIntent('   '), /创作目标不能为空/);
});
