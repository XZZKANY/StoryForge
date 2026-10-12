import { ProjectReadError, type ProjectReader } from '../readPort';
import { pythonCasefold } from './casefold';
import { compareCodePoints } from './json';
import type { KnowledgeEntry } from './knowledgeEntries';
import { projectFileEvidenceHash } from './knowledgeProposals';
import {
  projectKnowledgeEntryIndex,
  type ProjectKnowledgeEntryIndex,
} from './projectKnowledgeFiles';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';

export const KNOWLEDGE_RETRIEVAL_MAX_ITEMS = 8;
export const KNOWLEDGE_RETRIEVAL_MAX_CHARS = 4_000;

export type KnowledgeSelectionSource = 'author_pinned' | 'auto_retrieved';
export type SelectedKnowledgeEntry = {
  relativePath: string;
  entry: KnowledgeEntry;
  selectionSource: KnowledgeSelectionSource;
  excerpt: string;
  score: number;
  truncated: boolean;
};
export type KnowledgeSelection = {
  items: SelectedKnowledgeEntry[];
  warnings: string[];
  structuredPaths: string[];
  plainNotes: [string, string][];
};
export type RetrievedKnowledgeEntry = {
  relativePath: string;
  entry: KnowledgeEntry;
  selectionSource: KnowledgeSelectionSource;
  excerpt: string;
  score: number;
  evidenceState: 'current' | 'stale';
  warningCount: number;
};
export type KnowledgeRetrievalResult = {
  items: RetrievedKnowledgeEntry[];
  warnings: string[];
  totalChars: number;
  structuredPaths: string[];
  plainNotes: [string, string][];
};

const WHITESPACE = new RegExp(PYTHON_WHITESPACE, 'u');
const WHITESPACE_RUN = new RegExp(`${PYTHON_WHITESPACE}+`, 'u');
const words = (value: string) => value.split(WHITESPACE_RUN).filter(Boolean);
const length = (text: string) => Array.from(text).length;

function normalize(value: string): string {
  return words(pythonCasefold(value.normalize('NFKC'))).join(' ');
}

function ngrams(value: string): Set<string> {
  const compact = Array.from(value).filter((char) => !WHITESPACE.test(char));
  const terms = new Set<string>();
  for (let index = 0; index < Math.max(compact.length - 1, 0); index++)
    terms.add(compact[index] + compact[index + 1]);
  for (const part of words(value)) if (length(part) >= 2) terms.add(part);
  return terms;
}

function score(relativePath: string, entry: KnowledgeEntry, queryTerms: Set<string>): number {
  if (!queryTerms.size) return 0;
  const haystack = ngrams(normalize(`${relativePath} ${entry.kind} ${entry.title} ${entry.claim}`));
  const title = normalize(entry.title);
  let overlap = 0;
  let bonus = 0;
  for (const term of queryTerms) {
    if (haystack.has(term)) overlap += 1;
    if (term && title.includes(term)) bonus += 2;
  }
  return overlap + bonus;
}

function boundedExcerpt(entry: KnowledgeEntry, remaining: number): [string, number, boolean] {
  const text = Array.from(pythonStrip(`## ${entry.title}\n\n${entry.claim}`));
  const excerpt = text.slice(0, Math.max(remaining, 0));
  return [excerpt.join(''), Math.max(remaining - excerpt.length, 0), excerpt.length < text.length];
}

