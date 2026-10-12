import { compareChapterPaths } from '@storyforge/project-core';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { MAX_READ_BYTES, ProjectTreeError } from './projectTree';
import { InputDomainError, JsonFields, parseJsonBytes, type JsonObject } from './json';
import { pythonStrip } from './pythonText';
import type { RosterEntity } from './bookContext';

const CANON = '.storyforge/canon/';
const CANON_FILE = CANON + 'canon.json';
const PRESENCE_FILE = CANON + 'derived/presence.json';
const RECEIPTS = '.storyforge/writeback-receipts';
const REVISION = '_storyforge_source_revision';
const isDigest = (value: unknown): boolean =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function sha256(raw: Uint8Array): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new Uint8Array(raw).buffer);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readCacheSource(
  reader: ProjectReader,
  root: string,
  path: string,
  cap: number,
): Promise<Uint8Array> {
  const target = await reader.resolveProjectPath(root, path);
  const info = await reader.inspectProjectPath(root, path);
  if (info.entryKind === 'symlink' || info.targetKind !== 'file')
    throw new InputDomainError(`${path}：不是普通文件`);
  const read = await reader.readProjectBytes(root, target.resolvedRelativePath, cap);
  if (read.exceeded) throw new InputDomainError(`${path}：超过 ${cap} 字节`);
  return read.bytes;
}

