import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';
import { RunActionBar } from '../src/components/chat-window/panels';
import { runLivePhaseText } from '../src/components/chat-window/display-utils';
import type { AgentRun, AgentRunControlHandlers } from '../src/components/chat-window/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('external waiting has no legacy approval controls or misleading legacy phase', async () => {
  const run: AgentRun & { executionProtocol: 'external_writeback_v1' } = {
    id: 'original-run',
    sessionId: 'original-session',
    goal: 'revise',
    status: 'waiting',
    steps: [],
    executionProtocol: 'external_writeback_v1',
  };
  const controls: AgentRunControlHandlers = {
    onApprovePermission: vi.fn(),
    onDenyPermission: vi.fn(),
    onPauseRun: vi.fn(),
    onResumeRun: vi.fn(),
    onStopRun: vi.fn(),
    onAcceptPatch: vi.fn(),
    onRejectPatch: vi.fn(),
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<RunActionBar run={run} controls={controls} />);
    });
    assert.equal(container.querySelector('[data-testid="run-action-bar"]'), null);
    assert.match(runLivePhaseText(run), /独立写回面板/);
    assert.equal(vi.mocked(controls.onAcceptPatch!).mock.calls.length, 0);
    await act(async () => {
      root.render(
        <RunActionBar run={{ ...run, executionProtocol: undefined }} controls={controls} />,
      );
    });
    assert.ok(container.querySelector('[data-testid="run-action-bar"]'));
    assert.match(container.textContent ?? '', /接受/);
    assert.match(runLivePhaseText({ ...run, executionProtocol: undefined }), /确认接受或拒绝/);
  } finally {
    await act(async () => root.unmount());
  }
});
