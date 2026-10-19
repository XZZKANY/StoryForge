import { readCanon } from '../kernel/canonFiles';
import { chapterOrdinals, entitySurfaceForms } from '../kernel/canonRebuild';
import {
  FACT_KINDS,
  parseFactLedger,
  planFactRecord,
  serializeFactLedger,
  type FactCandidate,
  type FactConflict,
} from '../kernel/factLedger';
import { FsToolError, resolveProjectRoot } from '../kernel/fsTools';
import { InputDomainError, isJsonObject, type JsonObject, type JsonValue } from '../kernel/json';
import { MAX_READ_BYTES } from '../kernel/projectTree';
import { pythonStrip } from '../kernel/pythonText';
import { locateQuote } from '../kernel/quoteLocation';
import type { ProjectReader } from '../readPort';
import type { RunStore } from '../store/runs';
import {
  CHAPTER_BRIEF_ARTIFACT_KIND,
  CHAPTER_CHECK_ARTIFACT_KIND,
} from './chapterWritingContracts';

type Obj = { [key: string]: unknown };

export type FactRecordDeps = {
  readonly reader: ProjectReader;
  readonly store: RunStore;
  readonly platform: 'windows' | 'posix';
  readonly now: () => Date;
  readonly newHex: () => string;
};

export type FactRecordInput = {
  readonly project_root: string;
  readonly file_path: string;
  /** 写章补丁所属的 AgentRun（public id）。 */
  readonly run_id: string;
  /** 界面刚读到的 facts.json 原文；文件不存在为 null。写之前界面拿它核对文件没被别处改过。 */
  readonly ledger_text: string | null;
};

const text = (value: JsonValue | undefined) =>
  typeof value === 'string' ? pythonStrip(value) : '';

/** 检查产物里的一条事实 → 候选；产物来自引擎库，照样逐字段再验一遍。 */
function candidateOf(item: unknown, content: string): FactCandidate | null {
  if (!isJsonObject(item as JsonValue)) return null;
  const fact = item as JsonObject;
  const kind = text(fact.kind);
  const subject = text(fact.subject);
  const value = text(fact.value);
  const quote = typeof fact.quote === 'string' ? fact.quote : '';
  if (!FACT_KINDS.includes(kind) || !subject || !value || !pythonStrip(quote)) return null;
  const location = locateQuote(content, quote);
  if (location === null) return null;
  return {
    kind,
    subject,
    attribute: text(fact.attribute),
    value,
    object: text(fact.object) || null,
    quote,
    startLine: location.line_start,
  };
}

export async function canonicalNames(reader: ProjectReader, root: string) {
  const names = new Map<string, string>();
  try {
    const canon = await readCanon(reader, root);
    for (const entity of Array.isArray(canon.entities) ? canon.entities : []) {
      if (!isJsonObject(entity) || typeof entity.canonical_name !== 'string') continue;
      const name = pythonStrip(entity.canonical_name);
      if (name) for (const form of entitySurfaceForms(entity)) names.set(form, name);
    }
  } catch (error) {
    // canon.json 坏了只是认不出别名，不挡记账。
    if (!(error instanceof FsToolError || error instanceof InputDomainError)) throw error;
  }
  return (name: string) => names.get(pythonStrip(name)) ?? pythonStrip(name);
}

/** 对不上台账的事实交给界面说给作者听：本章的说法、台账里的说法和它出自哪章。 */
export function conflictSummaries(
  conflicts: readonly FactConflict[],
  ordinal: (path: string) => number | null,
): Obj[] {
  return conflicts.map(({ candidate, existing }) => ({
    kind: candidate.kind,
    subject: candidate.subject,
    attribute: candidate.attribute,
    value: candidate.value,
    quote: candidate.quote,
    existing_id: existing.id,
    existing_value: existing.value,
    existing_path: existing.path,
    existing_ordinal: ordinal(text(existing.path)),
  }));
}

/**
 * 作者接受整份写章补丁后：取那次运行检查时抽出的新事实，对磁盘上接受后的正文重核原句，
 * 和台账比对，算出新台账（不调模型、不写盘；写由界面做）。
 */
export async function prepareChapterFactRecord(
  deps: FactRecordDeps,
  input: FactRecordInput,
): Promise<Obj> {
  const { reader, store, platform } = deps;
  const root = input.project_root;
  const skipped = (reason: string) => ({ status: 'skipped', reason });
  const run = await store.findRun(input.run_id);
  if (run === null) return skipped('no_run');
  const artifacts = await store.artifacts(run.id);
  const latest = (kind: string) => [...artifacts].reverse().find((item) => item.kind === kind);
  const check = latest(CHAPTER_CHECK_ARTIFACT_KIND);
  if (check === undefined || !Array.isArray(check.payload.new_facts)) return skipped('no_facts');
  await resolveProjectRoot(reader, root);
  const relative = (await reader.resolveProjectPath(root, input.file_path)).resolvedRelativePath;
  if (latest(CHAPTER_BRIEF_ARTIFACT_KIND)?.payload.target_path !== relative)
    return skipped('other_file');
  const read = await reader.readProjectBytes(root, relative, MAX_READ_BYTES);
  if (read.exceeded) throw new InputDomainError(`${relative}：文件超过 2 MiB`);
  const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.bytes);
  const ledger = parseFactLedger(input.ledger_text);

  const candidates: FactCandidate[] = [];
  for (const item of check.payload.new_facts as unknown[]) {
    const candidate = candidateOf(item, content);
    if (candidate !== null) candidates.push(candidate);
  }
  const ordinals = await chapterOrdinals(reader, root, '*.md', platform);
  const ordinal = (path: string) => ordinals.get(path) ?? null;
  const plan = planFactRecord({
    ledger,
    path: relative,
    candidates,
    ordinal,
    canonical: await canonicalNames(reader, root),
    now: deps
      .now()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
    newId: deps.newHex,
  });
  const summary = {
    chapter_path: relative,
    chapter_ordinal: ordinal(relative),
    added: plan.added.length,
    superseded: plan.superseded.length,
    duplicates: plan.duplicates,
    // 作者接受前改过的地方对不上原句，这些事实不记。
    unverified: (check.payload.new_facts as unknown[]).length - candidates.length,
    conflicts: conflictSummaries(plan.conflicts, ordinal),
  };
  const changed = plan.added.length > 0 || plan.disputed.length > 0 || plan.refreshed.length > 0;
  // 没有新事实也要记下这章抽过了，补录才不会再花一次调用抽它；还没有台账时不为这个新建文件。
  if (!changed && !(plan.newlyChecked && input.ledger_text !== null))
    return { status: 'unchanged', ...summary };
  return {
    status: 'ready',
    ...summary,
    before: input.ledger_text,
    after: serializeFactLedger(plan.ledger, platform),
  };
}