/** 固定索引上的排序 / 预算策略：作者钉选在前（不受数量上限），其余按词面相关度。 */
export function selectKnowledgeEntries(
  index: ProjectKnowledgeEntryIndex,
  options: {
    query: string;
    pinnedPaths?: readonly string[];
    excludedIds?: readonly string[];
    maxItems?: number;
    maxChars?: number;
  },
): KnowledgeSelection {
  const excluded = new Set(options.excludedIds ?? []);
  const active = index.entries.filter(
    (item) => item.entry.status === 'active' && !excluded.has(item.entry.id),
  );
  const pinnedSet = new Set((options.pinnedPaths ?? []).map((path) => path.replace(/\\/g, '/')));
  const queryTerms = ngrams(normalize(options.query));
  const ranked = active
    .filter((item) => !pinnedSet.has(item.relativePath))
    .map((item) => [score(item.relativePath, item.entry, queryTerms), item] as const)
    .sort(
      ([a, left], [b, right]) =>
        b - a ||
        compareCodePoints(left.relativePath, right.relativePath) ||
        compareCodePoints(left.entry.id, right.entry.id),
    );
  const result: SelectedKnowledgeEntry[] = [];
  let remaining = Math.max(options.maxChars ?? KNOWLEDGE_RETRIEVAL_MAX_CHARS, 0);
  for (const item of active.filter((entry) => pinnedSet.has(entry.relativePath))) {
    const [excerpt, rest, truncated] = boundedExcerpt(item.entry, remaining);
    remaining = rest;
    result.push({ ...item, selectionSource: 'author_pinned', excerpt, score: 0, truncated });
  }
  let slots = Math.max((options.maxItems ?? KNOWLEDGE_RETRIEVAL_MAX_ITEMS) - result.length, 0);
  for (const [value, item] of ranked) {
    if (slots <= 0 || remaining <= 0 || value <= 0) break;
    const [excerpt, rest, truncated] = boundedExcerpt(item.entry, remaining);
    remaining = rest;
    if (!excerpt) break;
    result.push({ ...item, selectionSource: 'auto_retrieved', excerpt, score: value, truncated });
    slots -= 1;
  }
  const structured = index.structuredPaths.length
    ? index.structuredPaths
    : [...new Set(index.entries.map((item) => item.relativePath))];
  return {
    items: result,
    warnings: index.warnings,
    structuredPaths: [...structured].sort(compareCodePoints),
    plainNotes: index.plainNotes,
  };
}

/** 固定选择计划 + 同序采集的来源状态 → 可重放结果；缺失证据不伪造 current。 */
export function materializeKnowledgeSelection(
  selection: KnowledgeSelection,
  evidenceStates: readonly ('current' | 'stale')[],
): KnowledgeRetrievalResult {
  if (
    evidenceStates.length !== selection.items.length ||
    evidenceStates.some((state) => state !== 'current' && state !== 'stale')
  )
    throw new RangeError(
      'Knowledge selection requires one valid evidence state per selected entry',
    );
  const warnings = [...selection.warnings];
  const items = selection.items.map((item, index): RetrievedKnowledgeEntry => {
    const state = evidenceStates[index];
    if (state === 'stale')
      warnings.push(`knowledge evidence stale: ${item.relativePath}#${item.entry.id}`);
    const pinnedTruncated = item.selectionSource === 'author_pinned' && item.truncated;
    if (pinnedTruncated)
      warnings.push(`pinned knowledge truncated by budget: ${item.relativePath}#${item.entry.id}`);
    return {
      relativePath: item.relativePath,
      entry: item.entry,
      selectionSource: item.selectionSource,
      excerpt: item.excerpt,
      score: item.score,
      evidenceState: state,
      warningCount: Number(state === 'stale') + Number(pinnedTruncated),
    };
  });
  return {
    items,
    warnings,
    totalChars: items.reduce((sum, item) => sum + length(item.excerpt), 0),
    structuredPaths: selection.structuredPaths,
    plainNotes: selection.plainNotes,
  };
}

/** 条目自报 stale 或任一项目文件来源的当前哈希对不上，就是 stale。 */
export async function knowledgeEntryEvidenceState(
  reader: ProjectReader,
  root: string,
  entry: KnowledgeEntry,
): Promise<'current' | 'stale'> {
  if (entry.evidence_state === 'stale') return 'stale';
  for (const source of entry.sources) {
    if (source.type !== 'project_file' || source.path == null || source.content_sha256 == null)
      continue;
    let current: string;
    try {
      current = await projectFileEvidenceHash(reader, root, source.path);
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
      return 'stale';
    }
    if (current !== source.content_sha256) return 'stale';
  }
  return 'current';
}

/** 采集索引后只校验实际入选项的来源，不预读所有候选。 */
export async function retrieveProjectKnowledge(
  reader: ProjectReader,
  root: string,
  options: {
    query: string;
    pinnedPaths?: readonly string[];
    excludedIds?: readonly string[];
    maxItems?: number;
    maxChars?: number;
  },
): Promise<KnowledgeRetrievalResult> {
  const selection = selectKnowledgeEntries(await projectKnowledgeEntryIndex(reader, root), options);
  const states: ('current' | 'stale')[] = [];
  for (const item of selection.items)
    states.push(await knowledgeEntryEvidenceState(reader, root, item.entry));
  return materializeKnowledgeSelection(selection, states);
}
