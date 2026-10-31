import { readFactLedger } from '../kernel/canonFiles';
import { chapterOrdinals } from '../kernel/canonRebuild';
import {
  parseFactLedger,
  planFactRecord,
  serializeFactLedger,
  type FactCandidate,
} from '../kernel/factLedger';
import { resolveProjectRoot } from '../kernel/fsTools';
import { isJsonObject, type JsonObject, type Obj } from '../kernel/json';
import { MAX_READ_BYTES } from '../kernel/projectTree';
import { pythonStrip } from '../kernel/pythonText';
import { readOptionalProjectText, type ProjectReader } from '../readPort';
import {
  FACT_EXTRACTION_SYSTEM_PROMPT,
  factExtractionPrompt,
  MAX_NEW_FACTS,
  parseFactExtraction,
} from './chapterCheckProtocol';
import { canonicalNames, conflictSummaries } from './factRecord';

/** 一次补录最多几章：每章一次模型调用，书长了不能一点就几百次。 */
export const MAX_BACKFILL_CHAPTERS = 20;

export type FactModel = (prompts: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ content: string }>;

export type FactBackfillDeps = {
  readonly reader: ProjectReader;
  readonly platform: 'windows' | 'posix';
  readonly now: () => Date;
  readonly newHex: () => string;
  readonly callModel: FactModel;
};

/**
 * 还没记账的章（按阅读序，前面的在前）：台账里一条都没有出自它、也没记过「抽过了」、正文不是空的。
 * 用写章功能写的章接受时会自动记；这些多半是手写或更早写的，要作者点了才补。
 */
export async function unrecordedChapters(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<Obj[]> {
  await resolveProjectRoot(reader, root);
  const ledger = await readFactLedger(reader, root);
  const recorded = new Set<unknown>([
    ...(Array.isArray(ledger?.facts) ? ledger.facts : [])
      .filter((fact): fact is JsonObject => isJsonObject(fact))
      .map((fact) => fact.path),
    ...(Array.isArray(ledger?.checked_chapters) ? ledger.checked_chapters : []),
  ]);
  const chapters: Obj[] = [];
  for (const [path, ordinal] of await chapterOrdinals(reader, root, '*.md', platform)) {
    if (recorded.has(path)) continue;
    const content = await readOptionalProjectText(reader, root, path, MAX_READ_BYTES);
    if (content !== null && pythonStrip(content)) chapters.push({ path, ordinal });
  }
  return chapters;
}

/**
 * 补录几章：每章调一次模型抽事实（指令与写章检查同一份），原句逐字核对，按阅读序依次并进台账。
 * 一章失败不连累别章；全部抽完才算出新台账全文，由界面一次写入（一次快照、一次撤销）。
 */
export async function prepareFactBackfill(
  deps: FactBackfillDeps,
  input: { project_root: string; ledger_text: string | null; paths: readonly string[] },
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<Obj> {
  const { reader, platform } = deps;
  const root = input.project_root;
  await resolveProjectRoot(reader, root);
  let ledger = parseFactLedger(input.ledger_text);
  const ordinals = await chapterOrdinals(reader, root, '*.md', platform);
  const ordinal = (path: string) => ordinals.get(path) ?? null;
  const canonical = await canonicalNames(reader, root);
  const now = deps
    .now()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  const paths = [...new Set(input.paths)]
    .filter((path) => ordinals.has(path))
    .sort((a, b) => ordinal(a)! - ordinal(b)!)
    .slice(0, MAX_BACKFILL_CHAPTERS);
  const chapters: Obj[] = [];
  let added = 0;
  let disputed = 0;
  let refreshed = 0;
  let checked = false;
  for (const [index, path] of paths.entries()) {
    onProgress?.(index, paths.length, path);
    const base = { path, ordinal: ordinal(path) };
    const content = await readOptionalProjectText(reader, root, path, MAX_READ_BYTES);
    if (content === null) {
      chapters.push({ ...base, status: 'failed', message: '读不到这章正文。' });
      continue;
    }
    let reply: string;
    try {
      reply = (
        await deps.callModel({
          systemPrompt: FACT_EXTRACTION_SYSTEM_PROMPT,
          userPrompt: factExtractionPrompt(content),
        })
      ).content;
    } catch (error) {
      chapters.push({
        ...base,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const extracted = parseFactExtraction(reply, content);
    if (extracted === null) {
      chapters.push({ ...base, status: 'failed', message: '模型的回复不是有效 JSON。' });
      continue;
    }
    const facts = extracted.new_facts as Obj[];
    const candidates: FactCandidate[] = facts.map((fact) => ({
      kind: fact.kind as string,
      subject: fact.subject as string,
      attribute: fact.attribute as string,
      value: fact.value as string,
      object: (fact.object as string | null) ?? null,
      quote: fact.quote as string,
      startLine: fact.line_start as number,
    }));
    const plan = planFactRecord({
      ledger,
      path,
      candidates,
      ordinal,
      canonical,
      now,
      newId: deps.newHex,
    });
    ledger = plan.ledger;
    added += plan.added.length;
    disputed += plan.disputed.length;
    refreshed += plan.refreshed.length;
    checked ||= plan.newlyChecked;
    const received = extracted.new_facts_received;
    chapters.push({
      ...base,
      status: 'done',
      added: plan.added.length,
      duplicates: plan.duplicates,
      unverified:
        typeof received === 'number' ? Math.min(received, MAX_NEW_FACTS) - facts.length : 0,
      conflicts: conflictSummaries(plan.conflicts, ordinal),
    });
  }
  onProgress?.(paths.length, paths.length, '');
  if (added === 0 && disputed === 0 && refreshed === 0 && !checked)
    return { status: 'unchanged', added, chapters };
  return {
    status: 'ready',
    added,
    chapters,
    before: input.ledger_text,
    after: serializeFactLedger(ledger, platform),
  };
}
