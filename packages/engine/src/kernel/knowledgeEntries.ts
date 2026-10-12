import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  parseJson,
  type JsonObject,
  type JsonValue,
} from './json';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';
import { sha256Hex } from './sha256';

export type KnowledgeStatus = 'active' | 'superseded' | 'retired' | 'disputed';
export type KnowledgeEvidenceState = 'current' | 'stale';

const START_MARKER_PREFIX = '<!-- storyforge-knowledge:v1';
const START_MARKER = `${START_MARKER_PREFIX}\n`;
const METADATA_END = '\n-->\n';
const END_MARKER = '\n<!-- /storyforge-knowledge -->';
const STATUSES = new Set(['active', 'superseded', 'retired', 'disputed']);
const KINDS = new Set([
  'character_fact',
  'world_rule',
  'timeline_fact',
  'promise',
  'plan',
  'writing_rule',
  'reference',
]);
const EVIDENCE_STATES = new Set(['current', 'stale']);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 应用写出的时间戳：秒级 UTC（可带 1–6 位小数）。Python fromisoformat 还接受的其它 ISO 写法不在输入范围内。
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const SOURCE_FIELDS = [
  'path',
  'content_sha256',
  'agent_event_id',
  'locator',
  'title',
  'accessed_at',
  'summary_sha256',
] as const;

/** 结构化知识块违反作者文件约定。 */
export class KnowledgeEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeEntryError';
  }
}

export type KnowledgeSource = {
  type: string;
  path?: string | null;
  content_sha256?: string | null;
  agent_event_id?: string | null;
  locator?: string | null;
  title?: string | null;
  accessed_at?: string | null;
  summary_sha256?: string | null;
};

export type KnowledgeEntry = {
  id: string;
  status: string;
  kind: string;
  evidence_state: string;
  title: string;
  claim: string;
  sources: KnowledgeSource[];
  claim_fingerprint: string;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
};

export type KnowledgeParseResult = { entries: KnowledgeEntry[]; warnings: string[] };

/** 文件是否含结构化知识块标记（即便全部损坏、零有效条目）。 */
export function hasKnowledgeBlockMarker(content: string): boolean {
  return content.includes(START_MARKER_PREFIX);
}

/** 剥离全部知识块后剩余的非空白作者说明；未闭合的块保守地当作块内容。 */
export function plainNotesOutsideKnowledgeBlocks(content: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = content.indexOf(START_MARKER_PREFIX, cursor);
    if (start < 0) {
      parts.push(content.slice(cursor));
      break;
    }
    parts.push(content.slice(cursor, start));
    const blockEnd = content.indexOf(END_MARKER, start);
    if (blockEnd < 0) break;
    cursor = blockEnd + END_MARKER.length;
  }
  return pythonStrip(parts.join(''));
}

const WHITESPACE_RUN = new RegExp(`${PYTHON_WHITESPACE}+`, 'u');
function normalizeClaimText(value: string): string {
  return pythonStrip(value.normalize('NFKC')).split(WHITESPACE_RUN).filter(Boolean).join(' ');
}

export function knowledgeClaimFingerprint(title: string, claim: string): string {
  return `sha256:${sha256Hex(`${normalizeClaimText(title)}\n${normalizeClaimText(claim)}`)}`;
}

