// 输入框上方的操作条：要作者拍板时的编号选项、停止的两段确认、暂停条。
import { Button } from '../ui';

import { useEffect, useRef, useState } from 'react';
import { AUTHOR_LOOP_RESULT_EVENT, type AuthorLoopResult } from '../../lib/assistant-events';
import { DecisionChoices } from './DecisionChoices';
import type { AgentRunRecoveryDisplay } from './recovery';
import type { AgentRun, AgentRunControlHandlers } from './types';

// RunActionBar 按钮统一到 Button 原语后的公共类：保留等效 h-8/text-xs 与按压反馈。
const runActionButtonClass = 'interactive-press font-medium transition-colors text-xs';

// 「停止」两段确认的有效窗口：超时自动回到未确认态。
const STOP_CONFIRM_TIMEOUT_MS = 5000;

/**
 * Composer 上方的操作条：要作者拍板（权限、补丁）时是就地的编号选项；暂停时是一行「已暂停」。
 * 跑着时没有操作条——进度与用时在思考过程那一行，停止是输入框右下角那颗键。
 */
export function RunActionBar({
  run,
  controls,
  recovery,
  resumePending = false,
  onTypeAhead,
}: {
  run: AgentRun;
  controls: AgentRunControlHandlers;
  recovery?: AgentRunRecoveryDisplay | null;
  resumePending?: boolean;
  /** 选项有焦点时作者开始打字：把焦点还给输入框（免得回车误选了「接受」）。 */
  onTypeAhead?: () => void;
}) {
  // 停止是破坏性终态动作：第一次点击只进入待确认，再点才执行；超时/失焦/划走都取消。
  const [stopConfirmArmed, setStopConfirmArmed] = useState(false);
  // 点「接受」后编辑器要先拍快照再写盘，要几秒：就地显示正在写，免得作者以为没点上又连点。
  const [acceptingPatchId, setAcceptingPatchId] = useState<string | null>(null);
  useEffect(() => {
    if (!acceptingPatchId) return;
    const settle = (event: Event) => {
      if ((event as CustomEvent<AuthorLoopResult>).detail?.action === 'revision_accepted')
        setAcceptingPatchId(null);
    };
    // 编辑器那边被别的操作顶掉时不会回报：最多等一分钟就把选项还给作者。
    const timer = setTimeout(() => setAcceptingPatchId(null), 60_000);
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, settle);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, settle);
    };
  }, [acceptingPatchId]);
  const stopConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (stopConfirmTimerRef.current) clearTimeout(stopConfirmTimerRef.current);
    },
    [],
  );
  const waitingForPermission = run.steps.some(
    (step) => step.id === 'permission-required' && step.status === 'waiting',
  );
  // status==='waiting' 且非权限 = run 已产出补丁、等作者确认。此时「停止」会把 run 误标 failed
  // 却不清掉待确认补丁（放弃应走拒绝），故这里只给接受 / 拒绝，不给破坏性停止。
  const awaitingConfirm = run.status === 'waiting' && !waitingForPermission;
  // 暂停态给「恢复」出口（不再是死胡同），并保留「停止」；停止是终态、由轻状态条中性收尾。
  const isPaused = run.status === 'paused';
  // 终态只留轻状态/回复收尾，不再渲染没有动作的空操作条。
  const isTerminal =
    run.status === 'completed' || run.status === 'failed' || run.status === 'stopped';
  if (isTerminal && !run.deliveryUnknown) return null;

  const cancelStopConfirm = () => {
    if (stopConfirmTimerRef.current) {
      clearTimeout(stopConfirmTimerRef.current);
      stopConfirmTimerRef.current = null;
    }
    setStopConfirmArmed(false);
  };

  const handleStopClick = () => {
    if (!stopConfirmArmed) {
      setStopConfirmArmed(true);
      stopConfirmTimerRef.current = setTimeout(cancelStopConfirm, STOP_CONFIRM_TIMEOUT_MS);
      return;
    }
    cancelStopConfirm();
    controls.onStopRun();
  };

  const stopButton = (
    <Button
      size="compact"
      variant="danger"
      className={runActionButtonClass}
      onClick={handleStopClick}
      onBlur={cancelStopConfirm}
      onMouseLeave={cancelStopConfirm}
      title={stopConfirmArmed ? '再次点击确认停止本轮' : '停止本轮'}
      data-testid="run-stop"
      data-armed={stopConfirmArmed ? 'true' : 'false'}
    >
      {stopConfirmArmed ? '确认停止本轮？' : '停止'}
    </Button>
  );

  if (run.deliveryUnknown)
    return (
      <div className="px-3 py-1.5" data-testid="run-action-bar">
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-xs text-warning" data-testid="run-action-status">
            本轮结果未知；连接结束不代表执行失败。请核对原运行，不会自动重放。
          </span>
          <Button
            size="compact"
            variant="ghost"
            onClick={controls.onReconcileRun}
            data-testid="run-reconcile"
          >
            核对状态
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={controls.onPauseRun}
            data-testid="run-pause"
          >
            请求暂停
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={handleStopClick}
            onBlur={cancelStopConfirm}
            data-testid="run-stop"
          >
            {stopConfirmArmed ? '确认停止' : '请求停止'}
          </Button>
        </div>
      </div>
    );

  // 要作者拍板的两种：就地给一组编号选项（不弹居中窗口），一次只问一件；
  // key 跟着这件事走，下一件出来时重新选，不沿用上一件的高亮。
  if (waitingForPermission || awaitingConfirm) {
    const permission = run.steps.find((step) => step.id === 'permission-required');
    const approval = run.steps.find((step) => step.id === 'approval');
    const target = approval?.filePath?.split(/[\\/]/).pop();
    return (
      <div className="px-1.5 py-1.5" data-testid="run-action-bar">
        <div className="flex flex-col gap-1">
          {waitingForPermission ? (
            <DecisionChoices
              key={`${run.id}:permission`}
              title="等待你确认：允许 AI 执行这一步吗？"
              detail={permission?.detail}
              onTypeAhead={onTypeAhead}
              choices={[
                {
                  label: '允许',
                  testid: 'run-approve-permission',
                  onSelect: controls.onApprovePermission,
                },
                {
                  label: '不允许',
                  testid: 'run-deny-permission',
                  onSelect: controls.onDenyPermission,
                },
              ]}
            />
          ) : acceptingPatchId !== null && acceptingPatchId === approval?.patchId ? (
            <div
              role="status"
              className="px-2 py-1 text-xs text-muted"
              data-testid="run-accept-writing"
            >
              {target ? `正在写进文件（${target}）…` : '正在写进文件…'}
            </div>
          ) : (
            <DecisionChoices
              key={`${run.id}:patch:${approval?.patchId ?? ''}`}
              title="AI 修订已生成，要写进文件吗？"
              detail={
                target
                  ? `对比在编辑器里（${target}），看完再选；逐块接受、存成旁注在编辑器底部。`
                  : '对比在编辑器里，看完再选。'
              }
              onTypeAhead={onTypeAhead}
              choices={[
                {
                  label: '接受，写进文件',
                  testid: 'run-accept-patch',
                  onSelect: () => {
                    if (controls.onAcceptPatch?.() === 'accepted')
                      setAcceptingPatchId(approval?.patchId ?? null);
                  },
                },
                {
                  label: '拒绝',
                  testid: 'run-reject-patch',
                  onSelect: () => controls.onRejectPatch?.(''),
                },
                {
                  label: '拒绝，并告诉 AI 怎么改',
                  testid: 'run-reject-explain',
                  needsText: {
                    placeholder: '说说该怎么改，回车发出',
                    submitLabel: '否掉并重来',
                    inputTestid: 'run-reject-input',
                    submitTestid: 'run-reject-confirm',
                  },
                  onSelect: (text) => controls.onRejectPatch?.(text ?? ''),
                },
              ]}
            />
          )}
          {waitingForPermission && <div className="flex justify-end px-2">{stopButton}</div>}
        </div>
      </div>
    );
  }

  if (!isPaused) return null;
  const resume = recovery?.checkpointResume;
  // 暂停是一行字加三颗键：恢复的前提说明放在悬停提示里，不再在条上、卡片上各写一遍。
  return (
    <div className="px-3 py-0.5" data-testid="run-action-bar">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <span
          className="min-w-0 flex-1 text-xs font-medium text-muted"
          role="status"
          title={resume?.message}
          data-testid="run-action-status"
        >
          已暂停
        </span>
        <Button
          size="compact"
          variant="primary"
          className={runActionButtonClass}
          onClick={controls.onResumeRun}
          disabled={resumePending || resume?.canResume === false}
          title={resume?.message ?? '恢复本轮'}
          data-testid="run-resume"
        >
          恢复
        </Button>
        {resume && controls.onReconcileRun && (
          <Button
            size="compact"
            variant="ghost"
            className={runActionButtonClass}
            onClick={controls.onReconcileRun}
            data-testid="run-reconcile"
            title="只读取本轮状态，不重新执行"
          >
            核对状态
          </Button>
        )}
        {stopButton}
      </div>
    </div>
  );
}
