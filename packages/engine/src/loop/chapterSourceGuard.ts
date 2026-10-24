import { buildGenerationSystemPrompt } from '../kernel/authorVoice';
import { buildSceneConstraintBlock } from '../kernel/canonContext';
import {
  FsToolError,
  nativeProjectPath,
  normalizeProjectRelativePath,
  resolveProjectRoot,
  resolveScopedPath,
} from '../kernel/fsTools';
import { GenerationSourceCapture, MAX_MANIFEST_BYTES } from '../kernel/generationSources';
import { compareCodePoints, dumpJson, InputDomainError } from '../kernel/json';
import { PREVIOUS_FULL_MAX_CHARS, previousChapterTail } from '../kernel/previousChapter';
import { ProjectTreeError } from '../kernel/projectTree';
import { redactSensitiveText, type SecretContext } from '../kernel/redaction';
import { collectSettingSources } from '../kernel/settingSources';
import { loadWritingSkills } from '../kernel/writingSkills';
import { sha256Hex } from '../kernel/sha256';
import {
  writingContextFromGuardedBundle,
  writingContextFromSnapshot,
  type PreparedWritingContext,
} from '../kernel/writingContext';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { AgentOrchestrationError } from './runPayloads';
import { writingContextSourcesUnchanged } from './writingContextRecovery';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const VERSION = 2;
const FIXED_SOURCES = [
  '.storyforge/agent-instructions.md',
  '.storyforge/canon/canon.json',
  '.storyforge/canon/hooks.json',
];
const MAX_SOURCE_BYTES = 4_000_000;
const FACTS_LEDGER = '.storyforge/canon/facts.json';
const DRIFT = 'Chapter Brief 的来源在确认期间已变化，请重新生成 Brief 后再确认。';

export type GuardDeps = {
  readonly reader: ProjectReader;
  readonly platform: 'windows' | 'posix';
  readonly secrets: SecretContext;
};

const identityOf = (deps: GuardDeps, root: string, target: string) =>
  GenerationSourceCapture.create({
    root,
    platform: deps.platform,
    secrets: deps.secrets,
    writingContextFile: target,
  });

/** 来源文件字节 + 上一章结尾 + 测得的声音 + 场景约束：草稿 / 修复用的是同一批公共读取者。 */
async function sourceSignature(
  deps: GuardDeps,
  root: string,
  target: string,
  paths: readonly string[],
): Promise<string> {
  const { reader, platform } = deps;
  try {
    await resolveProjectRoot(reader, root);
    const files: [string, string | null][] = [];
    for (const relative of paths) {
      const normalized = normalizeProjectRelativePath(relative);
      const scoped = await resolveScopedPath(reader, root, normalized);
      const kind = (await reader.inspectProjectPath(root, scoped)).targetKind;
      let digest: string | null = null;
      if (kind !== 'missing') {
        if (kind !== 'file') throw new FsToolError('来源不是文件。');
        const read = await reader.readProjectBytes(root, scoped, MAX_SOURCE_BYTES);
        if (read.bytes.length > MAX_SOURCE_BYTES)
          throw new AgentOrchestrationError(
            'Chapter Brief 来源超过校验上限，请缩小材料后重新生成。',
          );
        digest = sha256Hex(read.bytes);
      }
      files.push([normalized, digest]);
    }
    const absolute = nativeProjectPath(root, target, platform);
    // 与起草送进去的同一份：上一章全文、立项资料全文。
    const values: { [key: string]: unknown } = {
      files,
      previous: await previousChapterTail(reader, root, absolute, {
        platform,
        maxChars: PREVIOUS_FULL_MAX_CHARS,
      }),
      system: await buildGenerationSystemPrompt(reader, '', root, { platform }),
      scene: await buildSceneConstraintBlock(reader, root, absolute, { platform }),
    };
    const settings = await collectSettingSources(reader, root, { secrets: deps.secrets });
    if (settings !== null) values.settings = settings.block;
    const skills = await loadWritingSkills(reader, root, deps.secrets);
    if (skills.length) values.skills = skills.map((skill) => [skill.path, skill.sha256]);
    // 起草会带上台账里的已写事实；还没开始记账的书签名不变。
    if ((await reader.inspectProjectPath(root, FACTS_LEDGER)).targetKind !== 'missing') {
      const read = await reader.readProjectBytes(root, FACTS_LEDGER, MAX_SOURCE_BYTES);
      if (read.exceeded)
        throw new AgentOrchestrationError('事实台账超过校验上限，请缩小后重新生成 Brief。');
      values.facts = sha256Hex(read.bytes);
    }
    return sha256Hex(dumpJson(values, { ensureAscii: false, sortKeys: true }));
  } catch (error) {
    if (
      error instanceof FsToolError ||
      error instanceof ProjectReadError ||
      error instanceof ProjectTreeError ||
      error instanceof InputDomainError ||
      error instanceof RangeError ||
      error instanceof TypeError
    )
      throw new AgentOrchestrationError('Chapter Brief 来源无法读取或验证，请重新生成。');
    throw error;
  }
}

