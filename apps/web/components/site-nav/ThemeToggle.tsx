'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'storyforge-theme';
const THEME_EVENT = 'storyforge:theme-change';

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') {
      return value;
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

function detectPreferredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function subscribeTheme(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, detectPreferredTheme, () => 'light');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = detectPreferredTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      aria-label="切换暗色模式"
      className="fixed right-3 top-3 z-30 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/90 px-3 py-1 text-sm font-semibold shadow dark:border-stone-700 dark:bg-stone-900/80"
    >
      <span aria-hidden>{theme === 'dark' ? '🌙' : '☀'}</span>
      <span>{theme === 'dark' ? '暗色' : '亮色'}</span>
    </button>
  );
}
