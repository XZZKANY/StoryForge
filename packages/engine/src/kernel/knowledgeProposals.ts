import type { ProjectReader } from '../readPort';
import { pythonCasefold } from './casefold';
import {
  fsRead,
  FsToolError,
  normalizeProjectRelativePath,
  resolveProjectFile,
  resolveProjectRoot,
  resolveScopedPath,
} from './fsTools';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { isKnowledgeSha256, knowledgeClaimFingerprint } from './knowledgeEntries';
import { projectKnowledgeSourceType } from './projectKnowledge';
import {
  projectKnowledgeRead,
  validateProjectKnowledgeMarkdownTarget,
} from './projectKnowledgeFiles';
import { MAX_READ_BYTES } from './projectTree';
import { pythonStrip } from './pythonText';
import { sha256Hex } from './sha256';

export const KNOWLEDGE_PROPOSAL_ARTIFACT_KIND = 'knowledge_proposal';
export const KNOWLEDGE_PROPOSAL_SCHEMA_VERSION = 1;
export const KNOWLEDGE_PROPOSAL_MAX_ITEMS = 5;
const OPERATIONS = new Set([
  'create',
  'extend',
  'conflict',
  'dispute',
  'retire',
  'supersede',
  'migrate',
]);
const KINDS = new Set([
  'character_fact',
  'world_rule',
  'timeline_fact',
  'promise',
  'plan',
  'writing_rule',
  'reference',
]);
const CONFIDENCE = new Set([
  'author_declared',
  'project_observed',
  'inferred',
  'external_reference',
]);
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOSE_UUID =
  /^\{?(?:urn:uuid:)?[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}\}?$/;

/** 新 id 与当前时间由调用方注入：内核不读时钟、不自造随机数。 */
export type ProposalEnvironment = { newUuid: () => string; now: () => Date };

/** 项目身份：规范化后的根路径哈希（Windows 不区分大小写）。 */
export function projectFingerprint(root: string, platform: 'windows' | 'posix'): string {
  let canonical = root.replace(/\\/g, '/');
  if (platform === 'windows') canonical = pythonCasefold(canonical);
  return `sha256:${sha256Hex(canonical)}`;
}

/** 来源文件当前字节的哈希；先按各自的读取策略校验路径与可见性。 */
export async function projectFileEvidenceHash(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<string> {
  await resolveProjectRoot(reader, root);
  const relative = normalizeProjectRelativePath(path);
  let target: string;
  if (projectKnowledgeSourceType(relative) !== null) {
    await projectKnowledgeRead(reader, root, relative, { secrets: { values: [] }, limit: 1 });
    target = await resolveScopedPath(reader, root, relative);
  } else {
    await fsRead(reader, root, relative, { offset: 0, limit: 1 });
    target = await resolveProjectFile(reader, root, relative);
  }
  const read = await reader.readProjectBytes(root, target, MAX_READ_BYTES);
  if (read.exceeded)
    throw new FsToolError(`文件超过完整读取预算（${MAX_READ_BYTES} 字节）：${path}`);
  return `sha256:${sha256Hex(read.bytes)}`;
}

function utcSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function requiredText(payload: JsonObject, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !pythonStrip(value)) throw new FsToolError(`${key} 不能为空。`);
  return value;
}

function enumText(payload: JsonObject, key: string, allowed: ReadonlySet<string>): string {
  const value = requiredText(payload, key);
  if (!allowed.has(value)) throw new FsToolError(`不支持的 ${key}：${value}`);
  return value;
}

function knowledgeIds(value: JsonValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new FsToolError('related_knowledge_ids 必须是数组。');
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.startsWith('pk_') || !LOOSE_UUID.test(item.slice(3)))
      throw new FsToolError('related_knowledge_ids 只能包含 pk_<uuid>。');
    if (!CANONICAL_UUID.test(item.slice(3)))
      throw new FsToolError('related_knowledge_ids 必须使用规范小写 UUID。');
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

