/** API HTTP + real Native child process + mounted original guarded executor. Not GUI. */
import { readFileSync } from 'node:fs';
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { expect, it, vi } from 'vitest';
import { ExternalWritebackCoordinator } from '../src/lib/external-writeback/coordinator';
import { ExternalWritebackProvider, useExternalWaits } from '../src/components/app/ExternalWritebackProvider';
import { ExternalWritebackPanel } from '../src/components/app/ExternalWritebackPanel';
import { useSuggestionWriteback } from '../src/components/editor/useSuggestionWriteback';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';
import { sendAgentUserMessage } from '../src/lib/api/agent-socket';
import { getApiConfig } from '../src/lib/api/config';
import { getExternalWriteback } from '../src/lib/api/external-writeback';
import { createWritebackQueue } from '../src/lib/writeback';
import { resolveProjectRelativePath } from '../src/lib/project-context';
import { writeAgentPermissionProfile } from '../src/lib/agent-permission';
import { recordRevisionLoop } from '../src/lib/author-loop';
import {
  emptyManifest,
  getActiveBranch,
  saveBranchManifest,
  setBranchHead,
  loadBranchManifest,
} from '../src/lib/branches';
import { listVersions, readVersionState } from '../src/lib/versions';
import type { AgentSocketMessage } from '../src/lib/api/types';
import { nativeFixtureInvoker, type CombinedFixture } from './support/external-native-bridge';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke, isTauri: () => true }));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
const manifestPath = process.env.STORYFORGE_EXTERNAL_COMBINED_FIXTURE;
const normalize = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const noop = () => {};