export function isKnowledgeSha256(value: unknown): boolean {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function validateKnowledgeId(value: string, field: string) {
  if (!value.startsWith('pk_')) throw new KnowledgeEntryError(`${field} must use pk_<uuid>`);
  if (!CANONICAL_UUID.test(value.slice(3))) {
    // Python 先按 UUID 解析（大写、去连字符等仍可解析），再要求规范小写写法。
    const loose =
      /^\{?(?:urn:uuid:)?[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}\}?$/;
    throw new KnowledgeEntryError(
      loose.test(value.slice(3))
        ? `${field} must use a canonical lowercase UUID`
        : `${field} must use pk_<uuid>`,
    );
  }
}

function validateHash(value: string | null | undefined, field: string) {
  if (!isKnowledgeSha256(value))
    throw new KnowledgeEntryError(`${field} must use sha256:<64 lowercase hex>`);
}

function parseUtcTimestamp(value: string, field: string): number {
  const fail = (): never => {
    throw new KnowledgeEntryError(`${field} must use UTC ISO-8601 ending in Z`);
  };
  if (!value.includes('T') || !value.endsWith('Z')) fail();
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return fail();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const micro = Number((match[7] ?? '').padEnd(6, '0'));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const millis = date.getTime();
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    fail();
  return millis * 1000 + micro;
}

function validateRelativePath(value: string) {
  const fail = (): never => {
    throw new KnowledgeEntryError('project_file path must be a normalized relative path');
  };
  if (value !== pythonStrip(value) || value.includes('\\')) fail();
  // PurePosixPath 会折叠 `//` 与 `.`；剩下的段不能是 `..`，首段不能带冒号。
  const parts = value.split('/').filter((part) => part !== '' && part !== '.');
  if (!value || value.startsWith('/') || !parts.length || parts[0].includes(':')) fail();
  if (parts.includes('..')) fail();
}

function rejectUnexpectedSourceFields(source: KnowledgeSource, allowed: readonly string[]) {
  const unexpected = SOURCE_FIELDS.filter(
    (name) => !allowed.includes(name) && source[name] != null,
  );
  if (unexpected.length)
    throw new KnowledgeEntryError(
      `${source.type} source has unexpected fields: ${unexpected.join(', ')}`,
    );
}

function validateSource(source: KnowledgeSource) {
  if (source.type === 'project_file') {
    rejectUnexpectedSourceFields(source, ['path', 'content_sha256']);
    if (!source.path || !source.content_sha256)
      throw new KnowledgeEntryError('project_file source requires path and content_sha256');
    validateRelativePath(source.path);
    validateHash(source.content_sha256, 'content_sha256');
    return;
  }
  if (source.type === 'author_statement') {
    rejectUnexpectedSourceFields(source, ['agent_event_id']);
    if (!source.agent_event_id)
      throw new KnowledgeEntryError('author_statement source requires agent_event_id');
    return;
  }
  if (source.type === 'external_reference') {
    rejectUnexpectedSourceFields(source, ['locator', 'title', 'accessed_at', 'summary_sha256']);
    if (!(source.locator && source.title && source.accessed_at && source.summary_sha256))
      throw new KnowledgeEntryError(
        'external_reference source requires locator, title, accessed_at, and summary_sha256',
      );
    validateHash(source.summary_sha256, 'summary_sha256');
    return;
  }
  throw new KnowledgeEntryError(`unknown source type: ${source.type}`);
}

export function validateKnowledgeEntry(entry: KnowledgeEntry) {
  validateKnowledgeId(entry.id, 'id');
  if (!STATUSES.has(entry.status)) throw new KnowledgeEntryError(`unknown status: ${entry.status}`);
  if (!KINDS.has(entry.kind)) throw new KnowledgeEntryError(`unknown kind: ${entry.kind}`);
  if (!EVIDENCE_STATES.has(entry.evidence_state))
    throw new KnowledgeEntryError(`unknown evidence_state: ${entry.evidence_state}`);
  if (!pythonStrip(entry.title) || !pythonStrip(entry.claim))
    throw new KnowledgeEntryError('title and claim must not be empty');
  const created = parseUtcTimestamp(entry.created_at, 'created_at');
  const updated = parseUtcTimestamp(entry.updated_at, 'updated_at');
  if (updated < created)
    throw new KnowledgeEntryError('updated_at must not be earlier than created_at');
  if (entry.claim_fingerprint !== knowledgeClaimFingerprint(entry.title, entry.claim))
    throw new KnowledgeEntryError('claim_fingerprint does not match title and claim');
  if (!entry.sources.length) throw new KnowledgeEntryError('at least one source is required');
  entry.sources.forEach(validateSource);
  if ((entry.status === 'superseded') !== (entry.superseded_by !== null))
    throw new KnowledgeEntryError('superseded status and superseded_by must be set together');
  if (entry.superseded_by !== null) {
    validateKnowledgeId(entry.superseded_by, 'superseded_by');
    if (entry.superseded_by === entry.id)
      throw new KnowledgeEntryError('superseded_by must reference another knowledge id');
  }
}

export function sourcePayload(source: KnowledgeSource): { [key: string]: string } {
  const payload: { [key: string]: string } = { type: source.type };
  for (const key of SOURCE_FIELDS) {
    const value = source[key];
    if (value != null) payload[key] = value;
  }
  return payload;
}

export function renderKnowledgeEntry(entry: KnowledgeEntry): string {
  validateKnowledgeEntry(entry);
  const metadata: { [key: string]: unknown } = {
    claim_fingerprint: entry.claim_fingerprint,
    created_at: entry.created_at,
    evidence_state: entry.evidence_state,
    id: entry.id,
    kind: entry.kind,
    sources: entry.sources.map(sourcePayload),
    status: entry.status,
    updated_at: entry.updated_at,
  };
  if (entry.superseded_by !== null) metadata.superseded_by = entry.superseded_by;
  const encoded = dumpJson(metadata, {
    ensureAscii: false,
    sortKeys: true,
    separators: [',', ':'],
  });
  return `${START_MARKER}${encoded}${METADATA_END}## ${pythonStrip(entry.title)}\n\n${pythonStrip(entry.claim)}${END_MARKER}\n`;
}

function requiredText(payload: JsonObject, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !pythonStrip(value))
    throw new KnowledgeEntryError(`${key} must be a non-empty string`);
  return value;
}

