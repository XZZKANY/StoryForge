/**
 * 观测镜实体联动行为红线：光标行事件 → litEntityIds 匹配更新、切项目清空；
 * 实体卡紫描边让位于冲突红；对话头雷达小紫点只在 attention 时渲染。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { ConversationHeader } from '../src/components/chat-window/panels';
import { useObservatory } from '../src/components/app/useObservatory';
import { ObservatoryView } from '../src/components/shell/ObservatoryView';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { emitEditorCursorLine } from '../src/lib/assistant-events';
import {
  EMPTY_OBSERVATORY_PROMISES,
  EMPTY_OBSERVATORY_PROPOSALS,
  type ObservatoryEntity,
} from '../src/lib/observations';

vi.mock('../src/lib/api/ide-commands', () => ({
  executeIdeCommand: vi.fn(),
}));

const mockedExecute = vi.mocked(executeIdeCommand);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTITY_PAYLOAD = {
  command_id: 'observatory.scan',
  status: 'accepted',
  payload: {
    observatory: {
      version: 2,
      generated_at: '2026-07-17T00:00:00+00:00',
      observations: [],
      checkers: [],
      entities: [
        {
          id: 'item_lamp',
          canonical_name: '铜灯',
          aliases: ['提灯'],
          appearance: { missing: false, total_count: 2, first_chapter: 1, last_chapter: 1 },
          holdings: [],
          lifespan: null,
          provenance: [],
          provenance_truncated: false,
          related_observation_ids: [],
        },
      ],
      promises: { current_chapter: 1, ledger: [] },
      proposals: { available: false, new_entities: [], new_invariants: {}, pending_count: 0 },
    },
  },
};

type ObservatoryApi = ReturnType<typeof useObservatory>;

let latest: ObservatoryApi | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ project }: { project: string | null }) {
  latest = useObservatory({ activeProject: project });
  return null;
}

async function render(node: React.ReactElement) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(node);
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockedExecute.mockResolvedValue(ENTITY_PAYLOAD as never);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  vi.clearAllMocks();
});

test('光标行提到实体表面形时 litEntityIds 亮起，换行熄灭', async () => {
  await render(<Harness project="D:\\书\\雪夜斩" />);
  assert.deepEqual(latest!.litEntityIds, []);

  await act(async () => {
    emitEditorCursorLine({ filePath: 'x.md', lineText: '林砚举起提灯照向巷口。' });
  });
  assert.deepEqual(latest!.litEntityIds, ['item_lamp']);

  await act(async () => {
    emitEditorCursorLine({ filePath: 'x.md', lineText: '与实体无关的一行。' });
  });
  assert.deepEqual(latest!.litEntityIds, []);
});

test('切项目清空 litEntityIds（联动不跨项目）', async () => {
  await render(<Harness project="D:\\书\\雪夜斩" />);
  await act(async () => {
    emitEditorCursorLine({ filePath: 'x.md', lineText: '铜灯在桌上。' });
  });
  assert.deepEqual(latest!.litEntityIds, ['item_lamp']);

  await render(<Harness project="D:\\书\\另一本" />);
  assert.deepEqual(latest!.litEntityIds, []);
});

const LIT_ENTITIES: ObservatoryEntity[] = [
  {
    id: 'item_lamp',
    canonicalName: '铜灯',
    kind: 'item',
    aliases: [],
    appearanceMissing: false,
    firstChapter: 1,
    lastChapter: 1,
    totalCount: 2,
    holdings: [],
    lifespan: null,
    provenance: [],
    provenanceTruncated: false,
    relatedObservationIds: ['canon_conflict'],
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

test('实体卡 lit 标记：紫描边让位于冲突红（data-conflict 优先于 data-lit 样式）', async () => {
  await render(
    <ObservatoryView
      availability="available"
      observations={[
        {
          id: 'canon_conflict',
          severity: 'error',
          title: '「铜灯」唯一持有冲突',
        },
      ]}
      checkers={[]}
      entities={LIT_ENTITIES}
      promises={EMPTY_OBSERVATORY_PROMISES}
      proposals={EMPTY_OBSERVATORY_PROPOSALS}
      generatedAt={null}
      litEntityIds={['item_lamp', 'char_a']}
      onRescan={() => undefined}
      onBackToChat={() => undefined}
    />,
  );

  const cards = container!.querySelectorAll('[data-testid="entity-card"]');
  assert.equal(cards[0]?.getAttribute('data-lit'), 'true');
  assert.equal(cards[0]?.getAttribute('data-conflict'), 'true');
  assert.match(cards[0]?.className ?? '', /border-error/);
  assert.equal(cards[1]?.getAttribute('data-lit'), 'true');
  assert.match(cards[1]?.className ?? '', /border-agent/);
});

test('对话头雷达小紫点只在 observatoryAttention 时渲染', async () => {
  await render(
    <ConversationHeader
      title="会话"
      onOpenObservatory={() => undefined}
      observatoryAttention={true}
    />,
  );
  assert.ok(container!.querySelector('[data-testid="observatory-attention-dot"]'));

  await render(
    <ConversationHeader
      title="会话"
      onOpenObservatory={() => undefined}
      observatoryAttention={false}
    />,
  );
  assert.equal(container!.querySelector('[data-testid="observatory-attention-dot"]'), null);
});
