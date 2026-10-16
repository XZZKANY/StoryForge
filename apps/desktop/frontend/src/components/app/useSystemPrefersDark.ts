import { useEffect, useState } from 'react';

import { systemPrefersDark } from '../../lib/appearance';

/** 「跟随系统」用：Windows 切换深浅色时 WebView2 会派发 prefers-color-scheme 变化。 */
export function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(() => systemPrefersDark());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setDark(!query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return dark;
}
