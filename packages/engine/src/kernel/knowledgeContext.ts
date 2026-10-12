import { ProjectReadError, type ProjectReader } from '../readPort';
import { normcase, selectionSha256 } from './generationSources';
import { dumpJson } from './json';
import { hasKnowledgeBlockMarker, type KnowledgeEntry } from './knowledgeEntries';
import { retrieveProjectKnowledge, type KnowledgeRetrievalResult } from './knowledgeRetrieval';
import {
  collectOrdinaryContext,
  ordinaryContextFileAsContext,
  PROMPT_EXCERPT_TEXT_LIMIT,
  type CollectedOrdinaryContext,
  type ContextFileRequest,
} from './ordinaryContext';
import { pythonStrip } from './pythonText';
import {
  redactSensitive,
  redactSensitiveText,
  type PlainJson,
  type SecretContext,
} from './redaction';

/** 显式采集结果：空值不等于尚未采集，不会触发读盘回退。 */
export type CollectedProjectKnowledge = {
  result: KnowledgeRetrievalResult | null;
  warnings: string[];
  ordinary: CollectedOrdinaryContext | null;
  recoveryJson: string | null;
};

const SOURCE_FIELDS = [
  'type',
  'path',
  'content_sha256',
  'agent_event_id',
  'locator',
  'title',
  'accessed_at',
  'summary_sha256',
] as const;

/** Python dataclasses.asdict 的同形投影（哈希只看内容，键序无关）。 */
function entryAsDict(entry: KnowledgeEntry): PlainJson {
  return {
    id: entry.id,
    status: entry.status,
    kind: entry.kind,
    evidence_state: entry.evidence_state,
    title: entry.title,
    claim: entry.claim,
    sources: entry.sources.map((source) =>
      Object.fromEntries(SOURCE_FIELDS.map((key) => [key, source[key] ?? null])),
    ),
    claim_fingerprint: entry.claim_fingerprint,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    superseded_by: entry.superseded_by,
  };
}

/** 实际检索决定的纯证明；不持久化断言正文、摘录、查询原文或项目绝对路径。 */
export function projectKnowledgeRecoveryReceipt(
  result: KnowledgeRetrievalResult,
  options: {
    query: string;
    pinnedPaths: readonly string[];
    excludedIds: readonly string[];
    requestedPaths: readonly string[];
    platform: 'windows' | 'posix';
    secrets: SecretContext;
  },
) {
  const { platform } = options;
  const relevant = new Set(options.requestedPaths.map((path) => normcase(path, platform)));
  for (const item of result.items) relevant.add(normcase(item.relativePath, platform));
  return redactSensitive(
    {
      version: 'project-knowledge-selection-v1',
      query_sha256: selectionSha256(options.query),
      pinned_paths: [...options.pinnedPaths],
      excluded_ids: [...options.excludedIds],
      requested_paths: [...options.requestedPaths],
      selection_sha256: selectionSha256(
        result.items.map((item) => ({
          relative_path: item.relativePath,
          entry: entryAsDict(item.entry),
          selection_source: item.selectionSource,
          excerpt: item.excerpt,
          score: item.score,
          evidence_state: item.evidenceState,
          warning_count: item.warningCount,
        })),
      ),
      author_notes_sha256: selectionSha256(
        result.plainNotes.filter(([path]) => relevant.has(normcase(path, platform))),
      ),
      structured_admission_sha256: selectionSha256(
        result.structuredPaths.filter((path) => relevant.has(normcase(path, platform))),
      ),
    },
    options.secrets,
  );
}

type Bundle = { [key: string]: unknown } | null | undefined;

function firstString(bundle: Bundle, ...keys: string[]): string | null {
  if (!bundle) return null;
  for (const key of keys) {
    const value = bundle[key];
    if (typeof value === 'string' && pythonStrip(value)) return pythonStrip(value);
  }
  return null;
}