function optionalText(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !pythonStrip(value))
    throw new KnowledgeEntryError('optional text fields must be non-empty strings');
  return value;
}

function parseBody(body: string): [string, string] {
  const normalized = pythonStrip(body);
  const newline = normalized.indexOf('\n');
  const firstLine = newline < 0 ? normalized : normalized.slice(0, newline);
  if (!firstLine.startsWith('## ') || newline < 0)
    throw new KnowledgeEntryError('body must start with a level-2 Markdown heading');
  const title = pythonStrip(firstLine.slice(3));
  const claim = pythonStrip(normalized.slice(newline + 1));
  if (!title || !claim) throw new KnowledgeEntryError('title and claim must not be empty');
  return [title, claim];
}

function sourceFromPayload(value: JsonValue): KnowledgeSource {
  if (!isJsonObject(value)) throw new KnowledgeEntryError('source must be a JSON object');
  const source: KnowledgeSource = { type: requiredText(value, 'type') };
  for (const key of SOURCE_FIELDS) source[key] = optionalText(value[key]);
  return source;
}

function entryFromPayload(payload: JsonObject, body: string): KnowledgeEntry {
  const [title, claim] = parseBody(body);
  const rawSources = payload.sources;
  if (!Array.isArray(rawSources)) throw new KnowledgeEntryError('sources must be an array');
  const entry: KnowledgeEntry = {
    id: requiredText(payload, 'id'),
    status: requiredText(payload, 'status'),
    kind: requiredText(payload, 'kind'),
    evidence_state: requiredText(payload, 'evidence_state'),
    title,
    claim,
    sources: rawSources.map(sourceFromPayload),
    claim_fingerprint: requiredText(payload, 'claim_fingerprint'),
    created_at: requiredText(payload, 'created_at'),
    updated_at: requiredText(payload, 'updated_at'),
    superseded_by: optionalText(payload.superseded_by),
  };
  validateKnowledgeEntry(entry);
  return entry;
}

