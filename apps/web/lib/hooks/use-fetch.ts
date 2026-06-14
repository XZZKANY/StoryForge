'use client';

import { useEffect, useState } from 'react';

type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

interface UsePollingOptions {
  interval?: number;
  enabled?: boolean;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  { interval = 3000, enabled = true }: UsePollingOptions = {}
): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({ status: 'idle' });

  const fetchData = async () => {
    try {
      setState((prev) => (prev.status === 'idle' ? { status: 'loading' } : prev));
      const data = await fetcher();
      setState({ status: 'success', data });
    } catch (error) {
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : '未知错误',
      });
    }
  };

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    const runFetch = async () => {
      if (mounted) await fetchData();
    };

    runFetch();
    const intervalId = setInterval(() => {
      if (mounted) runFetch();
    }, interval);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval]);

  return { ...state, refetch: fetchData };
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        setState({ status: 'loading' });
        const data = await fetcher();
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : '未知错误',
          });
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, deps);

  return state;
}
