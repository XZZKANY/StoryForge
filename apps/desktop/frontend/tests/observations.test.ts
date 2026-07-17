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

const STRUCTURED_PAYLOAD = {
  ...PAYLOAD,
  version: 2,
  entities: [
    {
      id: 'item_lamp',
      canonical_name: '铜灯',
      kind: 'item',
      aliases: ['提灯'],
      appearance: { missing: false, total_count: 6, first_chapter: 1, last_chapter: 3 },
      holdings: [{ item: '铜灯', from_chapter: 1, to_chapter: null }],
      lifespan: null,
      provenance: [{ path: '正文/第03章.md', chapter: 3, first_line: 7, count: 2 }],
      provenance_truncated: false,
      related_observation_ids: ['canon_abc123'],
    },
    { canonical_name: '缺 id 应被跳过' },
  ],
  promises: {
    current_chapter: 3,
    ledger: [
      {
        id: 'p1',
        title: '第七封来信',
        status: 'planted',
        kind: 'foreshadow',
        planted_chapter: 1,
        due_chapter: 2,
        resolved_chapter: null,
        last_touch_chapter: 1,
        issues: [
          { id: 'promise_x', category: 'overdue', severity: 'medium', message: '已超截止窗口' },
        ],
      },
      { title: '缺 id 应被跳过' },
    ],
  },
  proposals: {
    available: true,
    new_entities: [{ id: 'ent_ab12cd34', canonical_name: '旧电台', aliases: ['电台'] }],
    new_invariants: { lifespan: [{ entity: 'char_b', exits_after_chapter: 9 }] },
    pending_count: 2,
  },
};

test('mapObservatoryPayload 映射 v2 结构化台账（实体 / 伏笔 / 提案）', () => {
  const data = mapObservatoryPayload(STRUCTURED_PAYLOAD, new Set());

  assert.equal(data.entities.length, 1);
  const entity = data.entities[0];
  assert.equal(entity.id, 'item_lamp');
  assert.equal(entity.canonicalName, '铜灯');
  assert.equal(entity.appearanceMissing, false);
  assert.equal(entity.totalCount, 6);
  assert.deepEqual(entity.holdings, [{ item: '铜灯', fromChapter: 1, toChapter: null }]);
  assert.deepEqual(entity.provenance, [
    { path: '正文/第03章.md', chapter: 3, firstLine: 7, count: 2 },
  ]);
  assert.deepEqual(entity.relatedObservationIds, ['canon_abc123']);

  assert.equal(data.promises.currentChapter, 3);
  assert.equal(data.promises.ledger.length, 1);
  const promise = data.promises.ledger[0];
  assert.equal(promise.title, '第七封来信');
  assert.equal(promise.status, 'planted');
  assert.equal(promise.dueChapter, 2);
  assert.deepEqual(promise.issues, [
    { id: 'promise_x', category: 'overdue', severity: 'medium', message: '已超截止窗口' },
  ]);

  assert.equal(data.proposals.available, true);
  assert.equal(data.proposals.pendingCount, 2);
  assert.deepEqual(data.proposals.newEntities, [
    { id: 'ent_ab12cd34', canonicalName: '旧电台', aliases: ['电台'] },
  ]);
  assert.deepEqual(data.proposals.newClaims, [
    { invariant: 'lifespan', entry: { entity: 'char_b', exits_after_chapter: 9 } },
  ]);
});

test('mapObservatoryPayload 对 v1 payload（无结构化段）落诚实空台账', () => {
  const data = mapObservatoryPayload(PAYLOAD, new Set());

  assert.deepEqual(data.entities, []);
  assert.deepEqual(data.promises, { currentChapter: null, ledger: [] });
  assert.deepEqual(data.proposals, {
    available: false,
    newEntities: [],
    newClaims: [],
    pendingCount: 0,
  });
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
