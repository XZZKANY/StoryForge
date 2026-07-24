/**
 * 状态栏：26px 全局条。sidecar 连接态（轮询 /health/ready）+ 模型 + 主题 + 面板切换。
 * 观测未接线时必须保留 unavailable 状态，不能把无数据表达成零问题。
 */
import { useEffect, useState } from 'react';
import { probeApiRuntimeHealth } from '../../lib/api/runtime-health';
import {
  EDITOR_TEXT_METRICS_EVENT,
  type EditorTextMetricsDetail,
} from '../../lib/assistant-events';
import type { ApiRuntimeHealth } from '../../lib/api/types';
import type { ThemeMode } from '../../lib/user-settings';
import type { EditorFontMode } from '../editor/options';
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
  fontMode,
  obs,
  observationAvailability = 'unavailable',
  onToggleObs,
  onToggleFont,
  onToggleTheme,
}: {
  modelLabel: string;
  theme: ThemeMode;
  projectOpen: boolean;
  fontMode: EditorFontMode;
  obs: { error: number; warning: number; advisory: number; total: number };
  observationAvailability?: ObservationAvailability;
  onToggleObs: () => void;
  onToggleFont: () => void;
  onToggleTheme: () => void;
}) {
  const [healthProbe, setHealthProbe] = useState<HealthProbeState>({ kind: 'pending' });
  const [textMetrics, setTextMetrics] = useState<EditorTextMetricsDetail | null>(null);

  useEffect(() => {
    const onMetrics = (event: Event) => {
      setTextMetrics((event as CustomEvent<EditorTextMetricsDetail>).detail ?? null);
    };
    window.addEventListener(EDITOR_TEXT_METRICS_EVENT, onMetrics);
    return () => window.removeEventListener(EDITOR_TEXT_METRICS_EVENT, onMetrics);
  }, []);

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
      ? '本地服务 · 探测中'
      : reachable
        ? '本地服务 · 已连接'
        : '本地服务 · 连接中断';

  const unavailableObservationLabel =
    observationAvailability === 'loading'
      ? '观测加载中'
      : observationAvailability === 'error'
        ? '观测加载失败'
        : '观测尚未启用';

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
      {projectOpen && textMetrics?.filePath && (
        <span
          className="tabular-nums"
          title="正文字数（不含空白字符）"
          data-testid="status-word-count"
        >
          {textMetrics.selectionCharCount > 0
            ? `已选 ${textMetrics.selectionCharCount.toLocaleString('zh-CN')} / ${textMetrics.charCount.toLocaleString('zh-CN')} 字`
            : `${textMetrics.charCount.toLocaleString('zh-CN')} 字`}
        </span>
      )}
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
      {projectOpen && (
        <button
          className="rounded px-1.5 py-px hover:bg-elevated hover:text-foreground"
          onClick={onToggleFont}
          title="编辑器字体：格子 = CJK 2:1 等宽（中英对齐，需装内置更纱/文楷等宽）；散文 = 比例字体（长文舒适）"
          data-testid="status-font-toggle"
        >
          字体 · {fontMode === 'prose' ? '散文' : '格子'}
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
