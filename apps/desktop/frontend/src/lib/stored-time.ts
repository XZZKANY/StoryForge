/**
 * 引擎库里的时间是 UTC、不带时区（「2026-10-17 05:16:21」或「2026-10-17T05:16:21」，沿用 SQLite
 * CURRENT_TIMESTAMP 的口径）。`new Date()` 会把不带时区的串当本地时间解析，北京时间下就慢 8 小时。
 */
export function parseStoredTime(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 本地时间的「MM-dd HH:mm」；解析不了就原样返回。 */
export function formatStoredTimeShort(value: string): string {
  const date = parseStoredTime(value);
  if (!date) return value;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 本地时间的「yyyy-MM-dd HH:mm:ss」；解析不了就原样返回。 */
export function formatStoredTimeFull(value: string): string {
  const date = parseStoredTime(value);
  if (!date) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
