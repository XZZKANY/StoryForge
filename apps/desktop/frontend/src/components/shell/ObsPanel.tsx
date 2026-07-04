/**
 * 观测面板：Problems 式底部面板，从状态栏点开、中栏底部升起（不遮右栏对话）。
 * 机械观测（error/warning）与语义 advisory（agent 紫）行式清单，行可勾掉。
 *
 * 说明：advisory / 深度一致性信号产生在 agent run 内部，尚未上提到 App 级 store，
 * 故当前 observations 传入为空（诚实空态，不伪造数据）；真实信号接线待 E2E-1 后随
 * ChatWindow → App 的观测 store 补齐。永不阻塞导出的语义在 [[project_desktop_shell_redesign]] 已定。
 */
import { Check, X } from '../icons/shell-icons';

export type ObsSeverity = 'error' | 'warning' | 'advisory';

export type Observation = {
  id: string;
  severity: ObsSeverity;
  title: string;
  detail?: string;
  location?: string;
  source?: string;
  resolved?: boolean;
};

const SEVERITY_DOT: Record<ObsSeverity, string> = {
  error: 'bg-error',
  warning: 'bg-warning',
  advisory: 'bg-agent',
};

export function obsCounts(observations: Observation[]) {
  const unresolved = observations.filter((o) => !o.resolved);
  return {
    error: unresolved.filter((o) => o.severity === 'error').length,
    warning: unresolved.filter((o) => o.severity === 'warning').length,
    advisory: unresolved.filter((o) => o.severity === 'advisory').length,
    total: unresolved.length,
  };
}

export function ObsPanel({
  observations,
  onClose,
  onResolve,
}: {
  observations: Observation[];
  onClose: () => void;
  onResolve: (id: string) => void;
}) {
  const counts = obsCounts(observations);

  return (
    <div
      className="flex h-[212px] flex-shrink-0 flex-col border-t border-border bg-panel"
      data-testid="obs-panel"
    >
      <div className="flex h-[30px] flex-shrink-0 items-center gap-3 border-b border-border px-3 text-[11px] text-subtle">
        <span className="font-semibold tracking-[0.06em]">观测</span>
        <span>改完一条勾一条 · 点击行定位原文</span>
        <span className="flex-1" />
        <span className="font-mono">{counts.total ? `${counts.total} 未处理` : '全部处理完'}</span>
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-elevated hover:text-foreground"
          onClick={onClose}
          title="关闭观测面板"
        >
          <X size={13} strokeWidth={1.7} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {observations.length === 0 ? (
          <p className="px-4 py-4 text-[11px] leading-relaxed text-subtle">
            暂无观测项。机械观测（引用 / 人名 / 时间线）本地零 token 常驻扫描；语义 advisory
            按需触发、消耗 BYO-key，不阻塞导出。观测信号随对话中的一致性工具产出后在此逐条处理。
          </p>
        ) : (
          observations.map((obs) => (
            <div
              key={obs.id}
              data-testid="obs-row"
              data-severity={obs.severity}
              className={`group flex w-full items-start gap-2.5 border-b border-border px-3.5 py-2 ${
                obs.resolved ? 'opacity-40' : ''
              }`}
            >
              <span
                className={`mt-[5px] h-[7px] w-[7px] flex-shrink-0 rounded-full ${SEVERITY_DOT[obs.severity]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-[12px]">
                  <span className={obs.resolved ? 'line-through' : ''}>{obs.title}</span>
                  {obs.location && (
                    <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-subtle">
                      {obs.location}
                    </span>
                  )}
                </span>
                {obs.detail && (
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                    {obs.detail}
                  </span>
                )}
                {obs.source && (
                  <span className="mt-0.5 block font-mono text-[10px] text-subtle">
                    {obs.source}
                  </span>
                )}
              </span>
              <button
                className={`mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[11px] transition-opacity ${
                  obs.resolved
                    ? 'border-success/40 bg-success/15 text-success opacity-100'
                    : 'border-border text-subtle opacity-0 hover:border-success/50 hover:bg-success/15 hover:text-success group-hover:opacity-100'
                }`}
                title="标记已处理"
                onClick={() => onResolve(obs.id)}
              >
                <Check size={12} strokeWidth={2} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
