import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';

import { useObservatory } from '../src/components/app/useObservatory';
import { ObservatoryView } from '../src/components/shell/ObservatoryView';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { FS_MUTATION_EVENT } from '../src/lib/tauri-fs';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const planted = { id: 'p1', title: '归还旧钥匙', planted_chapter: 1, status: 'planted' };
const resolved = { ...planted, status: 'resolved', resolved_chapter: 3 };

for (const scenario of ['changed', 'trimmed', 'already-invalid', 'changed-after-scan']) {
  test(`观测镜实际并入入口拒绝同 ID 冲突：${scenario}`, async () => {
    const project = '/books/merge-conflict';
    const path = `${project}/.storyforge/canon/canon.json`;
    const existing = scenario === 'trimmed' ? { ...planted, id: ' p1 ' } : planted;
    const promises =
      scenario === 'already-invalid' ? [existing, { ...planted, status: 'advancing' }] : [existing];
    const text = JSON.stringify({ version: 1, invariants: { promises } }, null, 3) + '\r\n';
    let disk = scenario === 'changed-after-scan' ? '{"version":1,"invariants":{}}' : text;
    const proposalBytes = JSON.stringify({ invariants: { promises: [resolved] } }, null, 3);
    const files = new Map([[`${project}/.storyforge/canon/derived/proposals.json`, proposalBytes]]);
    const writes: unknown[] = [];
    const toasts: ToastDetail[] = [];
    let mutations = 0;
    const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
    const onMutation = () => {
      mutations += 1;
    };
    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(FS_MUTATION_EVENT, onMutation);
    window.__STORYFORGE_MOCK_FS__ = {
      readFile: (readPath) => {
        assert.equal(readPath, path);
        return disk;
      },
      writeFile: (writePath, content) => {
        writes.push({ writePath, content });
        disk = content;
      },
    };
    vi.mocked(executeIdeCommand).mockResolvedValue({
      command_id: 'observatory.scan',
      status: 'accepted',
      payload: {
        observatory: {
          proposals: {
            available: true,
            pending_count: 1,
            new_entities: [],
            new_invariants: { promises: [resolved] },
          },
        },
      },
    });
    let rescan: (() => Promise<void>) | undefined;
    function Harness() {
      const obs = useObservatory({ activeProject: project });
      rescan = obs.runScan;
      return (
        <ObservatoryView
          {...obs}
          onRescan={() => void obs.runScan()}
          onBackToChat={() => {}}
          onMergeProposal={(target) => void obs.mergeProposal(target)}
        />
      );
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => {
        root.render(<Harness />);
      });
      disk = text;
      const button = container.querySelector<HTMLButtonElement>('[data-testid="proposal-merge"]');
      assert.ok(button);
      await act(async () => {
        button.click();
      });
      assert.equal(writes.length, 0);
      assert.equal(disk, text);
      assert.equal(files.get(`${project}/.storyforge/canon/derived/proposals.json`), proposalBytes);
      assert.equal(mutations, 0);
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].tone, 'error');
      assert.match(toasts[0].message, /并入失败.*相同 ID.*canon.json.*重扫提案.*未写入/);
      assert.equal(button.disabled, false);
      await act(async () => {
        await rescan!();
      });
      assert.equal(container.querySelectorAll('[data-testid="proposal-card"]').length, 1);
      assert.equal(
        container.querySelector<HTMLButtonElement>('[data-testid="proposal-merge"]')?.disabled,
        false,
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete window.__STORYFORGE_MOCK_FS__;
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(FS_MUTATION_EVENT, onMutation);
      errorLog.mockRestore();
      vi.mocked(executeIdeCommand).mockReset();
    }
  });
}
