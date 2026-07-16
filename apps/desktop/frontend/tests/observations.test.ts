import assert from 'node:assert/strict';
import { test } from 'vitest';

import { mapObservatoryPayload, resolveAnchorLine } from '../src/lib/observations';

const PAYLOAD = {
  version: 1,
  generated_at: '2026-07-17T00:00:00+00:00',
  observations: [
    {
      id: 'canon_abc123',
      severity: 'error',
      title: '「铜灯」唯一持有冲突',
      detail: '唯一持有冲突：交叠章节窗口内同时被两人持有。',
      source: 'canon·single_holder',
      location: { path: '.storyforge/canon/canon.json' },
    },
    {
      id: 'prose_def456',
      severity: 'warning',
      title: '「不禁、五味杂陈」',
      detail: '出现高频陈词套话',
      source: 'prose·套话',
      location: { path: '正文/第02章.md', snippet: '不禁、五味杂陈' },
    },
    {
      id: 'canon_line789',
      severity: 'warning',
      title: '月儿 声明退场后仍出场',
      source: 'canon·lifespan',
      location: { path: '正文/第03章.md', line: 5 },
    },
    { severity: 'error', title: '缺 id 应被跳过' },
    { id: 'bad_sev', severity: 'blocking', title: '未归一化 severity 应被跳过' },
  ],
  checkers: [
    { key: 'canon', tool: 'project.canon', status: 'ran', conflict_count: 1 },
    { key: 'deep_consistency', tool: 'project.deep_consistency', status: 'on_demand', reason: 'LLM 按需' },
    { tool: 'project.x', status: 'ran' },
  ],
};

test('mapObservatoryPayload 映射合法观测并跳过缺 id / 未归一化 severity 的条目', () => {
  const data = mapObservatoryPayload(PAYLOAD, new Set());

  assert.equal(data.observations.length, 3);
  assert.equal(data.generatedAt, '2026-07-17T00:00:00+00:00');

  const canon = data.observations[0];
  assert.equal(canon.id, 'canon_abc123');
  assert.equal(canon.severity, 'error');
  assert.equal(canon.location, '.storyforge/canon/canon.json');
  assert.deepEqual(canon.anchor, { path: '.storyforge/canon/canon.json' });
  assert.equal(canon.resolved, false);

  const prose = data.observations[1];
  assert.deepEqual(prose.anchor, { path: '正文/第02章.md', snippet: '不禁、五味杂陈' });
  assert.equal(prose.location, '正文/第02章.md');

  const lifespan = data.observations[2];
  assert.deepEqual(lifespan.anchor, { path: '正文/第03章.md', line: 5 });
  assert.equal(lifespan.location, '正文/第03章.md:5');
});

test('mapObservatoryPayload 按 resolvedIds 保留已处理态（重扫不丢勾选）', () => {
  const data = mapObservatoryPayload(PAYLOAD, new Set(['prose_def456']));

  assert.equal(data.observations.find((o) => o.id === 'prose_def456')?.resolved, true);
  assert.equal(data.observations.find((o) => o.id === 'canon_abc123')?.resolved, false);
});

test('mapObservatoryPayload 过滤缺字段的 checker 并容忍非法输入', () => {
  const data = mapObservatoryPayload(PAYLOAD, new Set());
  assert.deepEqual(
    data.checkers.map((checker) => checker.key),
    ['canon', 'deep_consistency'],
  );

  assert.deepEqual(mapObservatoryPayload(null, new Set()).observations, []);
  assert.deepEqual(mapObservatoryPayload('garbage', new Set()).observations, []);
  assert.deepEqual(mapObservatoryPayload({ observations: 'nope' }, new Set()).observations, []);
});

const CONTENT = ['# 第02章', '', '夜雪压在檐角。', '他不禁停下脚步，心中五味杂陈。', '完。'].join(
  '\n',
);

test('resolveAnchorLine 行号在界内直接使用', () => {
  assert.equal(resolveAnchorLine(CONTENT, { line: 3 }), 3);
});

test('resolveAnchorLine 行号越界时降级 snippet 匹配', () => {
  assert.equal(resolveAnchorLine(CONTENT, { line: 99, snippet: '夜雪压在檐角' }), 3);
});

test('resolveAnchorLine 套话类拼接 snippet 按分隔符拆词降级', () => {
  // 「不禁、五味杂陈」不是原文子串（原文中间隔着其他字），整串匹配失败后按「、」拆词。
  assert.equal(resolveAnchorLine(CONTENT, { snippet: '不禁、五味杂陈' }), 4);
});

test('resolveAnchorLine 原文已改动时返回 null（调用方给失效提示）', () => {
  assert.equal(resolveAnchorLine(CONTENT, { snippet: '早已删除的句子' }), null);
  assert.equal(resolveAnchorLine(CONTENT, {}), null);
});
