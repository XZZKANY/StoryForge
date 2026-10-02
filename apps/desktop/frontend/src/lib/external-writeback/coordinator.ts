import type { AgentRunWaitingMessage, AgentSocketMessage } from '../api/types';
import type { ExternalWriteback } from '../api/managed-agent-host';
import { supportsExternalWriteback } from '../api/managed-agent-host';
import { relativePathInsideProject, resolveProjectRelativePath } from '../project-context';
import { repairColdAudit } from './cold-audit';
import { discoverColdEntries } from './discovery';
import {
  desktopCoordinatorPorts,
  type CoordinatorPorts,
  type ExternalEditorPort,
  type ExternalWaitView,
  type GuardedExternalExecution,
  type Entry,
} from './ports';
export { desktopCoordinatorPorts } from './ports';
export type {
  CoordinatorPorts,
  ExternalEditorPort,
  ExternalWaitView,
  GuardedExternalExecution,
} from './ports';

/** App-owned dispatcher. UI, old suggestion events and active editor never own the wait. */
export class ExternalWritebackCoordinator {
  private entries = new Map<string, Entry>();
  private editors = new Set<ExternalEditorPort>();
  private listeners = new Set<() => void>();
  private snapshot: readonly ExternalWaitView[] = [];
  private project: string | null = null;
  private lifetime: object = {};
  private closing = false;
  private diagnostics = new Map<string, string[]>();
  getDiagnostics(project: string | null) {
    return project ? (this.diagnostics.get(project) ?? []) : [];
  }
  constructor(private ports: CoordinatorPorts = desktopCoordinatorPorts) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = [...this.entries.values()].map(
      ({ config: _config, epoch: _epoch, retryAudit: _retry, onResult: _onResult, ...view }) => ({
        ...view,
        live: _epoch !== null,
        canRepairAudit: _retry !== null,
      }),
    );
    this.listeners.forEach((listener) => listener());
  }
  setProject(project: string | null) {
    if (this.project === project) return;
    this.project = project;
    this.lifetime = {};
    // A→B→A cannot revive an approval captured in the first A lifetime.
    for (const entry of this.entries.values()) entry.epoch = null;
    this.emit();
  }
  registerEditor(port: ExternalEditorPort) {
    this.editors.add(port);
    return () => {
      this.editors.delete(port);
    };
  }
  async negotiate(): Promise<boolean> {
    if (this.closing) return false;
    const lifetime = this.lifetime;
    const config = await this.ports.config();
    if (!config.executionProtocols?.includes('external_writeback_v1')) return false;
    const supported = supportsExternalWriteback(config, await this.ports.capabilities(config));
    return supported && lifetime === this.lifetime && !this.closing;
  }
  hasPending(project: string) {
    return [...this.entries.values()].some(
      (entry) => entry.project === project && entry.phase !== 'finished',
    );
  }
  async discover(project: string) {
    if (!this.ports.list || this.closing) return;
    const lifetime = this.lifetime;
    const current = () => !this.closing && this.lifetime === lifetime && this.project === project;
    try {
      const discovery = await discoverColdEntries(this.ports, project, current);
      if (!current()) return;
      this.diagnostics.set(project, discovery.diagnostics);
      for (const entry of discovery.entries) {
        if (this.entries.has(entry.key)) continue;
        this.acceptProjection(entry, entry.wait!);
        this.entries.set(entry.key, entry);
      }
    } catch {
      if (!current()) return;
      this.diagnostics.set(project, ['external_recovery_list_unavailable']);
    }
    this.emit();
  }
  async recover(key: string) {
    const entry = this.entries.get(key);
    if (
      !entry?.wait ||
      !this.ports.recover ||
      this.closing ||
      this.project !== entry.project ||
      ['applying', 'observing', 'running'].includes(entry.phase)
    )
      return;
    const lifetime = this.lifetime;
    entry.phase = 'observing';
    this.emit();
    try {
      const config = await this.ports.config();
      if (!supportsExternalWriteback(config, await this.ports.capabilities(config)))
        throw new Error('当前宿主不支持恢复');
      if (this.closing || lifetime !== this.lifetime || this.project !== entry.project)
        throw new Error('恢复作用域已变化');
      const result = await this.ports.recover(config, entry.frame.run_id, entry.frame.wait_id, {
        session_id: entry.frame.session_id,
        expected_revision: entry.wait.revision,
        expected_event_sequence: entry.wait.event_sequence,
        permission_profile: this.ports.profile(entry.project),
      });
      entry.epoch = null;
      this.acceptProjection(entry, result.writeback);
      if (this.closing || lifetime !== this.lifetime || this.project !== entry.project)
        throw new Error('恢复作用域已变化');
      entry.config = config;
      if (result.mode === 'audit_required') {
        const original = result.writeback;
        entry.retryAudit = () =>
          repairColdAudit(original, () => {
            if (this.closing || lifetime !== this.lifetime || this.project !== entry.project)
              throw new Error('原审计补记作用域已变化');
          });
        throw new Error('正文已写入，需先补原审计记录；不会重写正文');
      }
      entry.epoch = result.execution_epoch ?? null;
      entry.attempted = result.mode !== 'await_confirmation';
      entry.error = null;
      entry.phase = 'waiting';
      // Never call decide/observe automatically, including project auto/full.
    } catch (error) {
      entry.epoch = null;
      entry.phase = 'blocked';
      entry.error = error instanceof Error ? error.message : String(error);
    }
    this.emit();
  }
  async track(
    frame: AgentRunWaitingMessage,
    project: string,
    onResult?: (message: AgentSocketMessage) => void,
  ) {
    const key = `${frame.session_id}:${frame.run_id}:${frame.wait_id}`;
    const prior = this.entries.get(key);
    if (prior) {
      if (onResult) prior.onResult = onResult;
      await this.refresh(key);
      return;
    }
    const lifetime = this.lifetime;
    const config = await this.ports.config();
    const entry: Entry = {
      key,
      project,
      frame,
      config,
      epoch:
        this.project === project && this.lifetime === lifetime && !this.closing
          ? frame.execution_epoch
          : null,
      wait: null,
      phase: 'loading',
      error: null,
      result: null,
      attempted: false,
      retryAudit: null,
      onResult,
    };
    this.entries.set(key, entry);
    this.emit();
    await this.refresh(key);
    if (
      entry.wait?.stage === 'await_authorization' &&
      entry.epoch &&
      entry.wait.proposal.requires_confirmation === false &&
      ['auto', 'full'].includes(this.ports.profile(project)) &&
      project === this.project
    )
      await this.decide(key, entry.wait.revision, 'auto');
  }
  private acceptProjection(entry: Entry, wait: ExternalWriteback) {
    if (
      wait.run_id !== entry.frame.run_id ||
      wait.session_id !== entry.frame.session_id ||
      wait.wait_id !== entry.frame.wait_id ||
      wait.assistant_session_id !== entry.frame.assistant_session_id ||
      wait.project_path !== entry.project ||
      relativePathInsideProject(
        entry.project,
        resolveProjectRelativePath(entry.project, wait.requested_path) ?? '',
      ) === null
    )
      throw new Error('写回响应归属或项目边界已变化');
    if (
      entry.wait &&
      (wait.revision < entry.wait.revision || wait.event_sequence < entry.wait.event_sequence)
    )
      return;
    entry.wait = wait;
    if (!wait.continuation_available || wait.run_status === 'stopped') entry.epoch = null;
  }
  async refresh(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    try {
      this.acceptProjection(
        entry,
        await this.ports.read(entry.config, entry.frame.run_id, entry.frame.session_id),
      );
      const result = await this.ports.result(
        entry.frame.run_id,
        entry.frame.session_id,
        entry.config,
      );
      if (result) {
        if (!entry.result) {
          entry.result = result;
          entry.onResult?.(result);
        }
        entry.phase = 'finished';
        entry.epoch = null;
      } else if (!['applying', 'observing'].includes(entry.phase)) {
        // The accepted HTTP response precedes background STARTED. Keep read-only polling
        // across that paused gap only after this page requested continuation.
        // Historical delivery_complete is not a dispatch request or authority.
        const queued =
          entry.phase === 'running' &&
          entry.wait?.run_status === 'paused' &&
          entry.wait.delivery_complete &&
          entry.wait.continuation_available;
        entry.phase = entry.wait?.run_status === 'running' || queued ? 'running' : 'waiting';
      }
      entry.error = null;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      if (!['applying', 'observing'].includes(entry.phase)) entry.phase = 'blocked';
    }
    this.emit();
  }
  private assertScope(entry: Entry, lifetime: object, revision?: number) {
    if (
      this.closing ||
      this.project !== entry.project ||
      this.lifetime !== lifetime ||
      !entry.epoch ||
      !entry.wait ||
      entry.wait.run_status !== 'paused' ||
      !entry.wait.continuation_available ||
      (revision !== undefined && entry.wait.revision !== revision)
    )
      throw new Error('当前执行资格已失效；请只读核对原运行');
    if (this.ports.profile(entry.project) !== entry.wait.permission_profile)
      throw new Error('项目权限已变化，旧审批不能沿用');
  }
  async decide(key: string, revision: number, decision: 'approve' | 'auto' | 'reject') {
    const entry = this.entries.get(key);
    if (!entry || ['applying', 'observing', 'running'].includes(entry.phase)) return;
    const lifetime = this.lifetime;
    try {
      this.assertScope(entry, lifetime, revision);
      const original = entry.wait!;
      if (original.stage !== 'await_authorization' || entry.attempted)
        throw new Error('提案不再等待首次批准');
      if (
        decision === 'auto' &&
        (original.proposal.requires_confirmation !== false ||
          !['auto', 'full'].includes(this.ports.profile(entry.project)))
      )
        throw new Error('当前项目未授权自动落盘');
      entry.phase = 'applying';
      entry.error = null;
      this.emit();
      const freshConfig = await this.ports.config();
      if (
        freshConfig.baseUrl !== entry.config.baseUrl ||
        freshConfig.managedHostGeneration !== entry.config.managedHostGeneration ||
        !supportsExternalWriteback(freshConfig, await this.ports.capabilities(entry.config))
      )
        throw new Error('受管理宿主执行能力已失效');
      this.assertScope(entry, lifetime, revision);
      let execution: GuardedExternalExecution | undefined;
      if (decision !== 'reject') {
        for (const editor of this.editors) {
          try {
            execution = editor.acquire(original);
            break;
          } catch {
            /* Try the original target owner only. */
          }
        }
        if (!execution) throw new Error('目标编辑器未就绪或缓冲已变化；请打开原文件并核对');
      }
      const identity =
        decision === 'reject' ? null : await this.ports.describe(entry.project, original);
      this.assertScope(entry, lifetime, revision);
      execution?.validate();
      this.acceptProjection(
        entry,
        await this.ports.prepare(entry.config, entry.frame.run_id, entry.frame.wait_id, {
          session_id: entry.frame.session_id,
          expected_revision: revision,
          identity,
          decision,
          permission_profile: this.ports.profile(entry.project),
          execution_epoch: entry.epoch,
        }),
      );
      this.assertScope(entry, lifetime);
      if (decision !== 'reject') {
        if (
          !entry.wait?.identity ||
          entry.wait.identity.operationId !== identity?.operationId ||
          entry.wait.identity.fingerprint !== identity?.fingerprint ||
          entry.wait.identity.relativePath !== identity?.relativePath
        )
          throw new Error('原生身份未被后端绑定，已阻止派发');
        entry.attempted = true;
        this.emit();
        const preparedRevision = entry.wait.revision;
        const outcome = await execution!.execute(
          () => {
            this.assertScope(entry, lifetime);
            execution!.validate();
          },
          async () => {
            this.acceptProjection(
              entry,
              await this.ports.read(entry.config, entry.frame.run_id, entry.frame.session_id),
            );
            this.assertScope(entry, lifetime, preparedRevision);
            execution!.validate();
          },
        );
        entry.retryAudit = outcome.retryAudit;
        // An audit error is applied, not failed-to-write. Observe, never apply again.
        if (outcome.warning) {
          await this.observe(key, false);
          throw new Error(outcome.warning);
        }
      }
      await this.observe(key, true);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      try {
        this.acceptProjection(
          entry,
          await this.ports.read(entry.config, entry.frame.run_id, entry.frame.session_id),
        );
      } catch {
        /* An uncertain response never restores dispatch authority. */
      }
      entry.phase = 'blocked';
      this.emit();
    }
  }
  async observe(key: string, continueLive = false) {
    const entry = this.entries.get(key);
    if (!entry?.wait) return;
    const lifetime = this.lifetime;
    entry.phase = 'observing';
    this.emit();
    try {
      this.acceptProjection(
        entry,
        await this.ports.read(entry.config, entry.frame.run_id, entry.frame.session_id),
      );
      if (!entry.wait?.identity && entry.wait?.decision !== 'reject') {
        entry.phase = 'waiting';
        await this.refresh(key);
        return;
      }
      this.acceptProjection(
        entry,
        await this.ports.reconcile(entry.config, entry.frame.run_id, entry.frame.wait_id, {
          session_id: entry.frame.session_id,
          expected_revision: entry.wait.revision,
          resume_intent: 'observe_only',
        }),
      );
      if (continueLive) {
        this.assertScope(entry, lifetime);
        if (
          !['receipt_ready', 'claimed'].includes(entry.wait?.stage ?? '') ||
          !entry.wait?.feedback_consumed
        )
          throw new Error('回执尚未独立核验，不能继续模型');
        this.acceptProjection(
          entry,
          await this.ports.reconcile(entry.config, entry.frame.run_id, entry.frame.wait_id, {
            session_id: entry.frame.session_id,
            expected_revision: entry.wait.revision,
            resume_intent: 'continue_current_execution',
            execution_epoch: entry.epoch!,
          }),
        );
      }
      entry.phase = continueLive ? 'running' : 'waiting';
      await this.refresh(key);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      entry.phase = 'blocked';
      this.emit();
      if (continueLive) throw error;
    }
  }
  async repairAudit(key: string) {
    const entry = this.entries.get(key);
    if (!entry?.retryAudit) return;
    try {
      await entry.retryAudit();
      entry.retryAudit = null;
      await this.observe(key, entry.epoch !== null);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      this.emit();
    }
  }
  async continueVerified(key: string, revision: number) {
    const entry = this.entries.get(key);
    if (
      !entry?.wait ||
      entry.wait.revision !== revision ||
      !['receipt_ready', 'claimed'].includes(entry.wait.stage) ||
      !entry.wait.feedback_consumed ||
      ['applying', 'observing', 'running'].includes(entry.phase)
    )
      return;
    try {
      await this.observe(key, true);
    } catch {
      /* observe owns the visible error; never restart or repeat a writer. */
    }
  }
  beginClose() {
    this.closing = true;
    this.lifetime = {};
    for (const entry of this.entries.values()) entry.epoch = null;
    this.emit();
  }
}
