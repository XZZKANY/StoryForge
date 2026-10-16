import {
  BreakdownCancellations,
  executeIdeCommand,
  type IdeCommandDeps,
  type ProjectReader,
} from '@storyforge/engine';
import { slots } from './agent';
import { platform } from './assistant';
import { nativeProjectReader } from './reader';
import { appendShadow, errorName, shadowCheckHeader } from './shadow';
import { overlayProject, type Preimage } from './shadowProject';

/**
 * IDE 命令的影子档（迁移计划 P1-9 / P5-1g）：结果照旧用 Python 的；Python 答完后，引擎在叠加读写口上
 * 用同一份参数再算一遍（写入截在内存、不出网、不写引擎库），比两边的响应体与 `.storyforge/` 文件的最终字节。
 * 拆书要调模型、拆书取消依赖 Python 进程里的登记表，这两个不比。
 */
export const SHADOWED_COMMANDS: ReadonlySet<string> = new Set([
  'audit.open',
  'book.context',
  'book.breakdown.status',
  'canon.refresh',
  'observatory.scan',
  'plan.mark_written',
  'plan.unmark_written',
]);

/**
 * 这些命令读写的 `.storyforge/` 文件。引擎在 Python 之后才复算，所以调用 Python 前先读一份，复算时按改前的样子读；
 * 各命令共用同一组，同时在跑的另一个命令改了它们也不会污染这一次的比对。
 */
export const PREIMAGE_PATHS = [
  '.storyforge/canon/canon.json',
  '.storyforge/canon/hooks.json',
  '.storyforge/canon/derived/dossier.md',
  '.storyforge/canon/derived/presence.json',
  '.storyforge/canon/derived/report.json',
  '.storyforge/canon/derived/observations.json',
  '.storyforge/canon/derived/proposals.json',
  '.storyforge/serial-plan.json',
  '.storyforge/analysis/book-breakdown.json',
] as const;

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** 读改前快照最多挡作者这么久，超时照常调用 Python，这一次不比。 */
export const PREIMAGE_TIMEOUT_MS = 3000;
const MAX_DIFFERENCES = 20;

type Outcome = { result: Record<string, unknown> } | { error: unknown };
type Difference = { [key: string]: string | number | boolean };

function projectRoot(args: Record<string, unknown>): string | null {
  const root = typeof args.project_root === 'string' ? args.project_root.trim() : '';
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(root) ? root : null;
}

async function readFile(reader: ProjectReader, root: string, path: string) {
  const metadata = await reader.inspectProjectPath(root, path);
  if (metadata.targetKind === 'missing') return null;
  if (metadata.targetKind !== 'file') throw new Error('影子档快照的目标不是文件');
  const { bytes, exceeded } = await reader.readProjectBytes(root, path, IMAGE_MAX_BYTES);
  if (exceeded) throw new Error('影子档快照的文件过大');
  return bytes;
}

/** 那组文件此刻的样子，按真实读口解析后的项目相对路径记（与叠加读口对齐）。 */
async function readImage(
  root: string,
  paths: readonly string[],
): Promise<Map<string, Uint8Array | null>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const { resolvedRelativePath } = await nativeProjectReader.resolveProjectPath(root, path);
      return [resolvedRelativePath, await readFile(nativeProjectReader, root, path)] as const;
    }),
  );
  return new Map(entries);
}

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('影子档快照超时')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 时间戳两边各取各的钟，不算差异。 */
function masked(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(masked);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'generated_at' && typeof item === 'string' ? '' : masked(item),
    ]),
  );
}

const MASKED_TIME = /"generated_at": "[^"]*"/g;
const maskedBytes = (bytes: Uint8Array) =>
  new TextEncoder().encode(
    new TextDecoder().decode(bytes).replace(MASKED_TIME, '"generated_at": ""'),
  );

