/**
 * Runtime guards for APIs that only exist inside the Tauri webview.
 */

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined'
  );
}

export function assertTauriRuntime(apiName: string): void {
  if (!isTauriRuntime()) {
    throw new Error(`${apiName} is only available inside the Tauri desktop runtime.`);
  }
}
