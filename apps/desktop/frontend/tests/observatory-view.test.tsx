/**
 * ObservatoryView 行为红线：四分区渲染、实体卡冲突描边只随后端 blocking 观测、
 * provenance 行点击回锚点、提案区诚实空态、重扫按钮回调。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { test } from 'vitest';

import { ObservatoryView } from '../src/components/shell/ObservatoryView';
import type { Observation } from '../src/components/shell/ObsPanel';
import type {
  ObservationAnchor,
  ObservatoryChecker,
  ObservatoryEntity,
  ObservatoryPromises,
  ObservatoryProposals,
} from '../src/lib/observations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OBSERVATIONS: Observation[] = [
  {
    id: 'canon_abc123',
    severity: 'error',
    title: '「铜灯」唯一持有冲突',
    source: 'canon·single_holder',
    anchor: { path: '.storyforge/canon/canon.json' },
  },
];

const ENTITIES: ObservatoryEntity[] = [
  {
    id: 'item_lamp',
    canonicalName: '铜灯',
    kind: 'item',
    aliases: ['提灯'],
    appearanceMissing: false,
    firstChapter: 1,
    lastChapter: 3,
    totalCount: 6,
    holdings: [{ item: '铜灯', fromChapter: 1, toChapter: null }],
    lifespan: null,
    provenance: [{ path: '正文/第03章.md', chapter: 3, firstLine: 7, count: 2 }],
    provenanceTruncated: false,
    relatedObservationIds: ['canon_abc123'],
  },
  {
    id: 'char_a',
    canonicalName: '周眠',
    kind: 'character',
    aliases: [],
    appearanceMissing: true,
    firstChapter: null,
    lastChapter: null,
    totalCount: 0,
    holdings: [],
    lifespan: null,
    provenance: [],
    provenanceTruncated: false,
    relatedObservationIds: [],
  },
];

const PROMISES: ObservatoryPromises = {
  currentChapter: 3,
  ledger: [
    {
      id: 'p1',
      title: '第七封来信',
      status: 'planted',
      kind: 'foreshadow',
      plantedChapter: 1,
      dueChapter: 2,
      resolvedChapter: null,
      lastTouchChapter: 1,
      issues: [
        { id: 'promise_x', category: 'overdue', severity: 'medium', message: '已超截止窗口' },
      ],
    },
    {
      id: 'p2',
      title: '旧钟来历',
      status: 'resolved',
      kind: 'foreshadow',
      plantedChapter: 1,
      dueChapter: null,
      resolvedChapter: 2,
      lastTouchChapter: null,
      issues: [],
    },
  ],
};

const CHECKERS: ObservatoryChecker[] = [
  { key: 'canon', tool: 'project.canon', status: 'ran', conflict_count: 1, advisory_count: 0 },
  { key: 'promise', tool: 'project.promise_check', status: 'ran' },
  { key: 'prose', tool: 'project.prose_check', status: 'ran' },
  { key: 'consistency', tool: 'project.consistency', status: 'on_demand', reason: '按需' },
  { key: 'collapse', tool: 'project.collapse_check', status: 'on_demand', reason: '按需' },
  { key: 'entity_budget', tool: 'project.entity_budget_check', status: 'on_demand', reason: '按需' },
  { key: 'deep_consistency', tool: 'project.deep_consistency', status: 'on_demand', reason: 'LLM' },
];

const NO_PROPOSALS: ObservatoryProposals = {
  available: false,
  newEntities: [],
  newClaims: [],
  pendingCount: 0,
};

const PROPOSALS: ObservatoryProposals = {
  available: true,
  newEntities: [{ id: 'ent_ab12cd34', canonicalName: '旧电台', aliases: ['电台'] }],
  newClaims: [{ invariant: 'lifespan', entry: { entity: 'char_b', exits_after_chapter: 9 } }],
  pendingCount: 2,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactElement) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  return act(async () => {
    root!.render(node);
    await Promise.resolve();
  });
}

function cleanup() {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

function renderView(overrides: Partial<Parameters<typeof ObservatoryView>[0]> = {}) {
  return mount(
    <ObservatoryView
      availability="available"
      observations={OBSERVATIONS}
      checkers={CHECKERS}
      entities={ENTITIES}
      promises={PROMISES}
      proposals={NO_PROPOSALS}
      generatedAt="2026-07-17T12:00:00+00:00"
      onRescan={() => undefined}
      onBackToChat={() => undefined}
      {...overrides}
    />,
  );
}

test('四分区渲染：提案诚实空态、伏笔两卡、实体两卡、检查器七行', async () => {
  try {
    await renderView();
    assert.match(
      container!.querySelector('[data-testid="obs-section-proposals"]')!.textContent ?? '',
      /暂无提案草稿/,
    );
    assert.equal(container!.querySelectorAll('[data-testid="promise-card"]').length, 2);
    assert.equal(container!.querySelectorAll('[data-testid="entity-card"]').length, 2);
    assert.equal(container!.querySelectorAll('[data-testid="checker-row"]').length, 7);
  } finally {
    cleanup();
  }
});

test('实体卡冲突描边只随后端 blocking 观测：related 未处理 error 才亮红', async () => {
  try {
    await renderView();
    const cards = container!.querySelectorAll('[data-testid="entity-card"]');
    assert.equal(cards[0]?.getAttribute('data-conflict'), 'true');
    assert.equal(cards[1]?.getAttribute('data-conflict'), 'false');
  } finally {
    cleanup();
  }
});

test('冲突已勾选处理后描边熄灭（结论跟观测走，前端不自算）', async () => {
  try {
    await renderView({
      observations: [{ ...OBSERVATIONS[0], resolved: true }],
    });
    const cards = container!.querySelectorAll('[data-testid="entity-card"]');
    assert.equal(cards[0]?.getAttribute('data-conflict'), 'false');
  } finally {
    cleanup();
  }
});

test('伏笔卡三态：逾期卡带 overdue 标记，已回收卡不带', async () => {
  try {
    await renderView();
    const cards = container!.querySelectorAll('[data-testid="promise-card"]');
    assert.equal(cards[0]?.getAttribute('data-overdue'), 'true');
    assert.equal(cards[0]?.getAttribute('data-status'), 'planted');
    assert.equal(cards[1]?.getAttribute('data-overdue'), 'false');
    assert.equal(cards[1]?.getAttribute('data-status'), 'resolved');
  } finally {
    cleanup();
  }
});

test('provenance 展开后点行回锚点；related 观测点击回观测', async () => {
  const anchors: ObservationAnchor[] = [];
  const located: Observation[] = [];
  try {
    await renderView({
      onLocateAnchor: (anchor) => anchors.push(anchor),
      onLocateObservation: (observation) => located.push(observation),
    });

    await act(async () => {
      (
        container!.querySelector('[data-testid="entity-provenance-toggle"]') as HTMLElement
      ).click();
    });
    await act(async () => {
      (container!.querySelector('[data-testid="entity-provenance-row"]') as HTMLElement).click();
      (
        container!.querySelector('[data-testid="entity-related-observation"]') as HTMLElement
      ).click();
    });

    assert.deepEqual(anchors, [{ path: '正文/第03章.md', line: 7 }]);
    assert.equal(located[0]?.id, 'canon_abc123');
  } finally {
    cleanup();
  }
});

test('提案可用时渲染新实体与新声明卡；重扫按钮触发回调', async () => {
  let rescans = 0;
  try {
    await renderView({ proposals: PROPOSALS, onRescan: () => (rescans += 1) });
    const cards = container!.querySelectorAll('[data-testid="proposal-card"]');
    assert.equal(cards.length, 2);
    assert.match(cards[0]?.textContent ?? '', /旧电台/);
    assert.match(cards[1]?.textContent ?? '', /char_b/);

    await act(async () => {
      (container!.querySelector('[data-testid="observatory-rescan"]') as HTMLElement).click();
    });
    assert.equal(rescans, 1);
  } finally {
    cleanup();
  }
});

test('非 available 态诚实显示，不渲染任何台账分区', async () => {
  try {
    await renderView({ availability: 'error' });
    assert.match(
      container!.querySelector('[data-testid="observatory-view"]')!.textContent ?? '',
      /观测数据加载失败/,
    );
    assert.equal(container!.querySelectorAll('[data-testid="entity-card"]').length, 0);
  } finally {
    cleanup();
  }
});
