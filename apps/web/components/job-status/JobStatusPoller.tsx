'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  describeJobStatus,
  isTerminalJobStatus,
  parseJobRunSnapshot,
  type JobRunSnapshot,
} from './job-status-core';

export type JobStatusPollerProps = {
  readonly jobRunId: number;
  readonly endpoint?: string;
  readonly intervalMs?: number;
  readonly initialSnapshot?: JobRunSnapshot | null;
};

type PollState =
  | { readonly status: 'idle' }
  | { readonly status: 'polling'; readonly snapshot: JobRunSnapshot | null }
  | { readonly status: 'terminal'; readonly snapshot: JobRunSnapshot }
  | { readonly status: 'error'; readonly message: string };

const defaultEndpoint = '/api/model-runs/job-runs';

export function JobStatusPoller({
  jobRunId,
  endpoint = defaultEndpoint,
  intervalMs = 3000,
  initialSnapshot = null,
}: JobStatusPollerProps) {
  const [state, setState] = useState<PollState>(() => {
    if (initialSnapshot && isTerminalJobStatus(initialSnapshot.status)) {
      return { status: 'terminal', snapshot: initialSnapshot };
    }
    return { status: 'polling', snapshot: initialSnapshot };
  });
  const [retryAttempt, setRetryAttempt] = useState(0);
  const cancelledRef = useRef(false);

  const fetchSnapshot = useCallback(async (): Promise<JobRunSnapshot | null> => {
    const response = await fetch(`${endpoint}/${jobRunId}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`API 返回 ${response.status}`);
    }
    const payload: unknown = await response.json();
    return parseJobRunSnapshot(payload, jobRunId);
  }, [endpoint, jobRunId]);

  useEffect(() => {
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const snapshot = await fetchSnapshot();
        if (cancelledRef.current) return;
        if (!snapshot) {
          setState({ status: 'error', message: '任务快照解析失败' });
          return;
        }
        if (isTerminalJobStatus(snapshot.status)) {
          setState({ status: 'terminal', snapshot });
          return;
        }
        setState({ status: 'polling', snapshot });
        timer = setTimeout(tick, intervalMs);
      } catch (error) {
        if (cancelledRef.current) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '未知错误',
        });
      }
    };

    if (state.status !== 'terminal') {
      void tick();
    }

    return () => {
      cancelledRef.current = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSnapshot, intervalMs, retryAttempt]);

  const handleRetry = useCallback(() => {
    setState({ status: 'polling', snapshot: null });
    setRetryAttempt((attempt) => attempt + 1);
  }, []);

  return (
    <section
      aria-labelledby="job-status-poller-title"
      data-testid="job-status-poller"
      className="rounded-2xl border border-stone-200 bg-white/80 p-4 dark:border-stone-700 dark:bg-stone-900/60"
    >
      <h3 id="job-status-poller-title" className="text-lg font-semibold">
        任务 #{jobRunId} 实时状态
      </h3>
      {state.status === 'polling' ? (
        <PollingView snapshot={state.snapshot} />
      ) : state.status === 'terminal' ? (
        <TerminalView snapshot={state.snapshot} />
      ) : state.status === 'error' ? (
        <ErrorView message={state.message} onRetry={handleRetry} />
      ) : (
        <p>正在准备轮询…</p>
      )}
    </section>
  );
}

function PollingView({ snapshot }: { readonly snapshot: JobRunSnapshot | null }) {
  return (
    <dl>
      <dt>状态</dt>
      <dd data-testid="job-status-current">
        {snapshot ? describeJobStatus(snapshot.status) : '正在请求初始状态…'}
      </dd>
      <dt>当前节点</dt>
      <dd>{snapshot?.current_node ?? '暂无节点信息'}</dd>
      <dt>进度</dt>
      <dd>
        {snapshot?.progress !== null && snapshot?.progress !== undefined
          ? `${Math.round(snapshot.progress * 100)}%`
          : '暂无进度数据'}
      </dd>
    </dl>
  );
}

function TerminalView({ snapshot }: { readonly snapshot: JobRunSnapshot }) {
  return (
    <dl>
      <dt>最终状态</dt>
      <dd data-testid="job-status-current">{describeJobStatus(snapshot.status)}</dd>
      {snapshot.error_summary ? (
        <>
          <dt>错误摘要</dt>
          <dd>{snapshot.error_summary}</dd>
        </>
      ) : null}
    </dl>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div>
      <p role="status">轮询失败：{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
      >
        重试
      </button>
    </div>
  );
}
