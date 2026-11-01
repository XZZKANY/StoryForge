import { decodeUtf8, normalizeNewlines, ProjectReadError, type ProjectReader } from '../readPort';
import { platformTextBytes, type ProjectWriter } from '../writePort';
import { checkCanonDeclaration, checkHooksDeclaration } from './canonDeclarations';
import { captureCanonSourceRevision } from './canonStore';
import { checkFactLedger, FACTS_LEDGER_VERSION } from './factLedger';
import { FsToolError, nativeProjectPath, resolveProjectRoot } from './fsTools';
import type { GenerationSourceCapture } from './generationSources';
import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  JsonFields,
  parseJsonBytes,
  type JsonObject,
} from './json';
import { MAX_READ_BYTES } from './projectTree';

const CANON_DIR = '.storyforge/canon';
const DERIVED_DIR = `${CANON_DIR}/derived`;
const DERIVED_JSON = new Set([
  'presence.json',
  'proposals.json',
  'report.json',
  'observations.json',
]);
const DERIVED_TEXT = new Set(['dossier.md']);
const SOURCE_REVISION_KEY = '_storyforge_source_revision';
const EMPTY_CANON = () => ({ version: 1, entities: [], invariants: {} });
const EMPTY_HOOKS = () => ({ version: 1, hooks: [] });

/**
 * 作者声明：缺失返回 null；读不到报 FsToolError（调用方按可选来源处理）；
 * 内容超出输入范围报 InputDomainError（不吞，迁移计划 §4.3.1）。
 */
async function readDeclaration(
  reader: ProjectReader,
  root: string,
  filename: string,
  purpose: string,
  check: (value: JsonObject, source: string) => void,
  capture?: GenerationSourceCapture,
): Promise<JsonObject | null> {
  const path = `${CANON_DIR}/${filename}`;
  await resolveProjectRoot(reader, root);
  const unavailable = async (relative: string, outsideProject = false): Promise<never> => {
    await capture?.observe(purpose, relative, {
      complete: false,
      omissionReason: 'invalid_or_unavailable_declaration',
      outsideProject,
    });
    throw new FsToolError(`${filename} 无法安全读取或解析。`);
  };
  let target: string;
  try {
    target = (await reader.resolveProjectPath(root, path)).resolvedRelativePath;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    return unavailable(path, error.kind === 'outside-project');
  }
  let raw: Uint8Array;
  try {
    if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file') {
      await capture?.observe(purpose, target, { omissionReason: 'missing_source' });
      return null;
    }
    const read = await reader.readProjectBytes(root, target, MAX_READ_BYTES);
    if (read.exceeded) throw new InputDomainError(`${path}：文件超过 2 MiB`);
    raw = read.bytes;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    return unavailable(target);
  }
  const parsed = new JsonFields(path).object(parseJsonBytes(raw, path), '顶层');
  check(parsed, path);
  const text = normalizeNewlines(decodeUtf8(raw));
  await capture?.observe(purpose, target, { raw, text, complete: true });
  return parsed;
}

const withDefaults = (parsed: JsonObject, defaults: JsonObject): JsonObject => {
  for (const [key, value] of Object.entries(defaults)) if (!(key in parsed)) parsed[key] = value;
  return parsed;
};

export async function readCanon(
  reader: ProjectReader,
  root: string,
  capture?: GenerationSourceCapture,
): Promise<JsonObject> {
  const parsed = await readDeclaration(
    reader,
    root,
    'canon.json',
    'canon_declaration',
    checkCanonDeclaration,
    capture,
  );
  return parsed === null ? EMPTY_CANON() : withDefaults(parsed, EMPTY_CANON());
}

export async function readHooks(
  reader: ProjectReader,
  root: string,
  capture?: GenerationSourceCapture,
): Promise<JsonObject> {
  const parsed = await readDeclaration(
    reader,
    root,
    'hooks.json',
    'hook_declaration',
    checkHooksDeclaration,
    capture,
  );
  return parsed === null ? EMPTY_HOOKS() : withDefaults(parsed, EMPTY_HOOKS());
}

/**
 * 事实台账 facts.json：没有这个文件就返回 null，而且不记成生成来源——没开始记账的书，
 * 生成证据一字不差。读不到报 FsToolError，格式不对报 InputDomainError。
 */
export async function readFactLedger(
  reader: ProjectReader,
  root: string,
  capture?: GenerationSourceCapture,
): Promise<JsonObject | null> {
  await resolveProjectRoot(reader, root);
  try {
    const target = (await reader.resolveProjectPath(root, `${CANON_DIR}/facts.json`))
      .resolvedRelativePath;
    if ((await reader.inspectProjectPath(root, target)).targetKind === 'missing') return null;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
  }
  const parsed = await readDeclaration(
    reader,
    root,
    'facts.json',
    'fact_ledger',
    checkFactLedger,
    capture,
  );
  return parsed === null
    ? null
    : withDefaults(parsed, { version: FACTS_LEDGER_VERSION, facts: [] });
}

