/**
 * 状态栏：26px 全局条。sidecar 连接态（轮询 /health/ready）+ 模型 + 字数 + 观测。
 * 观测未接线时必须保留 unavailable 状态，不能把无数据表达成零问题。
 * 字体 / 主题切换已移入设置（外观 / 编辑器），状态栏不再放这两个开关（#14）。
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { probeApiRuntimeHealth } from '../../lib/api/runtime-health';
import { projectBasename } from '../../lib/project-context';
import { ManuscriptCard } from './ManuscriptCard';
import {
  EDITOR_TEXT_METRICS_EVENT,
  type EditorTextMetricsDetail,
} from '../../lib/assistant-events';
import type { ApiRuntimeHealth } from '../../lib/api/types';
import { Check } from '../icons/shell-icons';
import type { ObservationAvailability } from './ObsPanel';

type HealthProbeState =
  | { kind: 'pending' }
  | { kind: 'result'; health: ApiRuntimeHealth }
  | { kind: 'failed' };

export function StatusBar({
  modelLabel,
  projectOpen,
  projectPath = null,
  dailyWordGoal = 0,
  obs,
  observationAvailability = 'unavailable',
  onToggleObs,
  obsTriggerRef,
  observationOpen = false,
}: {
  modelLabel: string;
  projectOpen: boolean;
  projectPath?: string | null;
  dailyWordGoal?: number;
  obs: { error: number; warning: number; advisory: number; total: number };
  observationAvailability?: ObservationAvailability;
  onToggleObs: () => void;
  obsTriggerRef?: RefObject<HTMLButtonElement>;
  observationOpen?: boolean;
}) {
  const [healthProbe, setHealthProbe] = useState<HealthProbeState>({ kind: 'pending' });
  const [textMetrics, setTextMetrics] = useState<EditorTextMetricsDetail | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const wordCountRef = useRef<HTMLButtonElement>(null);

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
  const observationButtonLabel =
    observationAvailability !== 'available'
      ? `打开观测清单：${unavailableObservationLabel}`
      : obs.total > 0
        ? `打开观测清单：${obs.total} 项未处理`
        : '打开观测清单：无未处理观测';

  return (
    <footer
      className="relative flex h-[26px] flex-shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-2xs text-subtle max-[480px]:gap-2 max-[480px]:px-2"
      style={{ boxShadow: '0 -1px 3px rgb(0 0 0 / 0.05)' }}
      data-testid="shell-status-bar"
    >
      <span
        className="flex min-w-0 flex-shrink items-center gap-1.5 whitespace-nowrap"
        data-testid="status-sidecar"
        role="status"
        aria-live="polite"
      >
        <span
          className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{connLabel}</span>
      </span>
      {modelLabel && (
        <span className="min-w-0 max-w-[30vw] truncate font-mono text-3xs" title={modelLabel}>
          {modelLabel}
        </span>
      )}
      <span className="flex-1" />
      {projectOpen && textMetrics?.filePath && (
        <button
          ref={wordCountRef}
          type="button"
          className="min-w-0 max-w-[42vw] flex-shrink truncate whitespace-nowrap rounded-sm px-1.5 py-px tabular-nums hover:bg-elevated hover:text-foreground"
          title="正文字数（不含空白字符）· 点击查看稿件进度"
          aria-haspopup="dialog"
          aria-expanded={cardOpen}
          aria-controls={cardOpen ? 'manuscript-card' : undefined}
          onClick={() => setCardOpen((open) => !open)}
          data-testid="status-word-count"
        >
          {textMetrics.selectionCharCount > 0
            ? `已选 ${textMetrics.selectionCharCount.toLocaleString('zh-CN')} / ${textMetrics.charCount.toLocaleString('zh-CN')} 字`
            : `${textMetrics.charCount.toLocaleString('zh-CN')} 字`}
        </button>
      )}
      {cardOpen && textMetrics?.filePath && (
        <ManuscriptCard
          projectPath={projectPath}
          chapterLabel={projectBasename(textMetrics.filePath)}
          chapterChars={textMetrics.charCount}
          chapterParagraphs={textMetrics.paragraphCount}
          selectionChars={textMetrics.selectionCharCount}
          dailyGoal={dailyWordGoal}
          onClose={() => setCardOpen(false)}
          triggerRef={wordCountRef}
        />
      )}
      {projectOpen && (
        <button
          type="button"
          ref={obsTriggerRef}
          className="flex min-w-0 max-w-[42vw] flex-shrink items-center gap-2 overflow-hidden rounded-sm px-1.5 py-px whitespace-nowrap hover:bg-elevated hover:text-foreground"
          onClick={onToggleObs}
          title="观测清单"
          aria-label={observationButtonLabel}
          aria-expanded={observationOpen}
          aria-controls={observationOpen ? 'obs-panel' : undefined}
          data-testid="status-obs"
        >
          {observationAvailability !== 'available' ? (
            <span
              className={`min-w-0 truncate ${observationAvailability === 'error' ? 'text-error' : 'text-subtle'}`}
            >
              {unavailableObservationLabel}
            </span>
          ) : obs.total > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-error" aria-hidden="true" />
              <span>{obs.error}</span>
              <span className="h-[7px] w-[7px] rounded-full bg-warning" aria-hidden="true" />
              <span>{obs.warning}</span>
              <span className="h-[7px] w-[7px] rounded-full bg-agent" aria-hidden="true" />
              <span>{obs.advisory}</span>
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1 truncate text-success">
              <Check size={12} strokeWidth={2} />
              无未处理观测
            </span>
          )}
        </button>
      )}
    </footer>
  );
}