/** 第一处不同的 JSON 位置（只有键名与序号，不带值）。 */
function firstDifference(left: unknown, right: unknown, at: string): string | null {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const found = firstDifference(left[i], right[i], `${at}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      const found = firstDifference(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        at ? `${at}.${key}` : key,
      );
      if (found !== null) return found;
    }
    return null;
  }
  return Object.is(left, right) ? null : at || '(root)';
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function compareResponses(python: Outcome, ts: Outcome): Difference[] {
  if ('error' in python && 'error' in ts)
    return errorText(python.error) === errorText(ts.error)
      ? []
      : [{ path: 'response', kind: 'error_text' }];
  if ('error' in python) return [{ path: 'response', kind: 'missing_error_in_ts' }];
  if ('error' in ts) return [{ path: 'response', kind: 'ts_error', ts_error: errorName(ts.error) }];
  const at = firstDifference(
    masked(python.result),
    masked(JSON.parse(JSON.stringify(ts.result))),
    '',
  );
  return at === null ? [] : [{ path: 'response', kind: 'value', at }];
}

function compareBytes(
  path: string,
  python: Uint8Array | null,
  ts: Uint8Array | null,
): Difference[] {
  if (python === null && ts === null) return [];
  if (python === null) return [{ path, kind: 'missing_in_python' }];
  if (ts === null) return [{ path, kind: 'missing_in_ts' }];
  const left = maskedBytes(python);
  const right = maskedBytes(ts);
  let offset = 0;
  while (offset < left.length && offset < right.length && left[offset] === right[offset]) offset++;
  if (offset === left.length && offset === right.length) return [];
  return [{ path, kind: 'file', python_bytes: python.length, ts_bytes: ts.length, offset }];
}

async function record(
  commandId: string,
  fields: Record<string, unknown>,
  differences: Difference[],
) {
  const check = {
    ...(await shadowCheckHeader('ide.command')),
    step: commandId,
    outcome: differences.length ? 'diff' : 'match',
    ...fields,
  };
  await appendShadow('checks', check);
  if (differences.length)
    await appendShadow('diffs', {
      ...check,
      differences: differences.slice(0, MAX_DIFFERENCES),
      ...(differences.length > MAX_DIFFERENCES ? { truncated: true } : {}),
    });
}

const unavailable = async (commandId: string, reason: string) =>
  appendShadow('checks', {
    ...(await shadowCheckHeader('ide.command')),
    step: commandId,
    outcome: 'unavailable',
    reason,
  });

async function settle(
  commandId: string,
  args: Record<string, unknown>,
  root: string | null,
  preimage: Preimage | null,
  python: Outcome,
): Promise<void> {
  try {
    if (preimage === null) return await unavailable(commandId, 'preimage_failed');
    // 没连上 Python（fetch 的 TypeError）不是行为差异。
    if ('error' in python && python.error instanceof TypeError)
      return await unavailable(commandId, 'python_unreachable');
    // Python 写完的样子：趁作者还没再动手，先把那组文件读下来。
    const after = root === null ? new Map() : await readImage(root, PREIMAGE_PATHS);
    const overlay = overlayProject(nativeProjectReader, preimage);
    const { secrets } = await slots();
    const deps: IdeCommandDeps = {
      reader: overlay.reader,
      writer: overlay.writer,
      secrets,
      platform: platform(),
      now: () => new Date(),
      cancellations: new BreakdownCancellations(),
      breakdownModel: null,
      newAnalysisId: () => '0'.repeat(32),
    };
    const ts: Outcome = await executeIdeCommand(commandId, args, deps).then(
      (result) => ({ result: result as Record<string, unknown> }),
      (error: unknown) => ({ error }),
    );
    const written = overlay.written();
    const extra = root === null ? [] : [...written.keys()].filter((path) => !after.has(path));
    const extraAfter = root === null ? new Map() : await readImage(root, extra);
    const paths = [...new Set([...preimage.keys(), ...written.keys()])].sort();
    const differences = [
      ...compareResponses(python, ts),
      ...paths.flatMap((path) =>
        compareBytes(
          path,
          (after.has(path) ? after.get(path) : extraAfter.get(path)) ?? null,
          written.get(path) ?? preimage.get(path) ?? null,
        ),
      ),
    ];
    await record(
      commandId,
      { python_ok: !('error' in python), ts_ok: !('error' in ts), files: paths.length },
      differences,
    );
  } catch {
    // 记账失败不影响作者：checks 缺行即说明这一次没比上。
  }
}

/** 作者拿到的是 Python 的结果（出错原样抛出）；比对在后台进行。 */
export async function shadowIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
  python: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  if (!SHADOWED_COMMANDS.has(commandId)) return python();
  const root = projectRoot(args);
  const preimage: Preimage | null =
    root === null
      ? new Map()
      : await within(readImage(root, PREIMAGE_PATHS), PREIMAGE_TIMEOUT_MS).catch(() => null);
  let outcome: Outcome;
  try {
    outcome = { result: await python() };
  } catch (error) {
    outcome = { error };
  }
  void settle(commandId, args, root, preimage, outcome);
  if ('error' in outcome) throw outcome.error;
  return outcome.result;
}
