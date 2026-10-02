import { useExternalWaits } from './ExternalWritebackProvider';
import type { ExternalWritebackCoordinator } from '../../lib/external-writeback/coordinator';
import { Button } from '../ui';
import { AgentDecisionPrompt } from '../chat-window/AgentDecisionPrompt';
import { useState } from 'react';
import type { ExternalWaitView } from '../../lib/external-writeback/ports';

const isBusy = (view: ExternalWaitView) =>
  ['loading', 'applying', 'observing', 'running'].includes(view.phase);
const canApproveWait = (view: ExternalWaitView) =>
  !isBusy(view) &&
  !view.attempted &&
  view.live &&
  view.wait?.continuation_available &&
  view.wait.stage === 'await_authorization';
function decisionKind(view: ExternalWaitView) {
  const wait = view.wait;
  if (isBusy(view)) return null;
  if (canApproveWait(view)) return 'approve';
  if (!view.live && wait?.run_status === 'paused') return 'recover';
  if (wait && !wait.delivery_complete && view.canRepairAudit) return 'audit';
  if (view.live && wait?.feedback_consumed && ['receipt_ready', 'claimed'].includes(wait.stage))
    return 'continue';
  return null;
}

/** Whole-only approval: no editable patch or hunk can reuse the frozen authorization. */
export function ExternalWritebackPanel({
  coordinator,
  project,
  assistantSessionId,
  decisionDialogsActive = true,
}: {
  coordinator: ExternalWritebackCoordinator;
  project: string | null;
  assistantSessionId: number | null;
  decisionDialogsActive?: boolean;
}) {
  const views = useExternalWaits(coordinator);
  const [requestedWait, setRequestedWait] = useState<string | null>(null);
  const diagnostics = coordinator.getDiagnostics(project);
  const visible = views.filter(
    (view) =>
      view.project === project &&
      view.frame.assistant_session_id === assistantSessionId &&
      view.phase !== 'finished',
  );
  const decisions = visible.filter((view) => decisionKind(view));
  const attention = decisions.find((view) => view.key === requestedWait) ?? decisions[0];
  if (!visible.length && !diagnostics.length) return null;
  return (
    <aside
      aria-label="连续修订待办"
      className="max-h-[50%] min-h-0 shrink-0 overflow-y-auto bg-panel px-5 py-3 text-sm"
      data-testid="external-conversation-wait"
    >
      {diagnostics.map((reason) => (
        <p key={reason} role="status">
          只读待办诊断：{reason}
        </p>
      ))}
      {visible.map((view) => {
        const wait = view.wait;
        const busy = isBusy(view);
        const canApprove = canApproveWait(view);
        const decision = decisionKind(view);
        const title =
          decision === 'recover'
            ? '是否恢复原运行的执行资格？'
            : decision === 'audit'
              ? '是否补齐原写回的审计记录？'
              : decision === 'continue'
                ? '是否继续原运行？'
                : '是否接受这版章节修订？';
        return (
          <section key={view.key} aria-labelledby={`external-${view.frame.wait_id}`}>
            <h2 id={`external-${view.frame.wait_id}`} className="font-semibold">
              {busy
                ? '整章修订 · 正在核对执行结果'
                : decision
                  ? '整章修订 · 待你决定'
                  : '整章修订 · 结果待核对'}
            </h2>
            <p className="text-sm">
              {wait?.requested_path ?? view.frame.run_id} ·{' '}
              {view.phase === 'running'
                ? wait?.run_status === 'running'
                  ? '原运行正在继续'
                  : '已请求继续原运行，正在核对结算'
                : view.phase}
            </p>
            {view.error && (
              <p role="alert" className="text-sm">
                {view.error}
              </p>
            )}
            {wait?.historical_applied && <p>原稿已写入；不会再次应用。</p>}
            <Button
              size="xs"
              disabled={busy}
              onClick={() => {
                void coordinator.observe(view.key);
              }}
            >
              只读核对
            </Button>
            <AgentDecisionPrompt
              decisionKey={decision ? `${view.key}:${decision}` : null}
              active={decisionDialogsActive && attention?.key === view.key}
              onRequestOpen={() => setRequestedWait(view.key)}
              title={title}
            >
              <p className="mb-3 break-all text-sm text-muted">
                {wait?.requested_path ?? view.frame.run_id}
              </p>
              {wait && (
                <details>
                  <summary>查看原稿与整版提案（只读）</summary>
                  <div className="grid gap-2">
                    <label>
                      原稿
                      <textarea
                        aria-label="原稿"
                        readOnly
                        value={wait.proposal.before}
                        className="sf-input h-40 w-full bg-background"
                      />
                    </label>
                    <label>
                      修订提案
                      <textarea
                        aria-label="修订提案"
                        readOnly
                        value={wait.proposal.after}
                        className="sf-input h-40 w-full bg-background"
                      />
                    </label>
                  </div>
                </details>
              )}
              {wait?.historical_applied && (
                <p>
                  原稿已写入；不会再次应用。{wait.delivery_complete ? '' : '交付证据仍待核对。'}
                </p>
              )}
              {view.error && (
                <p role="alert" className="text-sm">
                  {view.error}
                </p>
              )}
              {!view.live && <p>执行资格已丢失。当前只读核对，不会自动恢复。</p>}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="primary"
                  disabled={!canApprove}
                  onClick={() => {
                    if (wait) void coordinator.decide(view.key, wait.revision, 'approve');
                  }}
                >
                  接受整版并继续
                </Button>
                <Button
                  disabled={!canApprove}
                  onClick={() => {
                    if (wait) void coordinator.decide(view.key, wait.revision, 'reject');
                  }}
                >
                  拒绝修订并继续
                </Button>
                {!view.live && wait?.run_status === 'paused' && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void coordinator.recover(view.key);
                    }}
                  >
                    重新建立恢复资格（不批准、不写入）
                  </Button>
                )}
                {wait &&
                  ['receipt_ready', 'claimed'].includes(wait.stage) &&
                  wait.feedback_consumed && (
                    <Button
                      disabled={busy || !view.live}
                      onClick={() => {
                        void coordinator.continueVerified(view.key, wait.revision);
                      }}
                    >
                      继续原运行（不重写）
                    </Button>
                  )}
                {wait && !wait.delivery_complete && view.canRepairAudit && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void coordinator.repairAudit(view.key);
                    }}
                  >
                    补审计记录（不重写正文）
                  </Button>
                )}
              </div>
            </AgentDecisionPrompt>
          </section>
        );
      })}
    </aside>
  );
}
