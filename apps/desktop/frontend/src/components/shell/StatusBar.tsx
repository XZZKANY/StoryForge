/**
 * 状态栏：26px 全局条。sidecar 连接态（轮询 /health/ready）+ 模型 + 主题 + 面板切换。
 * 观测未接线时必须保留 unavailable 状态，不能把无数据表达成零问题。
 */
import { useEffect, useState } from 'react';
import { probeApiRuntimeHealth } from '../../lib/api/runtime-health';
import type { ApiRuntimeHealth } from '../../lib/api/types';
import type { ThemeMode } from '../../lib/user-settings';
import { Check } from '../icons/shell-icons';
import type { ObservationAvailability } from './ObsPanel';

type HealthProbeState =
  | { kind: 'pending' }
  | { kind: 'result'; health: ApiRuntimeHealth }
  | { kind: 'failed' };

export function StatusBar({
  modelLabel,
  theme,
  projectOpen,
  obs,
  observationAvailability = 'unavailable',
  onToggleObs,
  onToggleTheme,
}: {
  modelLabel: string;
  theme: ThemeMode;
  projectOpen: boolean;
  obs: { error: number; warning: number; advisory: number; total: number };
  observationAvailability?: ObservationAvailability;
  onToggleObs: () => void;
  onToggleTheme: () => void;
}) {
  const [healthProbe, setHealthProbe] = useState<HealthProbeState>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      void probeApiRuntimeHealth()
        .then((result) => {
          if (!cancelled) setHealthProbe({ kind: 'result', health: result });
        })
        .catch(() => {
          if (!cancelled) setHealthProbe({ kind: 'failed' });
        });
    };
    probe();
    const timer = setInterval(probe, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const health = healthProbe.kind === 'result' ? healthProbe.health : null;
  const reachable = health?.reachable ?? false;
  const dotClass =
    healthProbe.kind === 'pending' ? 'bg-warning' : reachable ? 'bg-success' : 'bg-error';
  const connLabel =
    healthProbe.kind === 'pending'
      ? 'sidecar · 探测中'
      : reachable
        ? 'sidecar · 已连接'
        : 'sidecar · 连接中断';

  const unavailableObservationLabel =
    observationAvailability === 'loading'
      ? '观测加载中'
      : observationAvailability === 'error'
        ? '观测加载失败'
        : '观测未接线';

  return (
    <footer
      className="flex h-[26px] flex-shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-[11px] text-subtle"
      data-testid="shell-status-bar"
    >
      <span className="flex items-center gap-1.5" data-testid="status-sidecar">
        <span className={`h-[7px] w-[7px] rounded-full ${dotClass}`} />
        <span>{connLabel}</span>
      </span>
      {modelLabel && <span className="font-mono text-[10.5px]">{modelLabel}</span>}
      <span className="flex-1" />
      {projectOpen && (
        <button
          className="flex items-center gap-2 rounded px-1.5 py-px hover:bg-elevated hover:text-foreground"
          onClick={onToggleObs}
          title="观测清单"
          data-testid="status-obs"
        >
          {observationAvailability !== 'available' ? (
            <span className={observationAvailability === 'error' ? 'text-error' : 'text-subtle'}>
              {unavailableObservationLabel}
            </span>
          ) : obs.total > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-error" />
              <span>{obs.error}</span>
              <span className="h-[7px] w-[7px] rounded-full bg-warning" />
              <span>{obs.warning}</span>
              <span className="h-[7px] w-[7px] rounded-full bg-agent" />
              <span>{obs.advisory}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-success">
              <Check size={12} strokeWidth={2} />
              无未处理观测
            </span>
          )}
        </button>
      )}
      <button
        className="rounded px-1.5 py-px hover:bg-elevated hover:text-foreground"
        onClick={onToggleTheme}
        title="切换明暗主题"
      >
        {theme === 'dark' ? '深色' : '浅色'}
      </button>
    </footer>
  );
}
