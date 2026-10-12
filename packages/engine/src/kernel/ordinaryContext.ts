import { ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError } from './fsTools';
import { InputDomainError, isJsonObject, parseJson, type JsonValue } from './json';
import { hasKnowledgeBlockMarker } from './knowledgeEntries';
import { normcase } from './generationSources';
import { readProjectContextFile } from './projectKnowledgeFiles';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';
import { sha256Hex } from './sha256';

export const CONTEXT_FILE_TEXT_LIMIT = 2000;
export const PROMPT_EXCERPT_TEXT_LIMIT = 4000;
const UNSAFE_CONTEXT_KEYS = new Set([
  'agent_events',
  'debug',
  'debug_json',
  'events',
  'event_log',
  'patch',
  'patch_metadata',
  'permission',
  'permission_payload',
  'permissions',
  'proposed_patch',
  'timeline',
  'timeline_events',
  'tool_trace',
  'ui_debug',
  'ui_debug_json',
]);
const WHITESPACE_RUN = new RegExp(`${PYTHON_WHITESPACE}+`, 'u');
const points = (text: string) => Array.from(text);

/** 整段文本看起来像运行时内部载荷（事件、补丁、权限、调试 JSON），不得当作作者资料注入。 */
export function looksLikeHarnessPayload(text: string): boolean {
  const stripped = pythonStrip(text);
  if (!stripped || !'[{'.includes(stripped[0])) return false;
  let parsed: JsonValue;
  try {
    parsed = parseJson(stripped, 'context');
  } catch (error) {
    if (error instanceof InputDomainError) return false;
    throw error;
  }
  const unsafe = (value: JsonValue): boolean =>
    isJsonObject(value)
      ? Object.keys(value).some((key) => UNSAFE_CONTEXT_KEYS.has(key)) ||
        Object.values(value).some(unsafe)
      : Array.isArray(value) && value.some(unsafe);
  return unsafe(parsed);
}

export type ContextFileRequest = {
  relative_path: string;
  kind?: string | null;
  selection_source?: string | null;
  excerpt?: string | null;
  title?: string | null;
  [key: string]: unknown;
};

export type OrdinaryContextFile = {
  relative_path: string;
  kind: string;
  title: string;
  excerpt: string;
  source_text_sha256: string;
  selection_source: string;
  source_chars: number;
  truncated: boolean;
};

export type CollectedOrdinaryContext = {
  files: OrdinaryContextFile[];
  /** path, purpose, selection, reason */
  omitted: [string, string, string, string][];
  warnings: string[];
};

export function ordinaryContextFileAsContext(file: OrdinaryContextFile) {
  return { ...file, excerpt_chars: points(file.excerpt).length, source_state: 'current' };
}

/** 有界地现读作者显式选中的普通来源，并只保留仍然成立的摘录。 */
export async function collectOrdinaryContext(
  reader: ProjectReader,
  root: string,
  options: {
    contextFiles: readonly ContextFileRequest[];
    structuredPaths?: readonly string[];
    platform: 'windows' | 'posix';
    secrets: SecretContext;
  },
): Promise<CollectedOrdinaryContext> {
  const { platform, secrets } = options;
  const files: OrdinaryContextFile[] = [];
  const omitted: CollectedOrdinaryContext['omitted'] = [];
  const warnings: string[] = [];
  const structured = new Set(
    (options.structuredPaths ?? []).map((path) => normcase(path, platform)),
  );
  for (const item of options.contextFiles) {
    const path = item.relative_path;
    const kind = item.kind || 'other';
    const selection = item.selection_source || 'request_bundle';
    if (structured.has(normcase(path, platform))) {
      omitted.push([path, kind, selection, 'structured_admission']);
      continue;
    }
    let raw: string;
    try {
      raw = (await readProjectContextFile(reader, root, path)).content;
    } catch (error) {
      if (!(error instanceof FsToolError || error instanceof ProjectReadError)) throw error;
      omitted.push([path, kind, selection, 'unavailable_or_ineligible']);
      warnings.push(`context source omitted: ${path} (unavailable_or_ineligible)`);
      continue;
    }
    if (hasKnowledgeBlockMarker(raw) || looksLikeHarnessPayload(raw)) {
      omitted.push([path, kind, selection, 'unadmitted_source']);
      warnings.push(`context source omitted: ${path} (unadmitted_source)`);
      continue;
    }
    const redacted = redactSensitiveText(raw, secrets);
    const normalized = redacted.split(WHITESPACE_RUN).filter(Boolean).join(' ');
    const oldExcerpt = item.excerpt || '';
    // 保留仍存在的有意窗口（含 fs.read 窗口）；不存在了就只用当前正文，绝不沿用过时内容。
    let oldBody = oldExcerpt;
    for (const prefix of ['……（本章前文略） ', '……（本章前文略）\n'])
      if (oldBody.startsWith(prefix)) oldBody = oldBody.slice(prefix.length);
    let excerpt: string;
    if (oldBody && normalized.includes(oldBody)) excerpt = oldExcerpt;
    else if (kind === 'draft')
      excerpt = points(normalized).slice(-CONTEXT_FILE_TEXT_LIMIT).join('');
    else excerpt = points(normalized).slice(0, CONTEXT_FILE_TEXT_LIMIT).join('');
    if (!pythonStrip(excerpt)) {
      omitted.push([path, kind, selection, 'empty_source']);
      warnings.push(`context source omitted: ${path} (empty_source)`);
      continue;
    }
    if (oldBody && !normalized.includes(oldBody))
      warnings.push(`context source refreshed: ${path}`);
    if (redacted !== raw) warnings.push(`context source redacted: ${path}`);
    files.push({
      relative_path: path,
      kind,
      title: item.title || path,
      excerpt,
      source_text_sha256: sha256Hex(raw),
      selection_source: selection,
      source_chars: points(raw).length,
      truncated: points(normalized).length > points(excerpt).length,
    });
  }
  return { files, omitted, warnings };
}

