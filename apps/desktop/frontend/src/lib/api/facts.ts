/** 事实台账：作者接受写章补丁后，引擎算出要记进 `.storyforge/canon/facts.json` 的内容。 */

export type ChapterFactConflict = {
  kind: string;
  subject: string;
  attribute: string;
  /** 本章的说法。 */
  value: string;
  quote: string;
  /** 台账里已有的说法，及它出自哪一章。 */
  existingValue: string;
  existingPath: string;
  existingOrdinal: number | null;
};

type FactRecordSummary = {
  chapterPath: string;
  chapterOrdinal: number | null;
  added: number;
  superseded: number;
  duplicates: number;
  unverified: number;
  conflicts: ChapterFactConflict[];
};

export type ChapterFactRecordPlan =
  | { status: 'skipped'; reason: string }
  | ({ status: 'unchanged' } & FactRecordSummary)
  | ({ status: 'ready'; before: string | null; after: string } & FactRecordSummary);

export class FactRecordShapeError extends Error {}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function field<T>(raw: Raw, key: string, ok: (value: unknown) => boolean): T {
  if (!ok(raw[key])) throw new FactRecordShapeError(`记账结果的 ${key} 不对`);
  return raw[key] as T;
}
const isString = (value: unknown) => typeof value === 'string';
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isOrdinal = (value: unknown) => value === null || isCount(value);

function decodeConflict(value: unknown): ChapterFactConflict {
  if (!isRaw(value)) throw new FactRecordShapeError('记账结果的 conflicts 不对');
  return {
    kind: field(value, 'kind', isString),
    subject: field(value, 'subject', isString),
    attribute: field(value, 'attribute', isString),
    value: field(value, 'value', isString),
    quote: field(value, 'quote', isString),
    existingValue: field(value, 'existing_value', isString),
    existingPath: field(value, 'existing_path', isString),
    existingOrdinal: field(value, 'existing_ordinal', isOrdinal),
  };
}

export function decodeChapterFactRecordPlan(raw: unknown): ChapterFactRecordPlan {
  if (!isRaw(raw)) throw new FactRecordShapeError('记账结果不是对象');
  const status = raw.status;
  if (status === 'skipped') return { status, reason: field(raw, 'reason', isString) };
  if (status !== 'unchanged' && status !== 'ready')
    throw new FactRecordShapeError(`记账结果的状态不认识：${String(status)}`);
  const summary: FactRecordSummary = {
    chapterPath: field(raw, 'chapter_path', isString),
    chapterOrdinal: field(raw, 'chapter_ordinal', isOrdinal),
    added: field(raw, 'added', isCount),
    superseded: field(raw, 'superseded', isCount),
    duplicates: field(raw, 'duplicates', isCount),
    unverified: field(raw, 'unverified', isCount),
    conflicts: field<unknown[]>(raw, 'conflicts', Array.isArray).map(decodeConflict),
  };
  if (status === 'unchanged') return { status, ...summary };
  return {
    status,
    ...summary,
    before: field(raw, 'before', (value) => value === null || isString(value)),
    after: field(raw, 'after', isString),
  };
}

export async function prepareChapterFactRecord(input: {
  projectRoot: string;
  filePath: string;
  runId: string;
  /** 刚读到的 facts.json 原文；文件不存在为 null。 */
  ledgerText: string | null;
}): Promise<ChapterFactRecordPlan> {
  const raw = await (
    await import('../engine/facts')
  ).prepareEngineChapterFactRecord({
    project_root: input.projectRoot,
    file_path: input.filePath,
    run_id: input.runId,
    ledger_text: input.ledgerText,
  });
  return decodeChapterFactRecordPlan(raw);
}
