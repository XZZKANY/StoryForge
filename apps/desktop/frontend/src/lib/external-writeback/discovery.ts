import type { AgentRunWaitingMessage } from '../api/types';
import type { CoordinatorPorts, Entry } from './ports';

/** Bounded cold reconstruction: retain diagnostics without inventing wait objects. */
export async function discoverColdEntries(
  ports: CoordinatorPorts,
  project: string,
  current: () => boolean,
) {
  const entries: Entry[] = [];
  const diagnostics: string[] = [];
  if (!ports.list || !current()) return { entries, diagnostics };
  const config = await ports.config();
  const list = await ports.list(config, project);
  if (!current()) return { entries, diagnostics };
  for (const item of list.items) {
    if (!current()) break;
    if (!item.wait_id || item.revision == null) {
      diagnostics.push(`${item.run_id} · ${item.blocked_reason ?? 'invalid_wait'}`);
      continue;
    }
    try {
      const wait = await ports.read(config, item.run_id, item.session_id);
      if (!current()) break;
      const frame: AgentRunWaitingMessage = {
        type: 'agent_run_waiting',
        protocol: 'external_writeback_v1',
        session_id: wait.session_id,
        run_id: wait.run_id,
        assistant_session_id: wait.assistant_session_id,
        wait_id: wait.wait_id,
        revision: wait.revision,
        stage: wait.stage,
        event_id: wait.event_id,
        sequence: wait.event_sequence,
        execution_epoch: null,
      };
      entries.push({
        key: `${wait.session_id}:${wait.run_id}:${wait.wait_id}`,
        project,
        frame,
        config,
        epoch: null,
        wait,
        phase: item.blocked_reason ? 'blocked' : 'waiting',
        error: item.blocked_reason ?? null,
        result: null,
        attempted: wait.historical_applied || wait.feedback_consumed,
        retryAudit: null,
      });
    } catch {
      diagnostics.push(`${item.run_id} · external_recovery_read_failed`);
    }
  }
  if (list.next_after_id !== null) diagnostics.push('还有更多待办；当前仅只读展示前 20 项。');
  return { entries, diagnostics };
}
