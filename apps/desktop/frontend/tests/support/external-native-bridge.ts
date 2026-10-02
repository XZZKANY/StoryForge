import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiConfig } from '../../src/lib/api/types';
import type { AgentPermissionProfile } from '../../src/lib/agent-permission';
import { decodeWritebackReceipt } from '../../src/lib/writeback-receipt-types';

export type CombinedFixture = {
  project: string;
  before: string;
  after: string;
  nativeBinary: string;
  dataRoot: string;
  config: ApiConfig;
  profile: AgentPermissionProfile;
  scenario:
    | 'normal'
    | 'native_ack_lost'
    | 'audit_unavailable'
    | 'pause_after_native'
    | 'stop_after_native'
    | 'buffer_changed'
    | 'disk_changed_before_native'
    | 'snapshot_unavailable'
    | 'branch_unavailable'
    | 'outcome_missing_after_write'
    | 'disk_changed_after_write'
    | 'reject'
    | 'cold_audit_repair'
    | 'manual_remount'
    | 'close_during_audit';
  // P2 scenarios use the persistent real Native admission state.
};

/** Explicit process shim only; no fixture ledger, writer or snapshot implementation. */
export function nativeFixtureInvoker(manifestPath: string, fixture: CombinedFixture) {
  const child = spawn(
    fixture.nativeBinary,
    [
      '--ignored',
      '--exact',
      'external_native_ipc_fixture::native_ipc_bridge',
      '--nocapture',
      '--test-threads=1',
    ],
    {
      env: {
        ...process.env,
        STORYFORGE_EXTERNAL_NATIVE_IPC_FIXTURE: manifestPath,
        STORYFORGE_EXTERNAL_NATIVE_IPC_STREAM: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  type Pending = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  const pending: Pending[] = [];
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const index = line.indexOf('SF_IPC ');
    if (index < 0) return;
    const request = pending.shift();
    if (!request) return;
    clearTimeout(request.timer);
    try {
      request.resolve(JSON.parse(line.slice(index + 7)));
    } catch {
      request.reject(new Error('invalid Native stream response'));
    }
  });
  const failed = () => {
    pending.splice(0).forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error('Native fixture exited before response'));
    });
  };
  child.on('error', failed);
  child.on('exit', failed);
  child.stderr.resume();
  const exchange = (input: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Native IPC deadline'));
      }, 30_000);
      pending.push({ resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(input)}\n`);
    });
  const dispose = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        lines.close();
        resolve();
        return;
      }
      const timer = setTimeout(() => child.kill(), 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        lines.close();
        resolve();
      });
      child.stdin.end();
    });
  let onClosing = () => {};
  let auditUnavailable = ['audit_unavailable', 'cold_audit_repair'].includes(fixture.scenario);
  let nativeAckLost = fixture.scenario === 'native_ack_lost';
  const counts = new Map<string, number>();
  const commands: string[] = [];
  const invoke = async (command: string, args: unknown = {}) => {
    counts.set(command, (counts.get(command) ?? 0) + 1);
    commands.push(command);
    if (command === 'get_api_config') return fixture.config;
    if (command === 'create_shadow_snapshot' && fixture.scenario === 'snapshot_unavailable')
      throw new Error('fixture snapshot transport unavailable before Native creation');
    if (command === 'write_file_with_receipt' && fixture.scenario === 'disk_changed_before_native')
      // A separate filesystem actor changes the baseline after snapshot/branch, before admission.
      writeFileSync(join(fixture.project, 'chapter.md'), `${fixture.before}外部改动\n`);
    if (command === 'create_writeback_audit' && auditUnavailable) {
      auditUnavailable = false;
      throw new Error('fixture transport unavailable before audit creation');
    }
    const result = await exchange({
      command,
      args,
      projectRoot: fixture.project,
      dataRoot: fixture.dataRoot,
    });
    if (!result || typeof result !== 'object' || !('ok' in result))
      throw new Error('invalid Native fixture output');
    if (result.ok !== true)
      throw new Error('error' in result ? String(result.error) : 'Native fixture failed');
    if (
      command === 'write_file_with_receipt' &&
      fixture.scenario === 'outcome_missing_after_write'
    ) {
      const receipt = decodeWritebackReceipt('value' in result ? result.value : null);
      // Isolated fault injection: retain the real intent/body, remove only this operation's outcome.
      unlinkSync(
        join(
          fixture.project,
          '.storyforge',
          'writeback-receipts',
          `${receipt.operationId}.outcome.json`,
        ),
      );
    }
    if (command === 'write_file_with_receipt' && fixture.scenario === 'disk_changed_after_write')
      writeFileSync(join(fixture.project, 'chapter.md'), `${fixture.after}外部改动\n`);
    if (command === 'write_file_with_receipt' && fixture.scenario === 'close_during_audit') {
      await invoke('fixture_begin_close');
      onClosing();
      await invoke('acknowledge_host_closing');
      const response = await fetch(`${fixture.config.baseUrl}/api/agent-runs/host/closing`, {
        method: 'POST',
        headers: {
          'X-StoryForge-API-Key': fixture.config.apiKey,
          'X-StoryForge-Host-Generation': fixture.config.managedHostGeneration!,
        },
      });
      if (!response.ok) throw new Error('fixture API close fence failed');
    }
    if (command === 'write_file_with_receipt' && nativeAckLost) {
      nativeAckLost = false;
      throw new Error('fixture ACK lost after actual Native ledger commit');
    }
    if (
      command === 'write_file_with_receipt' &&
      ['pause_after_native', 'stop_after_native', 'manual_remount'].includes(fixture.scenario)
    ) {
      const response = await fetch(
        `${fixture.config.baseUrl}/api/ide/agent/sessions/live-session/control`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-StoryForge-API-Key': fixture.config.apiKey,
          },
          body: JSON.stringify({
            type: fixture.scenario === 'stop_after_native' ? 'stop_run' : 'pause_run',
            run_id: 'live-run',
          }),
        },
      );
      if (!response.ok) throw new Error('fixture control failed');
      const ack: unknown = await response.json();
      if (!ack || typeof ack !== 'object' || !('type' in ack) || ack.type === 'error')
        throw new Error('fixture control rejected');
    }
    return 'value' in result ? result.value : null;
  };
  return {
    invoke,
    counts,
    commands,
    dispose,
    onClosing: (callback: () => void) => {
      onClosing = callback;
    },
  };
}
