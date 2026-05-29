'use client';

import { useSyncExternalStore } from 'react';

import {
  idePreferencesStorageKey,
  parseIdePreferences,
  preferencesChangedEvent,
} from '../personalization/preferences';
import { IdeShell } from './IdeShell';
import type { IdeStoreState } from './ide-store';

export type IdeShellPreferencesHydratorProps = {
  readonly initialState?: Partial<IdeStoreState>;
  readonly storageSnapshot?: string | null;
};

function subscribePreferences(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('storage', callback);
  window.addEventListener(preferencesChangedEvent, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(preferencesChangedEvent, callback);
  };
}

function readBrowserPreferencesSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(idePreferencesStorageKey);
}

export function IdeShellPreferencesHydrator({
  initialState,
  storageSnapshot,
}: IdeShellPreferencesHydratorProps) {
  const rawPreferences = useSyncExternalStore(
    subscribePreferences,
    readBrowserPreferencesSnapshot,
    () => storageSnapshot ?? null,
  );
  const preferences = parseIdePreferences(rawPreferences);
  const preferencesSource = rawPreferences ? 'storage' : 'default';

  return (
    <section data-ide-preferences-source={preferencesSource}>
      <IdeShell initialState={initialState} initialPreferences={preferences} />
    </section>
  );
}
