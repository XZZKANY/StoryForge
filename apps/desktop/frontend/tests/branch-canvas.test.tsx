import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { BranchCanvas } from '../src/components/BranchCanvas';
import type { BranchGraph, GraphNode } from '../src/lib/branches';
import type { VersionState } from '../src/lib/versions';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function node(id: number, branchId = 'main', summary = '版本快照'): GraphNode {
  return {
    id,
    version: {
      path: `snap/${id}.md`,
      contentRef: { kind: 'legacy-file', path: `snap/${id}.md` },
      timestamp: id,
    },
    parentId: null,
    branchId,
    lane: 0,
    timestamp: id,
    summary,
  };
}

function graphWithParent(): BranchGraph {
  const first = node(1000);
  const second = { ...node(2000, 'main', '最新版本'), parentId: first.id };
  return {
    nodes: [first, second],
    branches: [
      { id: 'main', label: '主线', color: '#3E6FA3', baseNodeId: null, headNodeId: second.id },
    ],
    laneOf: { main: 0 },
  };
}

function renderGraph(
  graph: BranchGraph,
  readNodeState: (item: GraphNode) => Promise<VersionState>,
) {
  act(() => {
    root.render(
      <BranchCanvas
        graph={graph}
        activeBranchId="main"
        selectedNodeId={2000}
        onSelectNode={() => undefined}
        onSelectBranch={() => undefined}
        onCheckout={() => undefined}
        onBranchFrom={() => undefined}
        readNodeState={readNodeState}
      />,
    );
  });
}

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('empty graph is exposed as a readable status', () => {
  renderGraph({ nodes: [], branches: [], laneOf: {} }, async () => ({
    exists: false,
    content: '',
  }));
  const empty = byTestId('branch-canvas-empty');
  assert.equal(empty?.getAttribute('role'), 'status');
  assert.equal(empty?.getAttribute('aria-live'), 'polite');
});

test('branch and node selection expose pressed state and long labels remain truncatable', () => {
  const longLabel = '这是一个非常非常长的分支名称，用来验证窄屏下不会撑开布局';
  const graph = graphWithParent();
  graph.branches[0] = { ...graph.branches[0], label: longLabel };
  renderGraph(graph, async () => ({ exists: true, content: '' }));

  assert.equal(byTestId('branch-legend-item')?.getAttribute('aria-pressed'), 'true');
  const selected = byTestId('branch-node')?.querySelector('button');
  assert.equal(selected?.getAttribute('aria-pressed'), 'true');
  assert.match(selected?.getAttribute('aria-label') ?? '', new RegExp(longLabel));
  assert.ok(container.querySelector('.truncate'));
});

test('selected version exposes its action region as an expanded relationship', () => {
  renderGraph(graphWithParent(), async () => ({ exists: true, content: '' }));

  const selected = byTestId('branch-node')?.querySelector<HTMLButtonElement>('button');
  assert.ok(selected);
  assert.equal(selected.getAttribute('aria-expanded'), 'true');
  const actionsId = selected.getAttribute('aria-controls');
  assert.ok(actionsId);
  const actions = container.querySelector<HTMLElement>(`#${CSS.escape(actionsId)}`);
  assert.ok(actions);
  assert.equal(actions.getAttribute('role'), 'region');
  assert.match(actions.getAttribute('aria-label') ?? '', /主线/);
});

test('compare disables duplicate requests and exposes retry after failure', async () => {
  let calls = 0;
  const rejectReads: Array<(reason?: unknown) => void> = [];
  const readNodeState = () => {
    calls += 1;
    return new Promise<VersionState>((_, reject) => {
      rejectReads.push(reject);
    });
  };
  renderGraph(graphWithParent(), readNodeState);

  const compare = byTestId('branch-node-compare');
  assert.ok(compare);
  act(() => {
    compare?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    compare?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  assert.equal(calls, 2);
  assert.equal(compare?.getAttribute('disabled'), '');
  assert.match(container.textContent ?? '', /对比中/);

  await act(async () => {
    rejectReads.forEach((reject) => reject(new Error('read failed')));
  });
  assert.equal(compare?.getAttribute('disabled'), null);
  assert.match(container.textContent ?? '', /对比失败，请重试/);
  assert.equal(compare?.textContent, '重试对比');
});