async function resolveSource(
  reader: ProjectReader,
  root: string,
  value: JsonValue,
  now: string,
): Promise<{ [key: string]: string }> {
  if (!isJsonObject(value)) throw new FsToolError('knowledge proposal source 必须是对象。');
  const type = requiredText(value, 'type');
  if (type === 'project_file') {
    const relative = normalizeProjectRelativePath(requiredText(value, 'path'));
    return {
      type,
      path: relative,
      content_sha256: await projectFileEvidenceHash(reader, root, relative),
    };
  }
  if (type === 'author_statement') return { type };
  if (type === 'external_reference') {
    const locator = requiredText(value, 'locator');
    const title = requiredText(value, 'title');
    const summary = value.summary;
    const summarySha = value.summary_sha256;
    let resolved: string;
    if (typeof summary === 'string' && pythonStrip(summary))
      resolved = `sha256:${sha256Hex(summary)}`;
    else if (isKnowledgeSha256(summarySha)) resolved = summarySha as string;
    else throw new FsToolError('external_reference source 需要 summary 或 summary_sha256。');
    return { type, locator, title, accessed_at: now, summary_sha256: resolved };
  }
  throw new FsToolError(`不支持的 knowledge source type：${type}`);
}

async function buildProposal(
  reader: ProjectReader,
  root: string,
  payload: JsonObject,
  now: string,
  env: ProposalEnvironment,
) {
  const [targetPath] = validateProjectKnowledgeMarkdownTarget(requiredText(payload, 'target_path'));
  const operation = enumText(payload, 'operation', OPERATIONS);
  const title = requiredText(payload, 'title');
  const claim = requiredText(payload, 'claim');
  const kind = enumText(payload, 'kind', KINDS);
  const confidence = enumText(payload, 'confidence', CONFIDENCE);
  const reason = requiredText(payload, 'reason');
  const rawSources = payload.sources;
  if (!Array.isArray(rawSources) || !rawSources.length)
    throw new FsToolError('knowledge proposal 至少需要一个来源。');
  const sources = [];
  for (const source of rawSources) sources.push(await resolveSource(reader, root, source, now));
  const related = knowledgeIds(payload.related_knowledge_ids);
  if (['extend', 'dispute', 'retire'].includes(operation) && related.length !== 1)
    throw new FsToolError(`${operation} 必须且只能关联一个既有 knowledge id。`);
  if (operation === 'supersede' && !related.length)
    throw new FsToolError('supersede 必须关联被替代的 knowledge id。');
  const knowledgeId = ['extend', 'retire'].includes(operation) ? related[0] : `pk_${env.newUuid()}`;
  return {
    proposal_id: `kpp_${env.newUuid()}`,
    knowledge_id: knowledgeId,
    author_confirmation_event_id: `ake_${env.newUuid()}`,
    target_path: targetPath,
    operation,
    title: pythonStrip(title),
    claim: pythonStrip(claim),
    kind,
    confidence,
    sources,
    related_knowledge_ids: related,
    reason: pythonStrip(reason),
    claim_fingerprint: knowledgeClaimFingerprint(title, claim),
  };
}

/** knowledge.propose：校验一组 1–5 条知识提议并解析来源证据（只读，不写作者文件）。 */
export async function buildKnowledgeProposalGroup(
  reader: ProjectReader,
  root: string,
  payload: JsonObject,
  options: ProposalEnvironment & { platform: 'windows' | 'posix' },
) {
  const raw = payload.proposals;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > KNOWLEDGE_PROPOSAL_MAX_ITEMS)
    throw new FsToolError('knowledge.propose 每组必须包含 1 到 5 条提议。');
  await resolveProjectRoot(reader, root);
  const now = utcSeconds(options.now());
  const proposals = [];
  for (const item of raw)
    if (isJsonObject(item)) proposals.push(await buildProposal(reader, root, item, now, options));
  if (proposals.length !== raw.length)
    throw new FsToolError('knowledge.propose 的每条提议都必须是对象。');
  const fingerprints = proposals.map((item) => item.claim_fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length)
    throw new FsToolError('同一知识提议组不能包含等价内容。');
  return {
    schema_version: KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
    proposal_group_id: `kpg_${options.newUuid()}`,
    revision: 1,
    project_fingerprint: projectFingerprint(root, options.platform),
    created_at: now,
    proposals,
  };
}
