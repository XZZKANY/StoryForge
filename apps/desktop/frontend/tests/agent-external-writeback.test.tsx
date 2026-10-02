import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalWritebackCoordinator, type CoordinatorPorts } from '../src/lib/external-writeback/coordinator';
import { ExternalWritebackProvider } from '../src/components/app/ExternalWritebackProvider';
import { ExternalWritebackPanel } from '../src/components/app/ExternalWritebackPanel';
import { useSuggestionWriteback } from '../src/components/editor/useSuggestionWriteback';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';
import { createWritebackQueue } from '../src/lib/writeback';
import type { ExternalWriteback } from '../src/lib/api/managed-agent-host';
import type { AgentRunWaitingMessage, AgentSocketMessage } from '../src/lib/api/types';
import type { AgentPermissionProfile } from '../src/lib/agent-permission';
import type { DiskBaseline } from '../src/lib/tauri-fs';
import type { WritebackRequest } from '../src/lib/writeback-receipt-types';
import { inspectFixtureReceipt, writeFixtureReceipt } from '../src/lib/writeback-receipt-fixture';

const effects = vi.hoisted(() => ({
  disk: new Map<string, string>(), snapshot: vi.fn(), record: vi.fn(), advance: vi.fn(),
  write: vi.fn(), loseAck: false,
}));
const fs = {
  pathExists: (path: string) => effects.disk.has(path),
  readFile: (path: string) => { const text = effects.disk.get(path); if (text === undefined) throw new Error('missing'); return text; },
  writeFile: (path: string, content: string) => { effects.disk.set(path, content); },
};
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: effects.snapshot }));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
vi.mock('../src/lib/tauri-fs', () => ({ TauriFileSystem: {
  inspectWritebackReceipt: (project: string, request: WritebackRequest) => inspectFixtureReceipt(fs, project, request),
  async writeFileWithReceipt(project: string, request: WritebackRequest, expected: DiskBaseline, checkpoint: number | null) {
    const receipt = await writeFixtureReceipt(fs, project, request, expected, checkpoint, async () => {
      expect(expected).toEqual({ kind: 'content', content: BEFORE });
      if (effects.disk.get(FILE) !== BEFORE) throw new Error('磁盘漂移');
      effects.write(request); effects.disk.set(FILE, request.content);
    });
    if (effects.loseAck) throw new Error('ACK lost after Native commit');
    return receipt;
  },
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PROJECT = 'D:/fixture'; const FILE = `${PROJECT}/chapter.md`;
const BEFORE = '旧稿\r\n'; const AFTER = '新稿 🌙\n'; const HASH = 'a'.repeat(64);
const frame: AgentRunWaitingMessage = { type: 'agent_run_waiting', protocol: 'external_writeback_v1',
  execution_epoch: 'live', session_id: 'session', run_id: 'run', assistant_session_id: 7,
  event_id: 2, sequence: 2, wait_id: 'wait', revision: 1, stage: 'await_authorization' };
const normalize = (text: string) => text.replace(/\r\n/g, '\n');
const branch = () => ({ id: 'main', label: 'main', headNodeId: null, baseNodeId: null, color: '#ffffff' });
const noop = () => {};
let container: HTMLDivElement; let root: Root; let coordinator: ExternalWritebackCoordinator;
let ports: CoordinatorPorts; let wait: ExternalWriteback; let profile: AgentPermissionProfile;
let result: AgentSocketMessage | null; let handle: ReturnType<typeof useSuggestionWriteback>;
let models: EditorModelCache;
function EditorHarness({ project = PROJECT, file = FILE }: { project?: string; file?: string }) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const originalContentRef = useRef(BEFORE); const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(file); const projectPathRef = useRef<string | null>(project);
  const cache = useRef<EditorModelCache>(new Map()); const queue = useRef(createWritebackQueue());
  useLayoutEffect(() => {
    projectPathRef.current = project; filePathRef.current = file; models = cache.current;
    if (!cache.current.has(file)) cache.current.set(file, { model: monaco.editor.createModel(BEFORE),
      originalContent: BEFORE, diskBaseline: { kind: 'content', content: BEFORE }, viewState: null });
    editorRef.current ??= monaco.editor.create(document.createElement('div'));
    editorRef.current.setModel(cache.current.get(file)!.model);
  }, [file, project]);
  handle = useSuggestionWriteback({ enqueueWriteback: queue.current, editorRef, originalContentRef,
    cleanVersionIdRef, filePathRef, projectPathRef, modelCacheRef: cache,
    setLoadedContentPreview: noop, setIsDirty: noop, normalizeEol: normalize,
    getActiveBranchSnapshot: branch, advanceBranchHead: effects.advance,
    recordRevisionLoop: effects.record, emitAuthorLoopResult: noop });
  return <output>{handle.pendingSuggestion?.id ?? 'legacy-empty'}</output>;
}
function render(project = PROJECT, file = FILE) {
  root.render(<ExternalWritebackProvider project={project} coordinator={coordinator}>
    <EditorHarness project={project} file={file} /><ExternalWritebackPanel coordinator={coordinator} project={project} assistantSessionId={7} />
  </ExternalWritebackProvider>);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve };
}
function current() { return coordinator.getSnapshot()[0]!; }
async function track(epoch: string | null = 'live') { await act(async () => { await coordinator.track({ ...frame, execution_epoch: epoch }, PROJECT); }); }
async function decide() { await act(async () => { await coordinator.decide(current().key, current().wait!.revision, 'approve'); }); }
beforeEach(async () => {
  effects.disk.clear(); effects.disk.set(FILE, BEFORE); profile = 'ask'; result = null; effects.loseAck = false;
  effects.snapshot.mockReset().mockResolvedValue({ timestamp: 1, created: false });
  effects.record.mockReset().mockResolvedValue({ recordPath: '/record', updatedBlueprintPath: null });
  effects.advance.mockReset().mockResolvedValue(undefined); effects.write.mockClear();
  wait = { protocol: 'external_writeback_v1', run_id: 'run', session_id: 'session', assistant_session_id: 7,
    wait_id: 'wait', revision: 1, stage: 'await_authorization', run_status: 'paused', runtime_state: 'settled',
    event_id: 2, event_sequence: 2, project_path: PROJECT, requested_path: 'chapter.md', raw_before: BEFORE,
    before_hash: HASH, after_hash: HASH, operation_key: '42:whole', source: JSON.stringify([42, normalize(BEFORE), AFTER, 'run']),
    proposal: { id: 42, before: normalize(BEFORE), after: AFTER, requires_confirmation: true }, identity: null,
    decision: null, observation: null, historical_applied: false, feedback_consumed: false, delivery_complete: false,
    permission_profile: 'ask', continuation_available: true };
  const config = { baseUrl: 'http://fixture', apiKey: 'fixture', managedHostGeneration: HASH,
    executionProtocols: ['external_writeback_v1'] as const };
  ports = {
    config: vi.fn(async () => config), capabilities: vi.fn(async () => ({ managed_host_generation: HASH,
      execution_protocols: ['external_writeback_v1'], disabled_reason: null })),
    read: vi.fn(async () => structuredClone(wait)),
    describe: vi.fn(async () => ({ relativePath: 'chapter.md', operationId: HASH, fingerprint: HASH })),
    profile: () => profile, result: vi.fn(async () => result),
    prepare: vi.fn(async (_config, _run, _wait, request) => {
      expect(request.expected_revision).toBe(wait.revision);
      wait = { ...wait, revision: wait.revision + 1, event_sequence: wait.event_sequence + 1,
        stage: request.decision === 'reject' ? 'receipt_ready' : 'awaiting_receipt', identity: request.identity ?? null,
        decision: request.decision, feedback_consumed: request.decision === 'reject' };
      return structuredClone(wait);
    }),
    reconcile: vi.fn(async (_config, _run, _wait, request) => {
      expect(request.expected_revision).toBe(wait.revision);
      if (effects.disk.get(FILE) === AFTER) wait = { ...wait, historical_applied: true, feedback_consumed: true,
        stage: 'receipt_ready', observation: { state: 'applied', current: 'after', receipt_persisted: true } };
      if (request.resume_intent === 'continue_current_execution') {
        expect(wait.feedback_consumed).toBe(true);
        expect(request.execution_epoch).toBe('live');
        wait = { ...wait, run_status: 'running', delivery_complete: true };
      }
      wait = { ...wait, revision: wait.revision + 1, event_sequence: wait.event_sequence + 1 };
      return structuredClone(wait);
    }),
  };
  coordinator = new ExternalWritebackCoordinator(ports);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => render());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it('mounted ask uses the original writer once, with raw CRLF, snapshot, branch and audit; legacy stays empty', async () => {
  await track(); expect(effects.write).not.toHaveBeenCalled();
  expect(container.querySelector('textarea[aria-label="修订提案"]')?.hasAttribute('readonly')).toBe(true);
  await decide(); await decide();
  expect(effects.disk.get(FILE)).toBe(AFTER);
  expect(effects.snapshot).toHaveBeenCalledTimes(1); expect(effects.advance).toHaveBeenCalledTimes(1);
  expect(effects.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: wait.source, operationKey: '42:whole', path: FILE, content: AFTER }));
  expect(effects.record).toHaveBeenCalledTimes(1); expect(handle.pendingSuggestion).toBeNull();
  expect(models.get(FILE)!.model.getValue()).toBe(AFTER);
  expect(current().phase).toBe('running'); expect(ports.prepare).toHaveBeenCalledTimes(1);
});
it('a cold reconstruction is only visible: no describe, prepare, snapshot, Native or provider dispatch', async () => {
  wait.proposal.requires_confirmation = false; wait.permission_profile = 'auto'; profile = 'auto';
  await track(null); await decide();
  expect(current().live).toBe(false); expect(ports.prepare).not.toHaveBeenCalled();
  expect(ports.describe).not.toHaveBeenCalled(); expect(effects.snapshot).not.toHaveBeenCalled();
  expect(effects.write).not.toHaveBeenCalled();
});
it('auto needs both the server proposal flag and live project authorization', async () => {
  wait.permission_profile = 'auto'; profile = 'auto'; await track(); expect(effects.write).not.toHaveBeenCalled();
  await act(async () => root.unmount()); root = createRoot(container);
  coordinator = new ExternalWritebackCoordinator(ports); wait.proposal.requires_confirmation = false;
  await act(async () => render()); await track();
  expect(effects.write).toHaveBeenCalledTimes(1);
  expect(ports.prepare).toHaveBeenCalledWith(expect.anything(), 'run', 'wait', expect.objectContaining({ decision: 'auto' }));
});
it('dirty buffer prevents even preparation; absence is not treated as a clean editor', async () => {
  await track(); models.get(FILE)!.model.setValue('作者新输入'); await decide();
  expect(ports.prepare).not.toHaveBeenCalled(); expect(effects.snapshot).not.toHaveBeenCalled();
  expect(current().error).toContain('缓冲已变化');
});
it('permission revoked while snapshot awaits prevents Native admission, while preserving the snapshot fact', async () => {
  const pending = deferred<{ timestamp: number; created: boolean }>(); effects.snapshot.mockReturnValueOnce(pending.promise);
  await track(); let operation!: Promise<void>;
  await act(async () => { operation = coordinator.decide(current().key, 1, 'approve'); });
  expect(effects.snapshot).toHaveBeenCalledTimes(1); profile = 'read';
  await act(async () => { pending.resolve({ timestamp: 1, created: false }); await operation; });
  expect(effects.write).not.toHaveBeenCalled(); expect(effects.advance).not.toHaveBeenCalled();
  expect(effects.disk.get(FILE)).toBe(BEFORE); expect(current().error).toContain('权限');
});
it('project A→B→A during prepare cannot borrow a new editor lifetime or revive approval', async () => {
  const pending = deferred<ExternalWriteback>(); ports.prepare = vi.fn(() => pending.promise);
  await track(); let operation!: Promise<void>;
  await act(async () => { operation = coordinator.decide(current().key, 1, 'approve'); });
  await act(async () => render('D:/other', 'D:/other/chapter.md'));
  await act(async () => render());
  await act(async () => { pending.resolve({ ...wait, stage: 'awaiting_receipt', revision: 2,
    identity: { relativePath: 'chapter.md', operationId: HASH, fingerprint: HASH } }); await operation; });
  expect(effects.snapshot).not.toHaveBeenCalled(); expect(effects.write).not.toHaveBeenCalled(); expect(current().live).toBe(false);
});
it('remote control observed after branch advancement stops dispatch before Native', async () => {
  effects.advance.mockImplementationOnce(async () => { wait = { ...wait, continuation_available: false, revision: wait.revision + 1 }; });
  await track(); await decide();
  expect(effects.snapshot).toHaveBeenCalledTimes(1); expect(effects.write).not.toHaveBeenCalled();
  expect(current().live).toBe(false); expect(effects.disk.get(FILE)).toBe(BEFORE);
});
it('snapshot failure stays blocked; it is not a fabricated not_written receipt or a reason to retry the writer', async () => {
  effects.snapshot.mockRejectedValueOnce(new Error('snapshot failed'));
  await track(); await decide(); await decide();
  expect(effects.write).not.toHaveBeenCalled(); expect(ports.reconcile).not.toHaveBeenCalled();
  expect(effects.snapshot).toHaveBeenCalledTimes(1); expect(current().error).toContain('提案');
});
it('audit failure is historical applied; repair records only, without another snapshot/branch/body write', async () => {
  effects.record.mockRejectedValueOnce(new Error('audit missing'));
  await track(); await decide(); expect(wait.historical_applied).toBe(true);
  expect(wait.delivery_complete).toBe(false); expect(current().phase).toBe('blocked');
  await act(async () => { await coordinator.repairAudit(current().key); });
  expect(effects.record).toHaveBeenCalledTimes(2); expect(effects.snapshot).toHaveBeenCalledTimes(1);
  expect(effects.advance).toHaveBeenCalledTimes(1); expect(effects.write).toHaveBeenCalledTimes(1);
  expect(wait.delivery_complete).toBe(true);
});
it('Native ACK loss queries the persisted fixture ledger, does not execute a second body write', async () => {
  effects.loseAck = true; await track(); await decide();
  expect(effects.write).toHaveBeenCalledTimes(1); expect(effects.snapshot).toHaveBeenCalledTimes(1);
  expect(wait.feedback_consumed).toBe(true); expect(wait.delivery_complete).toBe(true);
});
it('reject has no Native identity or writer; it feeds the same run and retains the original text', async () => {
  await track(); await act(async () => { await coordinator.decide(current().key, 1, 'reject'); });
  expect(ports.describe).not.toHaveBeenCalled(); expect(effects.snapshot).not.toHaveBeenCalled();
  expect(effects.write).not.toHaveBeenCalled(); expect(effects.disk.get(FILE)).toBe(BEFORE);
  expect(wait.feedback_consumed).toBe(true); expect(current().phase).toBe('running');
});
it('late read with an older revision cannot overwrite a newer binding or high watermark', async () => {
  await track(); const old = structuredClone(wait); await decide();
  ports.read = vi.fn(async () => old);
  await act(async () => { await coordinator.refresh(current().key); });
  expect(current().wait!.revision).toBeGreaterThan(old.revision); expect(current().wait!.historical_applied).toBe(true);
});
it('close fence during preparation revokes the live scope before any guarded write effect', async () => {
  const pending = deferred<ExternalWriteback>(); ports.prepare = vi.fn(() => pending.promise);
  await track(); let operation!: Promise<void>;
  await act(async () => { operation = coordinator.decide(current().key, 1, 'approve'); });
  await act(async () => { coordinator.beginClose(); pending.resolve({ ...wait, stage: 'awaiting_receipt', revision: 2,
    identity: { relativePath: 'chapter.md', operationId: HASH, fingerprint: HASH } }); await operation; });
  expect(await coordinator.negotiate()).toBe(false); expect(current().live).toBe(false);
  expect(effects.snapshot).not.toHaveBeenCalled(); expect(effects.write).not.toHaveBeenCalled();
});
it('lost continuation ACK can be observed and explicitly continued, never replaying the writer', async () => {
  const original = ports.reconcile; let lost = true;
  ports.reconcile = vi.fn(async (...args) => {
    if (args[3].resume_intent === 'continue_current_execution' && lost) { lost = false; throw new Error('continuation request lost'); }
    return original(...args);
  });
  await track(); await decide(); expect(current().wait!.feedback_consumed).toBe(true);
  expect(wait.delivery_complete).toBe(false);
  await act(async () => { await coordinator.continueVerified(current().key, current().wait!.revision); });
  expect(wait.delivery_complete).toBe(true); expect(effects.write).toHaveBeenCalledTimes(1);
  expect(effects.snapshot).toHaveBeenCalledTimes(1); expect(effects.record).toHaveBeenCalledTimes(1);
});
it('definite prepare commit followed by a lost ACK is rebuilt, not interpreted as permission for a second apply', async () => {
  const original = ports.prepare;
  ports.prepare = vi.fn(async (...args) => { await original(...args); throw new Error('prepare ACK lost'); });
  await track(); await decide();
  expect(current().wait!.stage).toBe('awaiting_receipt'); expect(current().wait!.revision).toBe(2);
  expect(current().phase).toBe('blocked'); expect(effects.write).not.toHaveBeenCalled();
  await decide(); expect(ports.prepare).toHaveBeenCalledTimes(1); expect(effects.snapshot).not.toHaveBeenCalled();
});
