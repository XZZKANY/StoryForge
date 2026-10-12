import type { ProjectReader } from '../readPort';
import { cpLen, isObj, get, type Obj } from './contextValues';
import { GenerationSourceCapture, normcase, selectionSha256 } from './generationSources';
import { dumpJson } from './json';
import { buildLlmContextSnapshot } from './llmContext';
import { llmContextSnapshotToPromptContextBundle } from './llmPromptContext';
import { redactSensitive, type PlainJson, type SecretContext } from './redaction';
import { sha256Hex } from './sha256';

type Platform = 'windows' | 'posix';

/** 对应 Python ConflictError（HTTP 409）：上下文与目标不匹配，要求调用方重新准备。 */
export class WritingContextConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'WritingContextConflictError';
  }
}

/** pydantic 校验 AssistantContextBundle 失败（Python 的 ValidationError）。 */
export class ContextBundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextBundleValidationError';
  }
}

export type AssistantContextBundleFile = {
  path: string;
  relative_path: string;
  kind: string;
  title: string;
  excerpt: string;
};

export type AssistantContextBundle = {
  project_root: string;
  current_file: string;
  files: AssistantContextBundleFile[];
  summary: Obj;
  budget: Obj | null;
};

const FILE_LIMITS: [keyof AssistantContextBundleFile, number][] = [
  ['path', 1024],
  ['relative_path', 512],
  ['kind', 40],
  ['title', 255],
  ['excerpt', 4000],
];

function boundedText(source: Obj, key: string, max: number, where: string): string {
  const value = get(source, key);
  if (typeof value !== 'string')
    throw new ContextBundleValidationError(`${where}.${key} 必须是字符串`);
  const length = cpLen(value);
  if (length < 1 || length > max)
    throw new ContextBundleValidationError(`${where}.${key} 长度须在 1..${max} 之间`);
  return value;
}

function onlyKeys(source: Obj, allowed: readonly string[], where: string) {
  const extra = Object.keys(source).filter((key) => !allowed.includes(key));
  if (extra.length)
    throw new ContextBundleValidationError(`${where} 不允许字段：${extra.join(', ')}`);
}

/** 照 schemas.AssistantContextBundle 的约束校验（extra=forbid，长度按码点）。 */
export function validateAssistantContextBundle(raw: PlainJson | undefined): AssistantContextBundle {
  if (!isObj(raw)) throw new ContextBundleValidationError('context_bundle 必须是对象');
  onlyKeys(raw, ['project_root', 'current_file', 'files', 'summary', 'budget'], 'context_bundle');
  const filesValue = get(raw, 'files') ?? [];
  if (!Array.isArray(filesValue))
    throw new ContextBundleValidationError('context_bundle.files 必须是列表');
  if (filesValue.length > 12)
    throw new ContextBundleValidationError('context_bundle.files 最多 12 项');
  const files = filesValue.map((item, index) => {
    const where = `context_bundle.files[${index}]`;
    if (!isObj(item)) throw new ContextBundleValidationError(`${where} 必须是对象`);
    onlyKeys(
      item,
      FILE_LIMITS.map(([key]) => key),
      where,
    );
    const file = {} as AssistantContextBundleFile;
    for (const [key, max] of FILE_LIMITS) file[key] = boundedText(item, key, max, where);
    return file;
  });
  const summary = get(raw, 'summary') ?? {};
  if (!isObj(summary)) throw new ContextBundleValidationError('context_bundle.summary 必须是对象');
  const budget = get(raw, 'budget') ?? null;
  if (budget !== null && !isObj(budget))
    throw new ContextBundleValidationError('context_bundle.budget 必须是对象或 null');
  return {
    project_root: boundedText(raw, 'project_root', 1024, 'context_bundle'),
    current_file: boundedText(raw, 'current_file', 1024, 'context_bundle'),
    files,
    summary: JSON.parse(JSON.stringify(summary)) as Obj,
    budget: budget === null ? null : (JSON.parse(JSON.stringify(budget)) as Obj),
  };
}

/** pydantic model_dump 的字段顺序。 */
function bundleFileDump(file: AssistantContextBundleFile): Obj {
  return {
    path: file.path,
    relative_path: file.relative_path,
    kind: file.kind,
    title: file.title,
    excerpt: file.excerpt,
  };
}

function bundleDump(bundle: AssistantContextBundle): Obj {
  return {
    project_root: bundle.project_root,
    current_file: bundle.current_file,
    files: bundle.files.map(bundleFileDump),
    summary: bundle.summary,
    budget: bundle.budget,
  };
}