const jsonText = (payload: unknown) => dumpJson(payload, { indent: 2, ensureAscii: false });

/** canon.json 缺失时写一份空模板确立格式；已存在不动。返回是否新建。 */
export async function scaffoldCanonIfMissing(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  platform: 'windows' | 'posix',
): Promise<boolean> {
  await resolveProjectRoot(reader, root);
  const path = `${CANON_DIR}/canon.json`;
  if ((await reader.inspectProjectPath(root, path)).targetKind !== 'missing') return false;
  await writer.writeProjectFile(root, path, platformTextBytes(jsonText(EMPTY_CANON()), platform));
  return true;
}

async function derivedTarget(
  reader: ProjectReader,
  root: string,
  name: string,
  allowed: ReadonlySet<string>,
): Promise<string> {
  if (!allowed.has(name)) throw new FsToolError(`不允许的派生缓存文件名：${name}`);
  await resolveProjectRoot(reader, root);
  try {
    const canonDir = (await reader.resolveProjectPath(root, CANON_DIR)).resolvedRelativePath;
    const target = (await reader.resolveProjectPath(root, `${DERIVED_DIR}/${name}`))
      .resolvedRelativePath;
    if (target.startsWith(`${canonDir}/`)) return target;
  } catch (error) {
    if (!(error instanceof ProjectReadError && error.kind === 'outside-project')) throw error;
  }
  throw new FsToolError('派生缓存路径越界。');
}

async function requireSourceRevision(
  reader: ProjectReader,
  root: string,
  sourceRevision: string | null,
) {
  if (
    sourceRevision === null ||
    (await captureCanonSourceRevision(reader, root)) !== sourceRevision
  )
    throw new FsToolError('派生缓存来源已变化或无法确认，请确认写入结果后重新扫描。');
}

/** 原子写缓存与扫描前版本；proposals 是待决草稿，不参与正文派生失效。返回落盘的绝对路径。 */
export async function writeDerived(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  name: string,
  payload: { [key: string]: unknown },
  options: { sourceRevision: string | null; platform: 'windows' | 'posix' },
): Promise<string> {
  const target = await derivedTarget(reader, root, name, DERIVED_JSON);
  let body = payload;
  if (name !== 'proposals.json') {
    await requireSourceRevision(reader, root, options.sourceRevision);
    body = { ...payload, [SOURCE_REVISION_KEY]: options.sourceRevision };
  }
  await writer.writeProjectFile(root, target, platformTextBytes(jsonText(body), options.platform));
  return nativeProjectPath(root, target, options.platform);
}

export async function writeDerivedText(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  name: string,
  text: string,
  options: { sourceRevision: string | null; platform: 'windows' | 'posix' },
): Promise<string> {
  const target = await derivedTarget(reader, root, name, DERIVED_TEXT);
  await requireSourceRevision(reader, root, options.sourceRevision);
  const body = `<!-- ${SOURCE_REVISION_KEY}: ${options.sourceRevision} -->\n` + text;
  await writer.writeProjectFile(root, target, platformTextBytes(body, options.platform));
  return nativeProjectPath(root, target, options.platform);
}

/**
 * 读派生缓存；缺失、读不到、超出输入范围、无版本或来源已变都返回 null，
 * 不凭残留文件信任旧正文。
 */
export async function readDerived(
  reader: ProjectReader,
  root: string,
  name: string,
): Promise<JsonObject | null> {
  if (!DERIVED_JSON.has(name)) throw new FsToolError(`不允许的派生缓存文件名：${name}`);
  await resolveProjectRoot(reader, root);
  const path = `${DERIVED_DIR}/${name}`;
  try {
    const target = (await reader.resolveProjectPath(root, path)).resolvedRelativePath;
    const read = await reader.readProjectBytes(root, target, MAX_READ_BYTES);
    if (read.exceeded) return null;
    const parsed = parseJsonBytes(read.bytes, path);
    if (!isJsonObject(parsed)) return null;
    if (name !== 'proposals.json') {
      const revision = parsed[SOURCE_REVISION_KEY];
      delete parsed[SOURCE_REVISION_KEY];
      if (
        typeof revision !== 'string' ||
        (await captureCanonSourceRevision(reader, root)) !== revision
      )
        return null;
    }
    return parsed;
  } catch (error) {
    if (error instanceof ProjectReadError || error instanceof InputDomainError) return null;
    throw error;
  }
}