function knowledgeExclusionIds(bundle: Bundle): string[] {
  const exclusions = bundle?.knowledge_exclusions;
  if (exclusions === null || typeof exclusions !== 'object' || Array.isArray(exclusions)) return [];
  const ids = (exclusions as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return [];
  return ids
    .filter(
      (item): item is string =>
        typeof item === 'string' && item.startsWith('pk_') && item.length <= 64,
    )
    .slice(0, 8);
}

/** 采集结构化知识（作者钉选 + 自动检索）与普通来源；结构化文件的原文不再作为普通来源注入。 */
export async function collectProjectKnowledgeContext(
  reader: ProjectReader,
  bundle: Bundle,
  options: {
    contextFiles: readonly ContextFileRequest[];
    query: string;
    platform: 'windows' | 'posix';
    secrets: SecretContext;
  },
): Promise<CollectedProjectKnowledge> {
  const { contextFiles, query, platform, secrets } = options;
  const root = firstString(bundle, 'project_root', 'projectRoot');
  const empty = { result: null, warnings: [], ordinary: null, recoveryJson: null };
  if (root === null || root.startsWith('storyforge://')) return empty;
  let isDirectory = false;
  try {
    await reader.resolveProjectPath(root, '.');
    isDirectory = (await reader.inspectProjectPath(root, '.')).targetKind === 'directory';
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
  }
  const ordinary = (structuredPaths: readonly string[] = []) =>
    collectOrdinaryContext(reader, root, { contextFiles, structuredPaths, platform, secrets });
  if (!isDirectory) return { ...empty, ordinary: await ordinary() };
  const pinnedPaths = contextFiles
    .filter((item) => item.kind === 'knowledge' && typeof item.relative_path === 'string')
    .map((item) => item.relative_path);
  const excludedIds = knowledgeExclusionIds(bundle);
  let retrieved: KnowledgeRetrievalResult;
  try {
    retrieved = await retrieveProjectKnowledge(reader, root, { query, pinnedPaths, excludedIds });
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    return {
      ...empty,
      warnings: ['structured Project Knowledge retrieval failed'],
      ordinary: await ordinary(),
    };
  }
  const receipt = projectKnowledgeRecoveryReceipt(retrieved, {
    query,
    pinnedPaths,
    excludedIds,
    requestedPaths: contextFiles.map((item) => item.relative_path),
    platform,
    secrets,
  });
  return {
    result: retrieved,
    warnings: [],
    ordinary: await ordinary(retrieved.structuredPaths),
    recoveryJson: dumpJson(receipt, { ensureAscii: false, sortKeys: true }),
  };
}

/** 纯值合并：结构化知识保留检索预算、排除对应原始文件；混合文件保留块外说明。 */
export function mergeProjectKnowledgeEntries(
  knowledge: CollectedProjectKnowledge,
  options: {
    contextFiles: readonly { [key: string]: unknown }[];
    maxContextFiles: number;
    platform: 'windows' | 'posix';
    secrets: SecretContext;
  },
): [{ [key: string]: unknown }[], string[]] {
  const { platform, secrets, maxContextFiles } = options;
  const retrieved = knowledge.result;
  const key = (value: unknown) =>
    normcase(typeof value === 'string' ? value : value ? String(value) : '', platform);
  const structured = new Set(
    (retrieved?.structuredPaths ?? []).map((path) => normcase(path, platform)),
  );
  const selected = new Set(options.contextFiles.map((item) => key(item.relative_path)));
  const warnings = [...knowledge.warnings];
  let contextFiles = options.contextFiles;
  if (knowledge.ordinary !== null) {
    contextFiles = knowledge.ordinary.files.map(ordinaryContextFileAsContext);
    warnings.push(...knowledge.ordinary.warnings);
  }
  const result: { [key: string]: unknown }[] = [];
  for (const item of contextFiles) {
    const excerpt = item.excerpt;
    const marked = typeof excerpt === 'string' && hasKnowledgeBlockMarker(excerpt);
    // 准入看当前来源而不是调用方声称的类型；采集不可用时也不让未核验的块变成普通资料。
    if (structured.has(key(item.relative_path)) || marked) {
      if (marked)
        warnings.push(`raw structured context omitted by admission: ${item.relative_path}`);
      continue;
    }
    result.push(item);
  }
  if (retrieved === null) return [result, warnings];
  for (const item of retrieved.items) selected.add(normcase(item.relativePath, platform));
  for (const item of retrieved.items) {
    if (item.selectionSource === 'auto_retrieved' && result.length >= maxContextFiles) break;
    const excerpt = Array.from(redactSensitiveText(item.excerpt, secrets));
    result.push({
      relative_path: item.relativePath,
      kind: 'knowledge',
      title: item.entry.title,
      // 检索已为结构化条目做过预算，不按普通文件摘录上限再裁一次尾巴。
      excerpt: excerpt.slice(0, PROMPT_EXCERPT_TEXT_LIMIT).join(''),
      excerpt_chars: excerpt.length,
      truncated: excerpt.length > PROMPT_EXCERPT_TEXT_LIMIT,
      knowledge_id: item.entry.id,
      selection_source: item.selectionSource,
      evidence_state: item.evidenceState,
      warning_count: item.warningCount,
    });
  }
  warnings.push(...retrieved.warnings);
  for (const [path, notes] of retrieved.plainNotes) {
    if (!selected.has(normcase(path, platform))) continue;
    if (result.length >= maxContextFiles) {
      warnings.push('knowledge author notes truncated by count limit');
      break;
    }
    const redacted = Array.from(redactSensitiveText(notes, secrets));
    result.push({
      relative_path: path,
      kind: 'materials',
      title: `${path}（块外说明）`,
      excerpt: redacted.slice(0, PROMPT_EXCERPT_TEXT_LIMIT).join(''),
      excerpt_chars: redacted.length,
      truncated: redacted.length > PROMPT_EXCERPT_TEXT_LIMIT,
    });
    warnings.push(`knowledge file has non-structured author notes: ${path}`);
  }
  if (result.some((item) => item.truncated))
    warnings.push('context excerpts truncated by delivery budget');
  return [result, warnings];
}
