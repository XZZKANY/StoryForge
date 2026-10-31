import { MAX_CONTEXT_FILES } from '@storyforge/project-core';
import { pythonStrRepr } from '../llm/pythonRepr';
import { InputDomainError, pythonFloatRepr } from './json';
import { pythonStrip } from './pythonText';
import type { PlainJson } from './redaction';

export const SNAPSHOT_VERSION = 1;
export const SELECTED_FILE_TEXT_LIMIT = 12000;
export const MEMORY_TEXT_LIMIT = 800;
export const REVIEW_TEXT_LIMIT = 600;
export { MAX_CONTEXT_FILES };
export const MAX_REVIEW_ISSUES = 12;
export const MAX_STORY_MEMORY_ITEMS = 8;
export const MAX_PROMPT_CONTEXT_FILES = 12;
export const CHAPTER_TEXT_LIMIT = 1200;

export const CHAPTER_CONTEXT_KEYS = [
  'book_id',
  'chapter_id',
  'chapter',
  'chapter_number',
  'ordinal',
  'chapter_title',
  'title',
  'scene_id',
  'scene_title',
  'summary',
  'previous_summary',
  'next_summary',
  'goal',
  'pov',
  'setting',
  'beat',
  'beats',
  'outline',
  'chapter_outline',
  'current_scene',
] as const;

export type Obj = { [key: string]: PlainJson };

export const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const hasKey = (source: Obj, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);
/** Python 的 `d.get(key)`：不碰原型链。 */
export const get = (source: Obj, key: string): PlainJson | undefined =>
  hasKey(source, key) ? source[key] : undefined;
/** Python 的 `d.get(key, fallback)`：键在就返回原值（哪怕是 null）。 */
export const getOr = (source: Obj, key: string, fallback: PlainJson): PlainJson =>
  hasKey(source, key) ? source[key] : fallback;

/** context_values.first_string：首个非空白字符串字段（去首尾空白）。 */
export function firstString(source: Obj, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = get(source, key);
    if (typeof value === 'string' && pythonStrip(value)) return pythonStrip(value);
  }
  return null;
}

function pythonRepr(value: PlainJson): string {
  return typeof value === 'string' ? pythonStrRepr(value) : pythonStrValue(value);
}

/** Python str()。整数值的 number 视为 int：应用写不出 `1.0` 这类整数值小数（§4.3.1）。 */
export function pythonStrValue(value: PlainJson | undefined): string {
  if (value === undefined || value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number')
    return Number.isSafeInteger(value) ? String(value) : pythonFloatRepr(value);
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(', ')}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${pythonStrRepr(key)}: ${pythonRepr(item)}`)
    .join(', ')}}`;
}

/** Python int()：只收数与布尔；快照里的计数来自应用自己。 */
export function pythonInt(value: PlainJson | undefined): number {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'number') return Math.trunc(value);
  throw new InputDomainError(`计数不是数字：${pythonStrValue(value)}`);
}

export function artifactKind(artifact: PlainJson): string | null {
  const value = isObj(artifact) ? get(artifact, 'kind') : undefined;
  return typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
}

export function artifactPayload(artifact: PlainJson): Obj | null {
  const value = isObj(artifact) ? get(artifact, 'payload') : undefined;
  return isObj(value) ? value : null;
}

export function storyMemoryCount(storyMemory: PlainJson | undefined): number {
  if (!isObj(storyMemory)) return 0;
  const items = get(storyMemory, 'items');
  return Array.isArray(items) ? items.length : 0;
}
