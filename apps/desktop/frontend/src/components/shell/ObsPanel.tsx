/**
 * 观测面板：Problems 式底部面板，从状态栏点开、中栏底部升起（不遮右栏对话）。
 * 机械观测（error/warning）与语义 advisory（agent 紫）行式清单，行可勾掉。
 *
 * advisory / 深度一致性信号尚未上提到 App 级 store，因此默认明确显示 unavailable。
 * 只有调用方确认数据已经加载后，才可传入 available 并展示真实空态或观测列表。
 */
import { Check, X } from '../icons/shell-icons';

export type ObsSeverity = 'error' | 'warning' | 'advisory';
export type ObservationAvailability = 'unavailable' | 'loading' | 'available' | 'error';

/** 结构化定位锚：line 为 1-based 行号；prose 类信号无行号只有 snippet（可能是命中词拼接）。 */
export type ObservationAnchor = {
  path: string;
  line?: number;
  snippet?: string;
};

export type Observation = {
  id: string;
  severity: ObsSeverity;
  title: string;
  detail?: string;
  location?: string;
  source?: string;
  anchor?: ObservationAnchor;
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
  availability = 'unavailable',
  onClose,
  onResolve,
  onLocate,
}: {
  observations: Observation[];
  availability?: ObservationAvailability;
  onClose: () => void;
  onResolve: (id: string) => void;
  onLocate?: (observation: Observation) => void;
}) {
  const counts = obsCounts(observations);
  const statusLabel =
    availability === 'unavailable'
      ? '观测未接线'
      : availability === 'loading'
        ? '观测加载中'
        : availability === 'error'
          ? '观测加载失败'
          : counts.total
            ? `${counts.total} 未处理`
            : '全部处理完';

  return (
    <div
      className="flex h-[212px] flex-shrink-0 flex-col border-t border-border bg-panel"
      data-testid="obs-panel"
    >
      <div className="flex h-[30px] flex-shrink-0 items-center gap-3 border-b border-border px-3 text-[11px] text-subtle">
        <span className="font-semibold tracking-[0.06em]">观测</span>
        <span>改完一条勾一条 · 点击行定位原文</span>
        <span className="flex-1" />
        <span className="font-mono">{statusLabel}</span>
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-elevated hover:text-foreground"
          onClick={onClose}
          title="关闭观测面板"
        >
          <X size={13} strokeWidth={1.7} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {availability !== 'available' ? (
          <p className="px-4 py-4 text-[11px] leading-relaxed text-subtle">
            {availability === 'loading'
              ? '正在加载观测数据。'
              : availability === 'error'
                ? '观测数据加载失败，请稍后重试。'
                : '观测尚未接线，当前没有可用于判断项目状态的数据。'}
          </p>
        ) : observations.length === 0 ? (
          <p className="px-4 py-4 text-[11px] leading-relaxed text-subtle">暂无观测项。</p>
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
              <span
                className={`min-w-0 flex-1 ${obs.anchor && onLocate ? 'cursor-pointer' : ''}`}
                data-testid="obs-row-body"
                onClick={obs.anchor && onLocate ? () => onLocate(obs) : undefined}
              >
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