/** 确认期间来源有任何变化就拒绝继续（版本、项目身份、目标、冻结的写作上下文、来源签名）。 */
export async function assertChapterSources(
  deps: GuardDeps,
  root: string,
  target: string,
  guard: unknown,
): Promise<void> {
  if (!isObj(guard) || guard.version !== VERSION)
    throw new AgentOrchestrationError('Chapter Brief 缺少来源版本，请重新生成。');
  const paths = guard.paths;
  const expected = guard.sha256;
  if (
    !Array.isArray(paths) ||
    !paths.every((path) => typeof path === 'string') ||
    typeof expected !== 'string'
  )
    throw new AgentOrchestrationError('Chapter Brief 来源版本无法验证，请重新生成。');
  const context = guard.context;
  const identity = await identityOf(deps, root, target);
  const oversized =
    new TextEncoder().encode(dumpJson(guard, { ensureAscii: false })).length > MAX_MANIFEST_BYTES;
  if (
    oversized ||
    identity.writingContext === null ||
    guard.project_identity_sha256 !== identity.projectIdentitySha256 ||
    guard.target_relative !== identity.writingContext.current_file ||
    !isObj(context) ||
    typeof context.current_file !== 'string' ||
    typeof context.user_message !== 'string'
  )
    throw new AgentOrchestrationError(DRIFT);
  await resolveProjectRoot(deps.reader, root);
  const unchanged = await writingContextSourcesUnchanged(
    deps,
    root,
    context.receipt,
    context.current_file,
    context.user_message,
  );
  if (!unchanged) throw new AgentOrchestrationError(DRIFT);
  if ((await sourceSignature(deps, root, target, paths as string[])) !== expected)
    throw new AgentOrchestrationError(DRIFT);
}

/** 冻结确认后的 Brief 背后的来源，而不只是旧 bundle 里的摘录（chapter_source_guard）。 */
export async function captureChapterSources(
  deps: GuardDeps,
  input: { root: string; target: string; bundle: Obj; snapshot: Obj; userMessage: string },
): Promise<Obj> {
  const { root, target, bundle, snapshot } = input;
  const absolute = nativeProjectPath(root, target, deps.platform);
  const prepared = writingContextFromSnapshot(snapshot as never, {
    projectRoot: root,
    filePath: absolute,
    content: '',
    intent: 'chapter.write',
    platform: deps.platform,
    secrets: deps.secrets,
  });
  const paths = new Set(FIXED_SOURCES);
  for (const item of Array.isArray(bundle.files) ? bundle.files : []) {
    if (!isObj(item)) continue;
    if (String(item.path || '').startsWith('storyforge://llm-context/')) continue;
    try {
      paths.add(normalizeProjectRelativePath(String(item.relative_path || '')));
    } catch (error) {
      if (!(error instanceof FsToolError)) throw error;
      throw new AgentOrchestrationError('Chapter Brief 的来源路径无法验证，请重新生成。');
    }
  }
  const identity = await identityOf(deps, root, target);
  const selected = snapshot.selected_file as Obj;
  const guard: Obj = {
    version: VERSION,
    project_identity_sha256: identity.projectIdentitySha256,
    target_relative: identity.writingContext ? identity.writingContext.current_file : null,
    paths: [...paths].sort(compareCodePoints),
    context: {
      current_file: selected.file_path,
      user_message: redactSensitiveText(input.userMessage, deps.secrets),
      receipt: JSON.parse(prepared.contextReceiptJson!),
    },
  };
  guard.sha256 = await sourceSignature(deps, root, target, guard.paths as string[]);
  // 先采样其他依赖，再校验消费的快照：之后的文件系统观察不能顶替最初的普通 / 知识来源版本。
  await assertChapterSources(deps, root, target, guard);
  return guard;
}

export async function prepareChapterWritingContext(
  deps: GuardDeps,
  input: { root: string; target: string; bundle: Obj; guard: Obj; content: string; intent: string },
): Promise<PreparedWritingContext> {
  await assertChapterSources(deps, input.root, input.target, input.guard);
  return writingContextFromGuardedBundle(input.bundle as never, {
    projectRoot: input.root,
    filePath: nativeProjectPath(input.root, input.target, deps.platform),
    content: input.content,
    intent: input.intent,
    platform: deps.platform,
    contextReceipt: (input.guard.context as Obj).receipt as never,
  });
}
