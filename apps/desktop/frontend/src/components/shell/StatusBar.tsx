/**
 * 状态栏：26px 全局条。sidecar 连接态（轮询 /health/ready）+ 模型 + 主题 + 面板切换。
 * 观测计数 / 字数 / runchip 为 P4/P3 接线预留位（本刀只搭已有真信号）。
 */
import { useEffect, useState } from 'react';
import { probeApiRuntimeHealth } from '../../lib/api/runtime-health';
import type { ApiRuntimeHealth } from '../../lib/api/types';
import type { ThemeMode } from '../../lib/user-settings';
import { Check, PanelRight } from '../icons/shell-icons';

export function StatusBar({
  modelLabel,
  theme,
  projectOpen,
  obs,
  onToggleObs,
  onToggleTheme,
  onToggleRight,
}: {
  modelLabel: string;
  theme: ThemeMode;
  projectOpen: boolean;
  obs: { error: number; warning: number; advisory: number; total: number };
  onToggleObs: () => void;
  onToggleTheme: () => void;
  onToggleRight: () => void;
}) {
  const [health, setHealth] = useState<ApiRuntimeHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      void probeApiRuntimeHealth()
        .then((result) => {
          if (!cancelled) setHealth(result);
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    };
    probe();
    const timer = setInterval(probe, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const reachable = health?.reachable ?? false;
  const dotClass = reachable ? 'bg-success' : 'bg-warning';
  const connLabel = health
    ? reachable
      ? 'sidecar · 已连接'
      : 'sidecar · 连接中断'
    : 'sidecar · 探测中';

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
          {obs.total > 0 ? (
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
              无观测项
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
      {projectOpen && (
        <button
          className="flex items-center rounded px-1.5 py-px hover:bg-elevated hover:text-foreground"
          onClick={onToggleRight}
          title="切换 Agent 面板"
        >
          <PanelRight size={13} strokeWidth={1.6} />
        </button>
      )}
    </footer>
  );
}
