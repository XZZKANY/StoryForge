import { act, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import {
  useAsyncEffect,
  useAsyncLayoutEffect,
  useMountedRef,
  usePassiveMountedRef,
} from '../src/lib/async-guards';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function mount(node: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    text: () => container.textContent,
    rerender: (next: ReactNode) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function settle<T>(request: Deferred<T>, value: T) {
  await act(async () => {
    request.resolve(value);
    await request.promise;
  });
}

it('卸载之后回来的结果不再写状态', async () => {
  const request = deferred<string>();
  const written: string[] = [];
  let isCurrentOfRun: (() => boolean) | null = null;
  function Probe() {
    const [value, setValue] = useState('读取中');
    useAsyncEffect((isCurrent) => {
      isCurrentOfRun = isCurrent;
      void request.promise.then((next) => {
        if (!isCurrent()) return;
        written.push(next);
        setValue(next);
      });
    }, []);
    return <span>{value}</span>;
  }

  const view = mount(<Probe />);
  expect(view.text()).toBe('读取中');
  expect(isCurrentOfRun!()).toBe(true);
  view.unmount();
  expect(isCurrentOfRun!()).toBe(false);
  await settle(request, '迟到的结果');
  expect(written).toEqual([]);
});

it('依赖变了：旧一轮的结果作废，新一轮照写；依赖没变不重跑', async () => {
  const requests = new Map<string, Deferred<string>>();
  let runs = 0;
  function Probe({ id }: { id: string }) {
    const [value, setValue] = useState('');
    useAsyncEffect(
      (isCurrent) => {
        runs += 1;
        const request = deferred<string>();
        requests.set(id, request);
        void request.promise.then((next) => {
          if (isCurrent()) setValue(next);
        });
      },
      [id],
    );
    return <span>{value}</span>;
  }

  const view = mount(<Probe id="甲" />);
  view.rerender(<Probe id="甲" />);
  expect(runs).toBe(1);
  view.rerender(<Probe id="乙" />);
  expect(runs).toBe(2);
  await settle(requests.get('乙')!, '乙的结果');
  await settle(requests.get('甲')!, '甲的结果');
  expect(view.text()).toBe('乙的结果');
  view.unmount();
});

it('回调返回的额外清理在依赖变化与卸载时都被调用，调用时这一轮已经作废', () => {
  const log: string[] = [];
  function Probe({ id }: { id: string }) {
    useAsyncEffect(
      (isCurrent) => {
        log.push(`跑 ${id}`);
        return () => log.push(`清理 ${id} 作数=${isCurrent()}`);
      },
      [id],
    );
    return null;
  }

  const view = mount(<Probe id="甲" />);
  view.rerender(<Probe id="乙" />);
  view.unmount();
  expect(log).toEqual(['跑 甲', '清理 甲 作数=false', '跑 乙', '清理 乙 作数=false']);
});

it('useAsyncLayoutEffect 跑在布局阶段：先于同一组件里先声明的 useEffect', () => {
  const log: string[] = [];
  function Probe() {
    useEffect(() => {
      log.push('被动阶段');
    }, []);
    useAsyncLayoutEffect((isCurrent) => {
      log.push(`布局阶段 作数=${isCurrent()}`);
    }, []);
    return null;
  }

  const view = mount(<Probe />);
  view.unmount();
  expect(log).toEqual(['布局阶段 作数=true', '被动阶段']);
});

it('useMountedRef：渲染时为 false，布局阶段起为 true，卸载后为 false，ref 对象不变', () => {
  const seen: string[] = [];
  const refs = new Set<{ readonly current: boolean }>();
  function Probe({ round }: { round: number }) {
    const mountedRef = useMountedRef();
    refs.add(mountedRef);
    if (round === 0) seen.push(`渲染 ${mountedRef.current}`);
    useLayoutEffect(() => {
      seen.push(`布局 ${mountedRef.current}`);
    }, [mountedRef]);
    return null;
  }

  const view = mount(<Probe round={0} />);
  view.rerender(<Probe round={1} />);
  expect(refs.size).toBe(1);
  const [mountedRef] = refs;
  expect(mountedRef.current).toBe(true);
  view.unmount();
  expect(mountedRef.current).toBe(false);
  expect(seen).toEqual(['渲染 false', '布局 true']);
});

it('usePassiveMountedRef：渲染时就是 true，卸载时布局清理里还是 true，到被动清理才是 false', () => {
  const seen: string[] = [];
  const refs = new Set<{ readonly current: boolean }>();
  function Probe({ round }: { round: number }) {
    const mountedRef = usePassiveMountedRef();
    refs.add(mountedRef);
    if (round === 0) seen.push(`渲染 ${mountedRef.current}`);
    useLayoutEffect(
      () => () => {
        seen.push(`布局清理 ${mountedRef.current}`);
      },
      [mountedRef],
    );
    useEffect(
      () => () => {
        seen.push(`被动清理 ${mountedRef.current}`);
      },
      [mountedRef],
    );
    return null;
  }

  const view = mount(<Probe round={0} />);
  view.rerender(<Probe round={1} />);
  expect(refs.size).toBe(1);
  const [mountedRef] = refs;
  expect(mountedRef.current).toBe(true);
  view.unmount();
  expect(mountedRef.current).toBe(false);
  expect(seen).toEqual(['渲染 true', '布局清理 true', '被动清理 false']);
});