function normpath(path: string, platform: Platform): string {
  const sep = platform === 'windows' ? '\\' : '/';
  const text = platform === 'windows' ? path.replace(/\//g, '\\') : path;
  let prefix = '';
  let rest = text;
  if (platform === 'windows') {
    const unc = /^\\\\[^\\]+\\[^\\]+/.exec(rest);
    const drive = /^[A-Za-z]:/.exec(rest);
    const head = unc ?? drive;
    if (head) {
      prefix = head[0];
      rest = rest.slice(prefix.length);
    }
  }
  const absolute = rest.startsWith(sep);
  const parts: string[] = [];
  for (const part of rest.split(sep)) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  return prefix + (absolute ? sep : '') + parts.join(sep) || '.';
}

function joinPath(base: string, path: string, platform: Platform): string {
  if (!base) return path;
  if (platform === 'posix')
    return path.startsWith('/') ? path : `${base.replace(/\/+$/, '')}/${path}`;
  const normalized = path.replace(/\//g, '\\');
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith('\\\\')) return normalized;
  if (normalized.startsWith('\\')) return (/^[A-Za-z]:/.exec(base)?.[0] ?? '') + normalized;
  return `${base.replace(/[\\/]+$/, '')}\\${normalized}`;
}

/**
 * 项目 / 目标身份。Python 用 realpath 认出 Windows junction 别名；这里只做词法规范化，
 * 别名两侧不认作同一项目（偏向拒绝，接受的差异）。准入路径两侧来自同一串，结果不受影响。
 */
function identity(
  projectRoot: string | null,
  filePath: string,
  content: string,
  intent: string,
  platform: Platform,
): string {
  const root = projectRoot ? normcase(normpath(projectRoot, platform), platform) : null;
  const target = normcase(normpath(joinPath(root ?? '', filePath, platform), platform), platform);
  return JSON.stringify([root, target, sha256Hex(content), intent]);
}

const TOKEN = Symbol('PreparedWritingContext');

/** 不是请求 DTO，也不是客户端 / 模型能填的「已准入」标记：只能由本模块构造。 */
export class PreparedWritingContext {
  /** @internal */
  readonly identity: string;
  private readonly bundleJson: string;
  readonly contextReceiptJson: string | null;

  constructor(
    token: typeof TOKEN,
    identityKey: string,
    bundleJson: string,
    contextReceiptJson: string | null,
  ) {
    if (token !== TOKEN) throw new TypeError('PreparedWritingContext 只能由写作上下文准入构造');
    this.identity = identityKey;
    this.bundleJson = bundleJson;
    this.contextReceiptJson = contextReceiptJson;
  }

  /** 每个消费者拿到新的可变值，绝不共享别名。 */
  get contextBundle(): AssistantContextBundle {
    return JSON.parse(this.bundleJson) as AssistantContextBundle;
  }
}

type Target = {
  projectRoot: string | null;
  filePath: string;
  content: string;
  intent: string;
  platform: Platform;
};

/**
 * 章节适配器专用：它的版本守卫必须紧挨着交接前通过。
 * 落盘的 Chapter Brief 把根脱敏成 '.'；只恢复调用方已校验的项目身份，不信来源给的根。
 */
export function writingContextFromGuardedBundle(
  raw: PlainJson,
  target: Target & { projectRoot: string; contextReceipt?: Obj | null },
): PreparedWritingContext {
  const bundle = validateAssistantContextBundle(raw);
  const { projectRoot, filePath, content, intent, platform } = target;
  if (
    bundle.project_root !== '.' &&
    identity(bundle.project_root, filePath, content, intent, platform) !==
      identity(projectRoot, filePath, content, intent, platform)
  )
    throw new WritingContextConflictError('已守卫章节上下文的项目归属不匹配，请重新生成。');
  bundle.project_root = projectRoot;
  const receipt = target.contextReceipt ?? null;
  if (
    receipt !== null &&
    get(receipt, 'prompt_files_sha256') !== selectionSha256(bundle.files.map(bundleFileDump))
  )
    throw new WritingContextConflictError('Chapter Brief 的资料投影已变化，请重新生成。');
  return new PreparedWritingContext(
    TOKEN,
    identity(projectRoot, filePath, content, intent, platform),
    JSON.stringify(bundleDump(bundle)),
    receipt === null ? null : dumpJson(receipt, { ensureAscii: false, sortKeys: true }),
  );
}

export function writingContextFromSnapshot(
  snapshot: Obj,
  target: Target & { secrets: SecretContext },
): PreparedWritingContext {
  const { projectRoot, filePath, content, intent, platform, secrets } = target;
  const selectedValue = get(snapshot, 'selected_file');
  const selected: Obj = isObj(selectedValue) ? selectedValue : {};
  const project = get(snapshot, 'project');
  let capturedRoot = isObj(project) ? get(project, 'project_root') : undefined;
  if (typeof capturedRoot === 'string' && capturedRoot.startsWith('storyforge://'))
    capturedRoot = undefined;
  const expected = identity(projectRoot, filePath, content, intent, platform);
  const selectedPath = get(selected, 'file_path');
  if (
    get(snapshot, 'intent') !== intent ||
    identity(
      typeof capturedRoot === 'string' && capturedRoot ? capturedRoot : null,
      typeof selectedPath === 'string' ? selectedPath : '',
      content,
      intent,
      platform,
    ) !== expected ||
    get(selected, 'content_sha256') !== sha256Hex(content)
  )
    throw new WritingContextConflictError('快照与写作目标或正文版本不匹配，请重新准备。');
  const bundle = validateAssistantContextBundle(
    llmContextSnapshotToPromptContextBundle(snapshot, secrets),
  );
  const sourceManifest = redactSensitive(get(snapshot, 'source_manifest') ?? null, secrets);
  const receipt = {
    version: 'writer-context-v1',
    knowledge: get(snapshot, 'knowledge_recovery') ?? null,
    source_manifest: sourceManifest,
    source_manifest_sha256: selectionSha256(sourceManifest),
    prompt_files_sha256: selectionSha256(bundle.files.map(bundleFileDump)),
  };
  return new PreparedWritingContext(
    TOKEN,
    expected,
    JSON.stringify(bundleDump(bundle)),
    dumpJson(receipt, { ensureAscii: false, sortKeys: true }),
  );
}

export type WritingRequest = {
  file_path: string;
  content?: string;
  instruction?: string | null;
  project_root?: string | null;
  context_bundle?: AssistantContextBundle | null;
};

/** 原始请求只准入一次；已校验的后端交接不再重读合成文件。 */
export async function admitWritingRequest<T extends WritingRequest>(
  reader: ProjectReader,
  payload: T,
  options: {
    intent: string;
    preparedContext?: PreparedWritingContext | null;
    platform: Platform;
    secrets: SecretContext;
    capture?: GenerationSourceCapture;
  },
): Promise<T> {
  const { intent, platform, secrets } = options;
  const content = payload.content ?? '';
  const projectRoot = payload.project_root ?? null;
  let prepared = options.preparedContext ?? null;
  if (prepared !== null) {
    if (
      !(prepared instanceof PreparedWritingContext) ||
      prepared.identity !== identity(projectRoot, payload.file_path, content, intent, platform)
    )
      throw new WritingContextConflictError(
        '写作上下文与项目、文件、正文或操作不匹配，请重新准备。',
      );
  } else {
    if ((payload.context_bundle ?? null) === null && projectRoot === null) return payload;
    const raw: Obj = payload.context_bundle ? bundleDump(payload.context_bundle) : {};
    // 请求身份优先：bundle 不能把读盘重定向到别处。
    raw.project_root = projectRoot || 'storyforge://llm-context';
    raw.current_file = payload.file_path;
    const snapshot = await buildLlmContextSnapshot(
      reader,
      {
        runState: null,
        intent,
        userMessage: payload.instruction || '续写',
        filePath: payload.file_path,
        content,
        contextBundle: raw,
      },
      { platform, secrets },
    );
    prepared = writingContextFromSnapshot(snapshot, {
      projectRoot,
      filePath: payload.file_path,
      content,
      intent,
      platform,
      secrets,
    });
  }
  const bundle = prepared.contextBundle;
  if (prepared.contextReceiptJson) {
    const receipt = JSON.parse(prepared.contextReceiptJson) as Obj;
    if (get(receipt, 'prompt_files_sha256') !== selectionSha256(bundle.files.map(bundleFileDump)))
      throw new WritingContextConflictError('写作上下文送达版本不匹配，请重新准备。');
    if (options.capture)
      options.capture.contextDelivery = JSON.parse(
        dumpJson(receipt, { ensureAscii: false, sortKeys: true }),
      ) as PlainJson;
  }
  return { ...payload, context_bundle: bundle };
}