/**
 * 解析 Markdown 里的结构化知识块。损坏的块只记 warning 不中断；元数据不是合法 JSON 时
 * warning 正文用本引擎的 JSON 报错（与 Python json 模块的措辞不同，属接受的差异）。
 */
export function parseKnowledgeMarkdown(content: string): KnowledgeParseResult {
  const entries: KnowledgeEntry[] = [];
  const warnings: string[] = [];
  let cursor = 0;
  let block = 0;
  for (;;) {
    const start = content.indexOf(START_MARKER, cursor);
    if (start < 0) break;
    block += 1;
    const metadataStart = start + START_MARKER.length;
    const metadataEnd = content.indexOf(METADATA_END, metadataStart);
    let nextStart = content.indexOf(START_MARKER, metadataStart);
    if (nextStart >= 0 && (metadataEnd < 0 || nextStart < metadataEnd)) {
      warnings.push(`knowledge block ${block}: metadata marker is not closed`);
      cursor = nextStart;
      continue;
    }
    if (metadataEnd < 0) {
      warnings.push(`knowledge block ${block}: metadata marker is not closed`);
      break;
    }
    const bodyStart = metadataEnd + METADATA_END.length;
    const blockEnd = content.indexOf(END_MARKER, bodyStart);
    nextStart = content.indexOf(START_MARKER, bodyStart);
    if (nextStart >= 0 && (blockEnd < 0 || nextStart < blockEnd)) {
      warnings.push(`knowledge block ${block}: block marker is not closed`);
      cursor = nextStart;
      continue;
    }
    if (blockEnd < 0) {
      warnings.push(`knowledge block ${block}: block marker is not closed`);
      cursor = bodyStart;
      continue;
    }
    try {
      const metadata = parseJson(content.slice(metadataStart, metadataEnd), 'knowledge metadata');
      if (!isJsonObject(metadata)) throw new KnowledgeEntryError('metadata must be a JSON object');
      const entry = entryFromPayload(metadata, content.slice(bodyStart, blockEnd));
      if (entries.some((existing) => existing.id === entry.id))
        throw new KnowledgeEntryError(`duplicate knowledge id: ${entry.id}`);
      entries.push(entry);
    } catch (error) {
      if (!(error instanceof KnowledgeEntryError || error instanceof InputDomainError)) throw error;
      warnings.push(`knowledge block ${block}: ${error.message}`);
    }
    cursor = blockEnd + END_MARKER.length;
  }
  return { entries, warnings };
}

function entryBlockSpan(content: string, entryId: string): [number, number] {
  let cursor = 0;
  for (;;) {
    const start = content.indexOf(START_MARKER, cursor);
    if (start < 0) break;
    const metadataStart = start + START_MARKER.length;
    const metadataEnd = content.indexOf(METADATA_END, metadataStart);
    const bodyStart = metadataEnd + METADATA_END.length;
    const blockEnd = content.indexOf(END_MARKER, bodyStart);
    const metadata = parseJson(content.slice(metadataStart, metadataEnd), 'knowledge metadata');
    let end = blockEnd + END_MARKER.length;
    if (end < content.length && content[end] === '\n') end += 1;
    if (isJsonObject(metadata) && metadata.id === entryId) return [start, end];
    cursor = end;
  }
  throw new KnowledgeEntryError(`knowledge entry not found: ${entryId}`);
}

export function upsertKnowledgeEntry(content: string, entry: KnowledgeEntry): string {
  const rendered = renderKnowledgeEntry(entry);
  const parsed = parseKnowledgeMarkdown(content);
  if (parsed.warnings.length)
    throw new KnowledgeEntryError('existing Markdown contains malformed knowledge blocks');
  if (parsed.entries.some((existing) => existing.id === entry.id)) {
    const [start, end] = entryBlockSpan(content, entry.id);
    return content.slice(0, start) + rendered + content.slice(end);
  }
  if (!content) return rendered;
  return content + (content.endsWith('\n') ? '\n' : '\n\n') + rendered;
}
