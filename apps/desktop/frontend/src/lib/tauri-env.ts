/**
 * Runtime guards for APIs that only exist inside the Tauri webview.
 */

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
  isTauri?: boolean;
};

export function isTauriRuntime(): boolean {
  const globalScope = globalThis as unknown as TauriWindow;
  return (
    typeof window !== 'undefined' &&
    (globalScope.isTauri === true ||
      typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined')
  );
}

export function assertTauriRuntime(apiName: string): void {
  if (!isTauriRuntime()) {
    throw new Error(`${apiName} is only available inside the Tauri desktop runtime.`);
  }
}
