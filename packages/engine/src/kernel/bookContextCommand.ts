import type { ProjectReader } from '../readPort';
import { buildBookContext } from './buildBookContext';
import { toBookContextPayload } from './bookContext';
import { InputDomainError, isWellFormedText, MAX_JSON_DEPTH } from './json';
import { pythonStrip } from './pythonText';
import { redactSensitive, type PlainJson, type SecretContext } from './redaction';

export class IdeCommandExecutionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IdeCommandExecutionError';
  }
}

/** 参数来自浏览器 JSON：键与字符串须是合法 Unicode，嵌套不超过 64 层（迁移计划 §4.3.1）。 */
export function assertArgsInDomain(commandId: string, value: PlainJson, depth = 0): void {
  if (typeof value === 'string') {
    if (!isWellFormedText(value))
      throw new IdeCommandExecutionError(`${commandId} 的参数里有孤立的代理码点。`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (depth >= MAX_JSON_DEPTH)
    throw new IdeCommandExecutionError(`${commandId} 的参数嵌套超过 ${MAX_JSON_DEPTH} 层。`);
  const entries: [string, PlainJson][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, item] of entries) {
    if (!isWellFormedText(key))
      throw new IdeCommandExecutionError(`${commandId} 的参数里有孤立的代理码点。`);
    assertArgsInDomain(commandId, item, depth + 1);
  }
}

/** Serialized book.context response only. No routing, config reads, model calls or writes.
 * The caller must already own a complete ordered secret snapshot.
 */
export async function executeBookContextCommand(
  reader: ProjectReader,
  args: Record<string, unknown>,
  secrets: SecretContext,
  platform: 'windows' | 'posix',
) {
  // Match the existing HTTP request's JSON boundary, including omitted undefined/toJSON values.
  const request = JSON.parse(JSON.stringify({ args })) as { args?: unknown };
  const supplied = request.args === undefined ? {} : request.args;
  if (supplied === null || Array.isArray(supplied) || typeof supplied !== 'object')
    throw new IdeCommandExecutionError('API 返回 422', 422);
  const original = supplied as { [key: string]: PlainJson };
  assertArgsInDomain('book.context', original);
  const projectRoot = original.project_root;
  if (typeof projectRoot !== 'string' || !pythonStrip(projectRoot))
    throw new IdeCommandExecutionError('book.context 需要 project_root。');
  const root = pythonStrip(projectRoot);
  const absolute = platform === 'windows' ? /^(?:[a-z]:[\\/]|\\\\)/i : /^\//;
  if (!absolute.test(root))
    throw new IdeCommandExecutionError('book.context 的 project_root 必须是绝对路径。');
  // 相对的 current_file 按项目根解析（Python 按进程工作目录解析属于意外，不复刻）。
  const current =
    typeof original.current_file === 'string' ? pythonStrip(original.current_file) || null : null;

  try {
    const context = await buildBookContext(reader, root, current, platform);
    if (context === null) throw new IdeCommandExecutionError(`读不到作品：${root}`);

    const extra = redactSensitive({ book_context: toBookContextPayload(context) }, secrets) as {
      [key: string]: PlainJson;
    };
    const payload: { [key: string]: PlainJson } = {
      title: '读取作品底座',
      category: 'Manuscript',
      writes: false,
      args: redactSensitive(original, secrets),
      ...extra,
    };
    // _accepted_command_result redacts args/extra, then payload; the field serializer redacts again.
    const serialized = redactSensitive(redactSensitive(payload, secrets), secrets);
    return {
      command_id: 'book.context',
      status: 'accepted',
      audit_event_id: null,
      payload: serialized,
    };
  } catch (error) {
    if (error instanceof IdeCommandExecutionError) throw error;
    // 作者声明写错：把指出位置的原文交给作者，不吞成空结果。
    if (error instanceof InputDomainError)
      throw new IdeCommandExecutionError(error.message, 400, error);
    // Match the existing frontend's generic HTTP-500 display, but retain the internal cause.
    throw new IdeCommandExecutionError('API 返回 500', 500, error);
  }
}