/** 回执由应用写出；任何一处不合结构都让来源版本未知，派生缓存因此不被信任。 */
function readReceipt(raw: Uint8Array, path: string, operation: string, kind: string): JsonObject {
  const fields = new JsonFields(path);
  const record = fields.object(parseJsonBytes(raw, path), '顶层');
  const allowed = new Set([
    'schemaVersion',
    'operationId',
    'fingerprint',
    ...(kind === 'intent'
      ? ['relativePath', 'beforeHash', 'afterHash', 'checkpointTimestamp']
      : ['state', 'detail']),
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    fields.member(record, 'schemaVersion') !== 1 ||
    fields.member(record, 'operationId') !== operation ||
    !isDigest(fields.member(record, 'fingerprint'))
  )
    throw new InputDomainError(`${path}：回执字段不合约定`);
  return record;
}

/** Receipt/declaration bytes qualify derived caches; manuscript mtimes do not. */
export async function captureCanonSourceRevision(
  reader: ProjectReader,
  root: string,
): Promise<string | null> {
  await reader.resolveProjectPath(root, '.');
  try {
    const records = new Map<string, Map<string, JsonObject>>();
    const hashes: [string, string][] = [];
    await reader.resolveProjectPath(root, RECEIPTS);
    const directory = await reader.inspectProjectPath(root, RECEIPTS);
    if (directory.targetKind !== 'missing') {
      const entries = await reader.readProjectDirectory(root, RECEIPTS, 4096);
      let count = 0;
      let totalBytes = 0;
      for (const name of entries.names) {
        if (++count > 4096) throw new InputDomainError(`${RECEIPTS}：回执超过 4096 个`);
        if (!name.endsWith('.intent.json') && !name.endsWith('.outcome.json')) continue;
        const match = /^([a-f0-9]{64})\.(intent|outcome)\.json$/.exec(name);
        if (!match) throw new InputDomainError(`${RECEIPTS}：回执文件名不合约定`);
        const [, operation, kind] = match;
        const path = `${RECEIPTS}/${name}`;
        const raw = await readCacheSource(reader, root, path, 16 * 1024);
        totalBytes += raw.length;
        if (totalBytes > 8 * 1024 * 1024)
          throw new InputDomainError(`${RECEIPTS}：回执总量超过 8 MiB`);
        const pair = records.get(operation) ?? new Map();
        pair.set(kind, readReceipt(raw, path, operation, kind));
        records.set(operation, pair);
        hashes.push([name, await sha256(raw)]);
      }
      if (entries.terminalError !== null) throw new ProjectReadError(entries.terminalError);
    }
    for (const [operation, pair] of records) {
      const intent = pair.get('intent');
      const outcome = pair.get('outcome');
      const fields = new JsonFields(`${RECEIPTS}/${operation}`);
      if (!intent || !outcome) throw new InputDomainError(`${RECEIPTS}：回执不成对`);
      const timestamp = fields.member(intent, 'checkpointTimestamp');
      const before = fields.member(intent, 'beforeHash');
      const detail = fields.member(outcome, 'detail');
      const path = fields.member(intent, 'relativePath');
      const state = fields.member(outcome, 'state');
      if (
        (state !== 'applied' && state !== 'not_written') ||
        fields.member(intent, 'fingerprint') !== fields.member(outcome, 'fingerprint') ||
        typeof path !== 'string' ||
        !path ||
        !isDigest(fields.member(intent, 'afterHash')) ||
        (before !== undefined && before !== null && !isDigest(before)) ||
        (timestamp !== undefined &&
          timestamp !== null &&
          !(typeof timestamp === 'number' && timestamp >= 0)) ||
        (detail !== undefined && detail !== null && typeof detail !== 'string')
      )
        throw new InputDomainError(`${RECEIPTS}：回执字段不合约定`);
    }
    hashes.sort(([a], [b]) => compareChapterPaths(a, b));
    for (const name of ['canon.json', 'hooks.json']) {
      const path = CANON + name;
      const target = await reader.resolveProjectPath(root, path);
      const info = await reader.inspectProjectPath(root, target.resolvedRelativePath);
      hashes.push([
        name,
        info.targetKind === 'missing'
          ? 'missing'
          : await sha256(
              await readCacheSource(reader, root, target.resolvedRelativePath, MAX_READ_BYTES),
            ),
      ]);
    }
    return 'canon-writeback-v1:' + (await sha256(new TextEncoder().encode(JSON.stringify(hashes))));
  } catch (error) {
    if (
      !(
        error instanceof ProjectReadError ||
        error instanceof InputDomainError ||
        error instanceof ProjectTreeError
      )
    )
      throw error;
    return null;
  }
}

type CanonEntity = { id: string | null; forms: string[] };

/** 作者声明：缺失时为空；读不到时为空；内容超出输入范围时直接报错（迁移计划 §4.3.1）。 */
async function readCanonEntities(reader: ProjectReader, root: string): Promise<CanonEntity[]> {
  const target = await reader.resolveProjectPath(root, CANON_FILE);
  if ((await reader.inspectProjectPath(root, target.resolvedRelativePath)).targetKind !== 'file')
    return [];
  const raw = await reader.readProjectBytes(root, target.resolvedRelativePath, MAX_READ_BYTES);
  if (raw.exceeded) throw new InputDomainError(`${CANON_FILE}：文件超过 2 MiB`);
  const fields = new JsonFields(CANON_FILE);
  const canon = fields.object(parseJsonBytes(raw.bytes, CANON_FILE), '顶层');
  return fields.optionalArray(fields.member(canon, 'entities'), 'entities').map((value, index) => {
    const path = `entities[${index}]`;
    const entity = fields.object(value, path);
    const name = fields.optionalString(
      fields.member(entity, 'canonical_name'),
      `${path}.canonical_name`,
    );
    const aliases = fields
      .optionalArray(fields.member(entity, 'aliases'), `${path}.aliases`)
      .map((alias, i) => fields.string(alias, `${path}.aliases[${i}]`));
    const forms: string[] = [];
    for (const form of [name, ...aliases]) {
      const stripped = form === null ? '' : pythonStrip(form);
      if (stripped && !forms.includes(stripped)) forms.push(stripped);
    }
    return { id: fields.optionalString(fields.member(entity, 'id'), `${path}.id`), forms };
  });
}

type Span = { first: number | null; last: number | null; missing: boolean };

/** 派生缓存由应用写出：缺失、过期或超出输入范围都视为失效，不取跨度。 */
async function readPresenceSpans(
  reader: ProjectReader,
  root: string,
): Promise<Map<string, Span> | null> {
  try {
    const target = await reader.resolveProjectPath(root, PRESENCE_FILE);
    const raw = await reader.readProjectBytes(root, target.resolvedRelativePath, MAX_READ_BYTES);
    if (raw.exceeded) return null;
    const fields = new JsonFields(PRESENCE_FILE);
    const presence = fields.object(parseJsonBytes(raw.bytes, PRESENCE_FILE), '顶层');
    const revision = fields.member(presence, REVISION);
    if (
      typeof revision !== 'string' ||
      (await captureCanonSourceRevision(reader, root)) !== revision
    )
      return null;
    const spans = new Map<string, Span>();
    fields
      .optionalArray(fields.member(presence, 'entities'), 'entities')
      .forEach((value, index) => {
        const path = `entities[${index}]`;
        const entry = fields.object(value, path);
        const id = fields.optionalString(fields.member(entry, 'id'), `${path}.id`);
        const span: Span = {
          first: fields.optionalInteger(
            fields.member(entry, 'first_chapter'),
            `${path}.first_chapter`,
          ),
          last: fields.optionalInteger(
            fields.member(entry, 'last_chapter'),
            `${path}.last_chapter`,
          ),
          missing:
            fields.optionalBoolean(fields.member(entry, 'missing'), `${path}.missing`) ?? false,
        };
        if (id !== null) spans.set(id, span);
      });
    return spans;
  } catch (error) {
    if (
      !(
        error instanceof ProjectReadError ||
        error instanceof InputDomainError ||
        error instanceof ProjectTreeError
      )
    )
      throw error;
    return null;
  }
}

export async function readBookRoster(
  reader: ProjectReader,
  root: string,
): Promise<{ roster: RosterEntity[]; total: number }> {
  let entities: CanonEntity[];
  try {
    entities = await readCanonEntities(reader, root);
  } catch (error) {
    // 读不到是可选来源缺席；写错（InputDomainError）不在此吞掉。
    if (!(error instanceof ProjectReadError || error instanceof ProjectTreeError)) throw error;
    return { roster: [], total: 0 };
  }
  if (!entities.length) return { roster: [], total: 0 };
  const spans = await readPresenceSpans(reader, root);
  const roster: RosterEntity[] = [];
  for (const entity of entities.slice(0, 20)) {
    if (!entity.forms.length) continue;
    const span = entity.id === null ? undefined : spans?.get(entity.id);
    roster.push({
      canonical_name: entity.forms[0],
      aliases: entity.forms.slice(1),
      first_chapter: span?.first ?? null,
      last_chapter: span?.last ?? null,
      missing: span?.missing ?? false,
    });
  }
  return { roster, total: entities.length };
}