it.skipIf(!manifestPath)(
  'runs one write proposal through actual API/Native/version/audit and resumes the same run',
  async () => {
    const fixture: CombinedFixture = JSON.parse(readFileSync(manifestPath!, 'utf8'));
    (window as Window & { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(
      'http://localhost:3007',
    );
    expect(window.location.origin).toBe('http://localhost:3007');
    const native = nativeFixtureInvoker(manifestPath!, fixture);
    ipc.invoke.mockImplementation(native.invoke);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    writeAgentPermissionProfile(fixture.project, fixture.profile);
    const file = resolveProjectRelativePath(fixture.project, 'chapter.md')!;
    const coordinator = new ExternalWritebackCoordinator();
    function PendingPanel() {
      const waits = useExternalWaits(coordinator);
      return <ExternalWritebackPanel coordinator={coordinator} project={fixture.project}
        assistantSessionId={waits[0]?.frame.assistant_session_id ?? null} />;
    }
    native.onClosing(() => coordinator.beginClose());
    let models!: EditorModelCache;
    let legacy: ReturnType<typeof useSuggestionWriteback>;
    const branchWrites = vi.fn();
    function Editor() {
      const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
      const originalContentRef = useRef(fixture.before);
      const cleanVersionIdRef = useRef<number | null>(null);
      const filePathRef = useRef<string | null>(file);
      const projectPathRef = useRef<string | null>(fixture.project);
      const cache = useRef<EditorModelCache>(new Map());
      const queue = useRef(createWritebackQueue());
      const manifest = useRef(emptyManifest());
      useLayoutEffect(() => {
        models = cache.current;
        cache.current.set(file, {
          model: monaco.editor.createModel(fixture.before),
          originalContent: fixture.before,
          diskBaseline: { kind: 'content', content: fixture.before },
          viewState: null,
        });
        editorRef.current = monaco.editor.create(document.createElement('div'));
        editorRef.current.setModel(cache.current.get(file)!.model);
        return () => {
          editorRef.current?.dispose();
          cache.current.get(file)?.model.dispose();
        };
      }, []);
      legacy = useSuggestionWriteback({
        enqueueWriteback: queue.current,
        editorRef,
        originalContentRef,
        cleanVersionIdRef,
        filePathRef,
        projectPathRef,
        modelCacheRef: cache,
        setLoadedContentPreview: noop,
        setIsDirty: noop,
        normalizeEol: normalize,
        getActiveBranchSnapshot: () => getActiveBranch(manifest.current),
        advanceBranchHead: async (timestamp, target) => {
          expect(target).toMatchObject({
            projectPath: fixture.project,
            filePath: file,
            branchId: 'main',
          });
          branchWrites(timestamp);
          if (fixture.scenario === 'branch_unavailable')
            throw new Error('fixture branch persistence unavailable before mutation');
          manifest.current = setBranchHead(manifest.current, target!.branchId, timestamp);
          await saveBranchManifest(target!.projectPath, target!.filePath, manifest.current);
        },
        recordRevisionLoop,
        emitAuthorLoopResult: noop,
      });
      return <output>{legacy.pendingSuggestion?.id ?? 'legacy-empty'}</output>;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const delivered = vi.fn<(message: AgentSocketMessage) => void>();
    try {
      await act(async () =>
        root.render(
          <ExternalWritebackProvider project={fixture.project} coordinator={coordinator}>
            <Editor />
            <PendingPanel />
          </ExternalWritebackProvider>,
        ),
      );
      expect(await coordinator.negotiate()).toBe(true);
      const waiting = await sendAgentUserMessage({
        sessionId: 'live-session',
        runId: 'live-run',
        userMessage: 'Revise and read again',
        intent: 'chat.explain',
        permissionProfile: fixture.profile,
        executionProtocol: 'external_writeback_v1',
        args: { project_path: fixture.project, file_path: 'chapter.md' },
        timeoutMs: 15_000,
      });
      expect(waiting.type).toBe('agent_run_waiting');
      if (waiting.type !== 'agent_run_waiting')
        throw new Error('expected independent waiting frame');
      expect(waiting.execution_epoch).toBeTruthy();
      expect(readFileSync(file, 'utf8')).toBe(fixture.before);
      await act(async () => coordinator.track(waiting, fixture.project, delivered));
      const key = coordinator.getSnapshot()[0]!.key;
      if (fixture.scenario === 'buffer_changed')
        models.get(file)!.model.setValue(`${fixture.before}作者新输入\n`);
      if (fixture.profile === 'ask') {
        expect(native.counts.get('write_file_with_receipt') ?? 0).toBe(0);
        const approve = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) =>
            button.textContent?.includes(
              fixture.scenario === 'reject' ? '拒绝修订并继续' : '接受整版并继续',
            ),
        );
        expect(approve).toBeDefined();
        expect(coordinator.getSnapshot()[0]!.live).toBe(true);
        expect(coordinator.getSnapshot()[0]!.wait!.continuation_available).toBe(true);
        expect(approve!.disabled).toBe(false);
        const decide = vi.spyOn(coordinator, 'decide');
        await act(async () => approve!.click());
        expect(decide).toHaveBeenCalledTimes(1);
        await act(async () => decide.mock.results[0]!.value);
        decide.mockRestore();
      }
      if (
        [
          'buffer_changed',
          'disk_changed_before_native',
          'snapshot_unavailable',
          'branch_unavailable',
        ].includes(fixture.scenario)
      ) {
        const blocked = coordinator.getSnapshot()[0]!;
        expect(blocked.phase).toBe('blocked');
        expect(blocked.error).toBeTruthy();
        expect(blocked.wait!.historical_applied).toBe(false);
        expect(blocked.wait!.feedback_consumed).toBe(false);
        expect(blocked.wait!.delivery_complete).toBe(false);
        expect(delivered).not.toHaveBeenCalled();
        expect(legacy!.pendingSuggestion).toBeNull();
        const diskChanged = fixture.scenario === 'disk_changed_before_native';
        const snapshotted = diskChanged || fixture.scenario === 'branch_unavailable';
        expect(readFileSync(file, 'utf8')).toBe(
          diskChanged ? `${fixture.before}外部改动\n` : fixture.before,
        );
        expect(models.get(file)!.model.getValue()).toBe(
          fixture.scenario === 'buffer_changed' ? `${fixture.before}作者新输入\n` : fixture.before,
        );
        expect(native.counts.get('write_file_with_receipt') ?? 0).toBe(diskChanged ? 1 : 0);
        expect(native.counts.get('create_shadow_snapshot') ?? 0).toBe(
          fixture.scenario === 'buffer_changed' ? 0 : 1,
        );
        expect(native.counts.get('retain_shadow_snapshot') ?? 0).toBe(snapshotted ? 1 : 0);
        expect(native.counts.get('create_writeback_audit') ?? 0).toBe(0);
        expect(branchWrites).toHaveBeenCalledTimes(snapshotted ? 1 : 0);
        const versions = await listVersions(fixture.project, file);
        expect(versions).toHaveLength(snapshotted ? 1 : 0);
        if (snapshotted) {
          expect(await readVersionState(fixture.project, versions[0]!)).toEqual({
            exists: true,
            content: fixture.before,
          });
          expect((await loadBranchManifest(fixture.project, file)).branches[0]!.headNodeId).toBe(
            diskChanged ? versions[0]!.timestamp : null,
          );
        }
        // A failed snapshot/branch is not a not_written Native receipt. Observe cannot fabricate one.
        await act(async () => coordinator.observe(key));
        expect(coordinator.getSnapshot()[0]!.wait!.feedback_consumed).toBe(false);
        if (fixture.scenario !== 'buffer_changed')
          expect(coordinator.getSnapshot()[0]!.wait!.observation?.state).toBe('missing');
        await act(async () =>
          coordinator.decide(key, coordinator.getSnapshot()[0]!.wait!.revision, 'approve'),
        );
        expect(native.counts.get('write_file_with_receipt') ?? 0).toBe(diskChanged ? 1 : 0);
        expect(native.counts.get('create_shadow_snapshot') ?? 0).toBe(
          fixture.scenario === 'buffer_changed' ? 0 : 1,
        );
        return;
      }
      if (fixture.scenario === 'reject') {
        for (
          let attempt = 0;
          attempt < 50 && coordinator.getSnapshot()[0]!.phase !== 'finished';
          attempt++
        ) {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            await coordinator.refresh(key);
          });
        }
        const rejected = coordinator.getSnapshot()[0]!;
        expect(rejected.phase).toBe('finished');
        expect(rejected.error).toBeNull();
        expect(rejected.wait!.decision).toBe('reject');
        expect(rejected.wait!.historical_applied).toBe(false);
        expect(rejected.wait!.feedback_consumed).toBe(true);
        expect(delivered).toHaveBeenCalledTimes(1);
        expect(readFileSync(file, 'utf8')).toBe(fixture.before);
        expect(models.get(file)!.model.getValue()).toBe(fixture.before);
        for (const command of [
          'describe_writeback_operation',
          'create_shadow_snapshot',
          'retain_shadow_snapshot',
          'write_file_with_receipt',
          'create_writeback_audit',
        ])
          expect(native.counts.get(command) ?? 0).toBe(0);
        expect(branchWrites).not.toHaveBeenCalled();
        expect(await listVersions(fixture.project, file)).toHaveLength(0);
        expect(legacy!.pendingSuggestion).toBeNull();
        return;
      }
      if (['outcome_missing_after_write', 'disk_changed_after_write'].includes(fixture.scenario)) {
        const uncertain = coordinator.getSnapshot()[0]!;
        expect(uncertain.phase).toBe('blocked');
        expect(uncertain.error).toContain('回执尚未独立核验');
        expect(uncertain.wait!.stage).toBe('reconciliation');
        expect(uncertain.wait!.feedback_consumed).toBe(false);
        expect(uncertain.wait!.delivery_complete).toBe(false);
        const missingOutcome = fixture.scenario === 'outcome_missing_after_write';
        expect(uncertain.wait!.historical_applied).toBe(!missingOutcome);
        expect(uncertain.wait!.observation?.state).toBe(
          missingOutcome ? 'outcome_unknown' : 'applied',
        );
        expect(uncertain.wait!.observation?.current).toBe(missingOutcome ? 'after' : 'diverged');
        expect(readFileSync(file, 'utf8')).toBe(
          missingOutcome ? fixture.after : `${fixture.after}外部改动\n`,
        );
        expect(delivered).not.toHaveBeenCalled();
        expect(legacy!.pendingSuggestion).toBeNull();
        const versions = await listVersions(fixture.project, file);
        expect(versions).toHaveLength(1);
        expect(await readVersionState(fixture.project, versions[0]!)).toEqual({
          exists: true,
          content: fixture.before,
        });
        await act(async () => {
          await coordinator.observe(key);
          await coordinator.decide(key, coordinator.getSnapshot()[0]!.wait!.revision, 'approve');
        });
        for (const command of [
          'create_shadow_snapshot',
          'retain_shadow_snapshot',
          'write_file_with_receipt',
          'create_writeback_audit',
        ])
          expect(native.counts.get(command)).toBe(1);
        expect(branchWrites).toHaveBeenCalledTimes(1);
        return;
      }
      if (fixture.scenario === 'close_during_audit') {
        const settled = await native.invoke('fixture_close_status', { apiSettled: true });
        expect(settled).toMatchObject({ reason: 'close_confirmed', deliveryTickets: 0, activeCommands: 0, rendererFenced: true });
        await expect(native.invoke('begin_writeback_delivery', { projectRoot: fixture.project })).rejects.toThrow('managed_host_closing');
        const view = coordinator.getSnapshot()[0]!;
        expect(view.live).toBe(false); expect(view.wait!.historical_applied).toBe(true);
        expect(view.wait!.delivery_complete).toBe(false); expect(delivered).not.toHaveBeenCalled();
        expect(native.counts.get('write_file_with_receipt')).toBe(1);
        expect(native.counts.get('create_shadow_snapshot')).toBe(1); expect(native.counts.get('create_writeback_audit')).toBe(1);
        expect(readFileSync(file, 'utf8')).toBe(fixture.after);
        return;
      }
      if (['manual_remount', 'cold_audit_repair'].includes(fixture.scenario)) {
        coordinator.setProject(null);
        const cold = new ExternalWritebackCoordinator(); cold.setProject(fixture.project);
        await cold.discover(fixture.project);
        const coldView = cold.getSnapshot()[0]!;
        expect(coldView.live).toBe(false); expect(coldView.wait!.historical_applied).toBe(true);
        await cold.track({ ...waiting, execution_epoch: null }, fixture.project, delivered);
        await cold.recover(coldView.key);
        if (fixture.scenario === 'cold_audit_repair') {
          expect(cold.getSnapshot()[0]!.live).toBe(false);
          expect(cold.getSnapshot()[0]!.canRepairAudit).toBe(true);
          await cold.repairAudit(coldView.key);
          expect(cold.getSnapshot()[0]!.live).toBe(false); expect(delivered).not.toHaveBeenCalled();
          await cold.recover(coldView.key);
        }
        expect(cold.getSnapshot()[0]!.live).toBe(true);
        expect(native.counts.get('write_file_with_receipt')).toBe(1); expect(delivered).not.toHaveBeenCalled();
        await cold.continueVerified(coldView.key, cold.getSnapshot()[0]!.wait!.revision);
        for (let attempt = 0; attempt < 50 && cold.getSnapshot()[0]!.phase !== 'finished'; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50)); await cold.refresh(coldView.key);
        }
        expect(cold.getSnapshot()[0]!.phase).toBe('finished'); expect(delivered).toHaveBeenCalledTimes(1);
        expect(native.counts.get('write_file_with_receipt')).toBe(1); expect(native.counts.get('create_shadow_snapshot')).toBe(1);
        expect(native.counts.get('create_writeback_audit')).toBe(fixture.scenario === 'cold_audit_repair' ? 2 : 1);
        return;
      }
      if (fixture.scenario === 'audit_unavailable') {
        expect(coordinator.getSnapshot()[0]!.error).toContain('闭环记录未完成');
        expect(coordinator.getSnapshot()[0]!.wait!.historical_applied).toBe(true);
        expect(coordinator.getSnapshot()[0]!.wait!.delivery_complete).toBe(false);
        expect(coordinator.getSnapshot()[0]!.canRepairAudit).toBe(true);
        expect(readFileSync(file, 'utf8')).toBe(fixture.after);
        await act(async () => coordinator.repairAudit(key));
      } else if (['pause_after_native', 'stop_after_native'].includes(fixture.scenario)) {
        const interrupted = coordinator.getSnapshot()[0]!;
        expect(interrupted.error).toContain('执行资格已失效');
        expect(interrupted.live).toBe(false);
        expect(interrupted.wait!.historical_applied).toBe(true);
        expect(interrupted.wait!.feedback_consumed).toBe(true);
        expect(interrupted.wait!.delivery_complete).toBe(false);
        expect(delivered).not.toHaveBeenCalled();
        expect(readFileSync(file, 'utf8')).toBe(fixture.after);
        const restored = new ExternalWritebackCoordinator();
        restored.setProject(fixture.project);
        await restored.track({ ...waiting, execution_epoch: null }, fixture.project);
        const restoredView = restored.getSnapshot()[0]!;
        expect(restoredView.live).toBe(false);
        expect(restoredView.wait!.historical_applied).toBe(true);
        await restored.decide(restoredView.key, restoredView.wait!.revision, 'approve');
        expect(native.counts.get('write_file_with_receipt')).toBe(1);
        expect(native.counts.get('create_shadow_snapshot')).toBe(1);
        expect(native.counts.get('create_writeback_audit')).toBe(1);
        expect(branchWrites).toHaveBeenCalledTimes(1);
        const versions = await listVersions(fixture.project, file);
        expect(versions).toHaveLength(1);
        expect(await readVersionState(fixture.project, versions[0]!)).toEqual({
          exists: true,
          content: fixture.before,
        });
        return;
      } else expect(coordinator.getSnapshot()[0]!.error).toBeNull();
      for (
        let attempt = 0;
        attempt < 50 && coordinator.getSnapshot()[0]!.phase !== 'finished';
        attempt++
      ) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          await coordinator.refresh(key);
        });
      }
      const view = coordinator.getSnapshot()[0]!;
      expect(native.counts.get('write_file_with_receipt')).toBe(1);
      expect(view.error).toBeNull();
      expect(view.phase).toBe('finished');
      expect(view.wait!.historical_applied).toBe(true);
      expect(view.result).toMatchObject({
        type: 'agent_result',
        run_id: 'live-run',
        session_id: 'live-session',
      });
      expect(delivered).toHaveBeenCalledTimes(1);
      expect(legacy!.pendingSuggestion).toBeNull();
      expect(models.get(file)!.model.getValue()).toBe(fixture.after);
      expect(readFileSync(file, 'utf8')).toBe(fixture.after);
      expect(native.counts.get('write_file_with_receipt')).toBe(1);
      expect(native.counts.get('create_shadow_snapshot')).toBe(1);
      expect(native.counts.get('retain_shadow_snapshot')).toBe(1);
      expect(branchWrites).toHaveBeenCalledTimes(1);
      expect(native.counts.get('create_writeback_audit')).toBe(
        fixture.scenario === 'audit_unavailable' ? 2 : 1,
      );
      const versions = await listVersions(fixture.project, file);
      expect(versions).toHaveLength(1);
      expect(versions[0]!.unavailableReason).toBeUndefined();
      expect(await readVersionState(fixture.project, versions[0]!)).toEqual({
        exists: true,
        content: fixture.before,
      });
      expect((await loadBranchManifest(fixture.project, file)).branches[0]!.headNodeId).toBe(
        versions[0]!.timestamp,
      );
      const after = await getExternalWriteback(await getApiConfig(), 'live-run', 'live-session');
      expect(after.run_status).toBe('completed');
      expect(after.delivery_complete).toBe(true);
      await act(async () => {
        await coordinator.decide(key, after.revision, 'approve');
        await coordinator.refresh(key);
      });
      expect(native.counts.get('write_file_with_receipt')).toBe(1);
      expect(delivered).toHaveBeenCalledTimes(1);
    } finally {
      await native.dispose();
      await act(async () => root.unmount());
      container.remove();
      ipc.invoke.mockReset();
      localStorage.clear();
    }
  },
  90_000,
);
