import { ProjectReadError, type ProjectReader } from '../readPort';
import { readFactLedger } from './canonFiles';
import { chapterOrdinals } from './canonRebuild';
import { FsToolError } from './fsTools';
import { InputDomainError, isJsonObject, type JsonObject, type JsonValue } from './json';
import { MAX_READ_BYTES } from './projectTree';
import { locateQuote } from './quoteLocation';

const objects = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : [];
const text = (value: JsonValue | undefined) => (typeof value === 'string' ? value : '');

async function readText(
  reader: ProjectReader,
  root: string,
  path: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(path)) return cache.get(path)!;
  let value: string | null = null;
  try {
    const read = await reader.readProjectBytes(root, path, MAX_READ_BYTES);
    if (!read.exceeded) value = new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.bytes);
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
  }
  cache.set(path, value);
  return value;
}

/**
 * 观测镜「事实台账」分区（确定性，不调模型）：按章列出仍有效的事实，最近的章在前；
 * 原句在原章里已经找不到的标「依据已失效」——起草不再带它们。没有台账返回 null；
 * 台账格式不对时如实返回错误，让作者知道要去修。
 */
export async function buildFactLedgerView(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<JsonObject | null> {
  let ledger: JsonObject | null;
  try {
    ledger = await readFactLedger(reader, root);
  } catch (error) {
    if (error instanceof InputDomainError || error instanceof FsToolError)
      return { error: error.message };
    throw error;
  }
  if (ledger === null) return null;
  const ordinals = await chapterOrdinals(reader, root, '*.md', platform);
  const cache = new Map<string, string | null>();
  const byChapter = new Map<string, JsonObject[]>();
  let superseded = 0;
  let retired = 0;
  let stale = 0;
  const all = objects(ledger.facts);
  const disputed: JsonObject[] = [];
  for (const fact of all) {
    const status = fact.status ?? 'active';
    if (status === 'superseded') superseded += 1;
    if (status === 'retired') retired += 1;
    if (status === 'disputed') {
      disputed.push(await disputeEntry(fact, all, ordinals));
      continue;
    }
    if (status !== 'active') continue;
    const path = text(fact.path);
    const evidence = objects(fact.evidence)[0] ?? {};
    const quote = text(evidence.quote);
    const recordedLine = typeof evidence.start_line === 'number' ? evidence.start_line : null;
    const chapter = await readText(reader, root, path, cache);
    const location = chapter === null || !quote ? null : locateQuote(chapter, quote, recordedLine);
    if (location === null) stale += 1;
    const entry: JsonObject = {
      id: fact.id ?? null,
      kind: text(fact.kind),
      subject: text(fact.subject),
      attribute: text(fact.attribute),
      value: text(fact.value),
      object: typeof fact.object === 'string' ? fact.object : null,
      quote,
      line: location?.line_start ?? recordedLine,
      valid: location !== null,
      recorded_by: typeof fact.recorded_by === 'string' ? fact.recorded_by : null,
    };
    byChapter.set(path, [...(byChapter.get(path) ?? []), entry]);
  }
  const chapters = [...byChapter]
    .map(([path, facts]) => ({ path, ordinal: ordinals.get(path) ?? null, facts }))
    .sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0));
  return {
    active: chapters.reduce((sum, chapter) => sum + chapter.facts.length, 0),
    stale,
    superseded,
    retired,
    chapters,
    disputed,
  };
}

/** 一条待定事实：本章的说法和它对上的已记说法并排给作者看。 */
async function disputeEntry(
  fact: JsonObject,
  all: readonly JsonObject[],
  ordinals: ReadonlyMap<string, number>,
): Promise<JsonObject> {
  const path = text(fact.path);
  const evidence = objects(fact.evidence)[0] ?? {};
  const existing = all.find((other) => other.id === fact.disputes);
  const existingEvidence = existing ? (objects(existing.evidence)[0] ?? {}) : {};
  return {
    id: fact.id ?? null,
    kind: text(fact.kind),
    subject: text(fact.subject),
    attribute: text(fact.attribute),
    value: text(fact.value),
    quote: text(evidence.quote),
    line: typeof evidence.start_line === 'number' ? evidence.start_line : null,
    path,
    ordinal: ordinals.get(path) ?? null,
    existing: existing
      ? {
          value: text(existing.value),
          path: text(existing.path),
          ordinal: ordinals.get(text(existing.path)) ?? null,
          quote: text(existingEvidence.quote),
        }
      : null,
  };
}
