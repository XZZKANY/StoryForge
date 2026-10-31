import { useEffect, useLayoutEffect, useRef, type DependencyList } from 'react';

/**
 * effect 体本身同步跑完（与 useEffect 的回调一样，可以返回额外的清理）；里面起的异步活回来时先问
 * `isCurrent()`：false 说明这次 effect 已经卸载、或依赖变了又跑了一次，结果作废、别再写状态。
 * 回调写成同步的，是为了让调用点照 useEffect 吃 exhaustive-deps 的检查（见 eslint.config.mjs）。
 */
export type GuardedEffect = (isCurrent: () => boolean) => void | (() => void);

function guarded(effect: GuardedEffect) {
  return () => {
    let current = true;
    const cleanup = effect(() => current);
    return () => {
      current = false;
      if (typeof cleanup === 'function') cleanup();
    };
  };
}

/** useEffect 加一个「这次 effect 还作不作数」的判断；依赖数组原样交给 useEffect。 */
export function useAsyncEffect(effect: GuardedEffect, deps: DependencyList): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖由调用方原样传入，调用点照 useEffect 检查
  useEffect(guarded(effect), deps);
}

/** 同 useAsyncEffect，跑在布局阶段：要在浏览器绘制前同步做完的 effect 用它。 */
export function useAsyncLayoutEffect(effect: GuardedEffect, deps: DependencyList): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖由调用方原样传入，调用点照 useLayoutEffect 检查
  useLayoutEffect(guarded(effect), deps);
}

/**
 * 组件还挂着没有：布局阶段挂上置 true、卸载时的布局清理置 false。
 * 给 effect 之外的异步活（点击、队列、定时器）用；经参数往下传的就传这一个 ref。
 */
export function useMountedRef(): { readonly current: boolean } {
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
