import { MAX_CONTEXT_FILES } from '../kernel/contextValues';
import { FsToolError, nativeProjectPath, resolveScopedPath } from '../kernel/fsTools';
import { MAX_MANIFEST_BYTES, selectionSha256 } from '../kernel/generationSources';
import { dumpJson, pythonEquals, type JsonValue } from '../kernel/json';
import { projectKnowledgeRecoveryReceipt } from '../kernel/knowledgeContext';
import { retrieveProjectKnowledge } from '../kernel/knowledgeRetrieval';
import { collectOrdinaryContext } from '../kernel/ordinaryContext';
import type { SecretContext } from '../kernel/redaction';
import { ProjectReadError, type ProjectReader } from '../readPort';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type RecoveryDeps = {
  readonly reader: ProjectReader;
  readonly platform: 'windows' | 'posix';
  readonly secrets: SecretContext;
};

/** 用同一个有界的公共检索重放实际的知识选择（loop/knowledge_recovery）。 */
async function knowledgeSourcesUnchanged(
  deps: RecoveryDeps,
  root: string,
  receipt: unknown,
  currentFile: string,
  userMessage: string,
): Promise<boolean> {
  if (!isObj(receipt) || receipt.version !== 'writer-context-v1') return false;
  const saved = receipt.knowledge;
  if (!isObj(saved) || saved.version !== 'project-knowledge-selection-v1') return false;
  const target = await resolveScopedPath(deps.reader, root, currentFile);
  // 循环里的查询用相对路径，助手直连用绝对路径；只认哈希对得上的那一个，绝不猜新查询。
  const query = [currentFile, nativeProjectPath(root, target, deps.platform)]
    .map((path) => `${userMessage}\n${path}`)
    .find((value) => selectionSha256(value) === saved.query_sha256);
  if (query === undefined) return false;
  const lists: [string, number][] = [
    ['pinned_paths', MAX_CONTEXT_FILES],
    ['requested_paths', MAX_CONTEXT_FILES],
    ['excluded_ids', 8],
  ];
  for (const [key, limit] of lists) {
    const values = saved[key];
    if (
      !Array.isArray(values) ||
      values.length > limit ||
      values.some((value) => typeof value !== 'string')
    )
      return false;
  }
  const pinnedPaths = saved.pinned_paths as string[];
  const excludedIds = saved.excluded_ids as string[];
  const result = await retrieveProjectKnowledge(deps.reader, root, {
    query,
    pinnedPaths,
    excludedIds,
  });
  const current = projectKnowledgeRecoveryReceipt(result, {
    query,
    pinnedPaths,
    excludedIds,
    requestedPaths: saved.requested_paths as string[],
    platform: deps.platform,
    secrets: deps.secrets,
  });
  return pythonEquals(saved as JsonValue, current as JsonValue);
}

const ORDINARY_OMISSIONS = new Set([
  'unavailable_or_ineligible',
  'unadmitted_source',
  'empty_source',
]);
const STRUCTURED_STATES = new Set([
  'structured',
  'unverified',
  'excluded_by_admission',
  'not_collected',
]);
const sameValue = (left: unknown, right: unknown) => (left ?? null) === (right ?? null);

/** 只核实际的普通读取，不核调用方描述，也不建新基线（loop/ordinary_recovery）。 */
async function ordinarySourcesUnchanged(
  deps: RecoveryDeps,
  root: string,
  receipt: unknown,
): Promise<boolean> {
  if (!isObj(receipt) || receipt.version !== 'writer-context-v1') return false;
  const refs = receipt.source_manifest;
  if (
    !Array.isArray(refs) ||
    new TextEncoder().encode(dumpJson(refs, { ensureAscii: false })).length > MAX_MANIFEST_BYTES ||
    selectionSha256(refs) !== receipt.source_manifest_sha256
  )
    return false; // 缺少旧证据不等于证明来源为空。
  for (const ref of refs) {
    if (!isObj(ref)) return false;
    const state = ref.source_state;
    const disposition = ref.disposition;
    let expectedHash: unknown = null;
    if (state === 'current' && disposition === 'delivered') {
      expectedHash = ref.source_text_sha256;
      if (typeof expectedHash !== 'string' || expectedHash.length !== 64) return false;
    } else if (state === 'unavailable' && disposition === 'omitted') {
      if (!ORDINARY_OMISSIONS.has(String(ref.omission_reason))) return false;
    } else {
      // 结构化准入由知识重放核对；调用方交来的通道与超预算的请求不是独立的磁盘读取。
      if (typeof state !== 'string' || !STRUCTURED_STATES.has(state)) return false;
      continue;
    }
    const path = ref.relative_path;
    if (typeof path !== 'string' || !path || typeof ref.purpose !== 'string') return false;
    const collected = await collectOrdinaryContext(deps.reader, root, {
      contextFiles: [
        {
          relative_path: path,
          kind: ref.purpose,
          selection_source: (ref.selection_source ?? null) as string | null,
        },
      ],
      platform: deps.platform,
      secrets: deps.secrets,
    });
    if (disposition === 'delivered') {
      if (collected.files.length !== 1 || collected.files[0].source_text_sha256 !== expectedHash)
        return false;
    } else {
      const expected = [path, ref.purpose, ref.selection_source, ref.omission_reason];
      if (
        collected.omitted.length !== 1 ||
        !expected.every((value, index) => sameValue(collected.omitted[0][index], value))
      )
        return false;
    }
  }
  return true;
}

/** 冻结写作上下文的共用资格判定：知识与普通来源都没变（loop/generation_recovery）。 */
export async function writingContextSourcesUnchanged(
  deps: RecoveryDeps,
  root: string,
  receipt: unknown,
  currentFile: string,
  userMessage: string,
): Promise<boolean> {
  try {
    return (
      (await knowledgeSourcesUnchanged(deps, root, receipt, currentFile, userMessage)) &&
      (await ordinarySourcesUnchanged(deps, root, receipt))
    );
  } catch (error) {
    if (
      error instanceof FsToolError ||
      error instanceof ProjectReadError ||
      error instanceof TypeError
    )
      return false;
    throw error;
  }
}
