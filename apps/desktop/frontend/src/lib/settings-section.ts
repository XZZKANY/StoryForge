/** 打开设置前记下要滚到的分组锚点（如 `plugins`）；设置窗挂载时取走一次。 */
let pending: string | null = null;

export function requestSettingsSection(anchor: string): void {
  pending = anchor;
}

export function takeRequestedSettingsSection(): string | null {
  const anchor = pending;
  pending = null;
  return anchor;
}