type DeliveredContextFile = {
  relative_path: string;
  kind?: string | null;
  selection_source?: string | null;
  source_state?: string | null;
  source_text_sha256?: string | null;
  excerpt?: unknown;
  truncated?: unknown;
  knowledge_id?: string | null;
  evidence_state?: string | null;
};

/** 描述最终送达的摘录（与旧提示投影的裁剪、脱敏与空摘录标记一致），而不只是读过的候选。 */
export function sourceDeliveryManifest(
  collected: CollectedOrdinaryContext | null,
  contextFiles: readonly DeliveredContextFile[],
  options: {
    requested?: readonly ContextFileRequest[];
    platform: 'windows' | 'posix';
    secrets: SecretContext;
  },
) {
  const { platform, secrets } = options;
  const refs: { [key: string]: unknown }[] = [];
  for (const item of contextFiles) {
    const raw =
      typeof item.excerpt === 'string' ? item.excerpt : item.excerpt ? String(item.excerpt) : '';
    const excerpt =
      points(redactSensitiveText(pythonStrip(raw), secrets))
        .slice(0, PROMPT_EXCERPT_TEXT_LIMIT)
        .join('') || '无摘录。';
    refs.push({
      relative_path: item.relative_path,
      purpose: item.kind || 'other',
      selection_source: item.selection_source || 'request_bundle',
      source_state: item.source_state || (item.knowledge_id ? 'structured' : 'unverified'),
      source_text_sha256: item.source_text_sha256 ?? null,
      excerpt_sha256: sha256Hex(excerpt),
      delivered_chars: points(excerpt).length,
      disposition: 'delivered',
      truncated: Boolean(item.truncated),
      ...(item.knowledge_id
        ? {
            knowledge_id: item.knowledge_id,
            lifecycle: 'active',
            evidence_state: item.evidence_state ?? null,
          }
        : {}),
    });
  }
  if (collected !== null) {
    const delivered = new Set(contextFiles.map((item) => normcase(item.relative_path, platform)));
    for (const [path, purpose, selection, reason] of collected.omitted) {
      if (delivered.has(normcase(path, platform))) continue;
      refs.push({
        relative_path: path,
        purpose,
        selection_source: selection,
        source_state: reason === 'structured_admission' ? 'excluded_by_admission' : 'unavailable',
        source_text_sha256: null,
        excerpt_sha256: null,
        delivered_chars: 0,
        disposition: 'omitted',
        omission_reason: reason,
      });
    }
  }
  const represented = new Set(refs.map((item) => normcase(item.relative_path as string, platform)));
  for (const item of options.requested ?? []) {
    const path = item.relative_path;
    if (represented.has(normcase(path, platform))) continue;
    refs.push({
      relative_path: path,
      purpose: item.kind || 'other',
      selection_source: item.selection_source || 'request_bundle',
      disposition: 'omitted',
      source_state: 'not_collected',
      source_text_sha256: null,
      excerpt_sha256: null,
      delivered_chars: 0,
      omission_reason: 'selection_budget',
    });
    represented.add(normcase(path, platform));
  }
  return refs;
}
