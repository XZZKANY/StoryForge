import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ExternalWritebackCoordinator } from '../../lib/external-writeback/coordinator';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from '../../lib/tauri-env';
import { HostCloseNotice } from './HostCloseNotice';
import type { ExternalWaitView } from '../../lib/external-writeback/ports';

const Context = createContext<ExternalWritebackCoordinator | null>(null);
const EMPTY_WAITS: readonly ExternalWaitView[] = [];
const emptySnapshot = () => EMPTY_WAITS;
const emptySubscribe = () => () => {};
export function useExternalWritebackCoordinator() {
  return useContext(Context);
}
export function ExternalWritebackProvider({
  project,
  children,
  coordinator: supplied,
}: {
  project: string | null;
  children: ReactNode;
  coordinator?: ExternalWritebackCoordinator;
}) {
  const [owned] = useState(() => supplied ?? new ExternalWritebackCoordinator());
  const views = useExternalWaits(owned);
  useEffect(() => {
    const running = views.filter((view) => view.phase === 'running');
    if (!running.length) return;
    const timer = window.setInterval(() => {
      running.forEach((view) => {
        void owned.refresh(view.key);
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [owned, views]); // App-owned, read-only observation survives hiding/switching the chat.
  useLayoutEffect(() => {
    owned.setProject(project);
  }, [owned, project]);
  useEffect(() => {
    if (project)
      void owned.discover(project).catch(() => {
        /* Read failure grants no authority. */
      });
  }, [owned, project]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('storyforge:host-closing', () => {
      owned.beginClose();
      void invoke('acknowledge_host_closing').catch(() => {
        /* Native deadline remains independent. */
      });
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [owned]);
  return (
    <Context.Provider value={owned}>
      <HostCloseNotice />
      {children}
    </Context.Provider>
  );
}
export function useExternalWaits(coordinator: ExternalWritebackCoordinator | null) {
  return useSyncExternalStore(
    coordinator?.subscribe ?? emptySubscribe,
    coordinator?.getSnapshot ?? emptySnapshot,
    coordinator?.getSnapshot ?? emptySnapshot,
  );
}
