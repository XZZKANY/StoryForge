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

/** 作废一条事实：引擎算出新台账全文；写由 lib/fact-write 做。 */
export async function retireLedgerFact(ledgerText: string | null, factId: string): Promise<string> {
  return (await import('../engine/facts')).retireEngineFact(ledgerText, factId);
}

/** 处理一条待定事实：引擎算出新台账全文；写由 lib/fact-write 做。 */
export async function resolveLedgerDispute(
  projectRoot: string,
  ledgerText: string | null,
  factId: string,
  choice: 'accept' | 'reject',
): Promise<string> {
  return (await import('../engine/facts')).resolveEngineDispute(
    projectRoot,
    ledgerText,
    factId,
    choice,
  );
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

export type UnrecordedChapter = { path: string; ordinal: number };

/** 一次补录最多几章（与引擎 MAX_BACKFILL_CHAPTERS 一致）：每章一次模型调用。 */
export const BACKFILL_BATCH = 20;

/** 还没记账的章（阅读序，前面的在前）：老章补录的候选。 */
export async function listUnrecordedChapters(projectRoot: string): Promise<UnrecordedChapter[]> {
  const raw = await (await import('../engine/facts')).listEngineUnrecordedChapters(projectRoot);
  return raw.map((item) => {
    if (!isRaw(item)) throw new FactRecordShapeError('没记账的章不是对象');
    return {
      path: field<string>(item, 'path', isString),
      ordinal: field<number>(item, 'ordinal', isCount),
    };
  });
}

export type BackfillChapter = {
  path: string;
  ordinal: number | null;
  status: 'done' | 'failed';
  added: number;
  unverified: number;
  conflicts: ChapterFactConflict[];
  /** 失败的原因；成功为 null。 */
  message: string | null;
};

export type FactBackfillPlan =
  | { status: 'unchanged'; added: number; chapters: BackfillChapter[] }
  | {
      status: 'ready';
      added: number;
      chapters: BackfillChapter[];
      before: string | null;
      after: string;
    };

function decodeBackfillChapter(value: unknown): BackfillChapter {
  if (!isRaw(value)) throw new FactRecordShapeError('补录结果的章不是对象');
  const status = value.status;
  if (status !== 'done' && status !== 'failed')
    throw new FactRecordShapeError(`补录结果的状态不认识：${String(status)}`);
  const done = status === 'done';
  return {
    path: field(value, 'path', isString),
    ordinal: field(value, 'ordinal', isOrdinal),
    status,
    added: done ? field(value, 'added', isCount) : 0,
    unverified: done ? field(value, 'unverified', isCount) : 0,
    conflicts: done ? field<unknown[]>(value, 'conflicts', Array.isArray).map(decodeConflict) : [],
    message: done ? null : field(value, 'message', isString),
  };
}

export function decodeFactBackfillPlan(raw: unknown): FactBackfillPlan {
  if (!isRaw(raw)) throw new FactRecordShapeError('补录结果不是对象');
  const added = field<number>(raw, 'added', isCount);
  const chapters = field<unknown[]>(raw, 'chapters', Array.isArray).map(decodeBackfillChapter);
  if (raw.status === 'unchanged') return { status: 'unchanged', added, chapters };
  if (raw.status !== 'ready')
    throw new FactRecordShapeError(`补录结果的状态不认识：${String(raw.status)}`);
  return {
    status: 'ready',
    added,
    chapters,
    before: field(raw, 'before', (value) => value === null || isString(value)),
    after: field(raw, 'after', isString),
  };
}

/** 补录几章：每章调一次模型；全部抽完才给出新台账全文，写由 lib/fact-write 做。 */
export async function prepareFactBackfill(
  input: { projectRoot: string; ledgerText: string | null; paths: readonly string[] },
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<FactBackfillPlan> {
  const raw = await (
    await import('../engine/facts')
  ).prepareEngineFactBackfill(
    { project_root: input.projectRoot, ledger_text: input.ledgerText, paths: input.paths },
    onProgress,
  );
  return decodeFactBackfillPlan(raw);
}
