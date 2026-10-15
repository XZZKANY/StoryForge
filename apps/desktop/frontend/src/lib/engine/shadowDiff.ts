/**
 * 影子档的比对（迁移计划 §4.2，P5-1）：两侧各自用同一个函数（Python `request_snapshot` /
 * 引擎 `requestSnapshot`）给派发的模型请求做快照，先比摘要；不一致时再找出差在哪里。
 * 只交出结构（字段、位置、长度、条数），不交出正文：差异文件里不会有作者的稿子。
 */

type Json = { [key: string]: unknown };

/** 一次派发给模型的请求快照；`error` 是快照本身没取到（写明哪一侧）。 */
export type PromptCapture =
  | { step: string; streaming: boolean; request: Json; requestDigest: string }
  | { step: string; streaming: boolean; error: string };

export type ShadowDifference = { path: string; kind: string } & {
  [key: string]: string | number | boolean;
};

export type ShadowComparison = {
  outcome: 'match' | 'diff';
  differences: ShadowDifference[];
  truncated: boolean;
};

const MAX_DIFFERENCES = 40;
const SCALAR_FIELDS = ['model', 'temperature', 'max_tokens', 'tool_choice', 'reasoning_effort'];
const MESSAGE_FIELDS = ['tool_calls', 'tool_call_id', 'name'];
const DIGEST = /^[0-9a-f]{64}$/;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Python 交回的 `shadow_requests` / `shadow` 帧；形状不对视为没取到。 */
export function parsePythonCaptures(value: unknown): PromptCapture[] | null {
  if (!Array.isArray(value)) return null;
  const captures: PromptCapture[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.step !== 'string' || typeof item.streaming !== 'boolean')
      return null;
    if (typeof item.error === 'string')
      captures.push({ step: item.step, streaming: item.streaming, error: item.error });
    else if (
      isObject(item.request) &&
      typeof item.request_digest === 'string' &&
      DIGEST.test(item.request_digest)
    )
      captures.push({
        step: item.step,
        streaming: item.streaming,
        request: item.request,
        requestDigest: item.request_digest,
      });
    else return null;
  }
  return captures;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** 第一处不同在哪一行哪一列、两边各有多长一段不同；按码点计，与 Python `len` 一致。 */
function textDifference(path: string, python: string, ts: string): ShadowDifference {
  const a = Array.from(python);
  const b = Array.from(ts);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix += 1;
  const before = a.slice(0, prefix);
  return {
    path,
    kind: 'text',
    python_chars: a.length,
    ts_chars: b.length,
    offset: prefix,
    line: before.filter((char) => char === '\n').length + 1,
    column: prefix - before.lastIndexOf('\n'),
    python_span: a.length - prefix - suffix,
    ts_span: b.length - prefix - suffix,
  };
}

function toolNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((tool) => {
    const fn = isObject(tool) && isObject(tool.function) ? tool.function : null;
    return fn && typeof fn.name === 'string' ? fn.name : '?';
  });
}

function requestDifferences(python: Json, ts: Json): ShadowDifference[] {
  const out: ShadowDifference[] = [];
  for (const field of SCALAR_FIELDS)
    if (!same(python[field], ts[field])) out.push({ path: field, kind: 'value' });

  const pythonMeta = isObject(python.metadata) ? python.metadata : {};
  const tsMeta = isObject(ts.metadata) ? ts.metadata : {};
  for (const key of [...new Set([...Object.keys(pythonMeta), ...Object.keys(tsMeta)])].sort())
    if (!same(pythonMeta[key], tsMeta[key])) out.push({ path: `metadata.${key}`, kind: 'value' });

  const pythonTools = Array.isArray(python.tools) ? python.tools : [];
  const tsTools = Array.isArray(ts.tools) ? ts.tools : [];
  const pythonNames = toolNames(pythonTools);
  const tsNames = toolNames(tsTools);
  if (pythonTools.length !== tsTools.length)
    out.push({ path: 'tools', kind: 'count', python: pythonTools.length, ts: tsTools.length });
  else if (!same(pythonNames, tsNames) && same([...pythonNames].sort(), [...tsNames].sort()))
    out.push({ path: 'tools', kind: 'order' });
  for (const name of [...new Set([...pythonNames, ...tsNames])]) {
    const a = pythonTools[pythonNames.indexOf(name)];
    const b = tsTools[tsNames.indexOf(name)];
    if (a === undefined) out.push({ path: `tools[${name}]`, kind: 'extra_in_ts' });
    else if (b === undefined) out.push({ path: `tools[${name}]`, kind: 'missing_in_ts' });
    else if (!same(a, b)) out.push({ path: `tools[${name}]`, kind: 'value' });
  }

  const pythonMessages = Array.isArray(python.messages) ? python.messages : [];
  const tsMessages = Array.isArray(ts.messages) ? ts.messages : [];
  if (pythonMessages.length !== tsMessages.length)
    out.push({
      path: 'messages',
      kind: 'count',
      python: pythonMessages.length,
      ts: tsMessages.length,
    });
  const shared = Math.min(pythonMessages.length, tsMessages.length);
  for (let index = 0; index < shared; index += 1) {
    const a: unknown = pythonMessages[index];
    const b: unknown = tsMessages[index];
    const path = `messages[${index}]`;
    if (!isObject(a) || !isObject(b)) {
      if (!same(a, b)) out.push({ path, kind: 'value' });
      continue;
    }
    if (a.role !== b.role)
      out.push({ path: `${path}.role`, kind: 'value', python: String(a.role), ts: String(b.role) });
    if (typeof a.content === 'string' && typeof b.content === 'string') {
      if (a.content !== b.content)
        out.push(textDifference(`${path}.content`, a.content, b.content));
    } else if (!same(a.content, b.content)) out.push({ path: `${path}.content`, kind: 'value' });
    for (const field of MESSAGE_FIELDS)
      if (!same(a[field], b[field])) out.push({ path: `${path}.${field}`, kind: 'value' });
  }
  return out;
}

/** 两侧都没派发也算一致（这次本来就不调模型）；只有一侧取到快照就是差异。 */
export function compareCaptures(
  python: PromptCapture | null,
  ts: PromptCapture | null,
): ShadowComparison {
  const differences: ShadowDifference[] = [];
  if (python === null && ts === null) return { outcome: 'match', differences, truncated: false };
  if (python === null) differences.push({ path: 'request', kind: 'extra_in_ts' });
  else if (ts === null) differences.push({ path: 'request', kind: 'missing_in_ts' });
  else {
    if (python.step !== ts.step) differences.push({ path: 'step', kind: 'value' });
    if (python.streaming !== ts.streaming) differences.push({ path: 'streaming', kind: 'value' });
    if ('error' in python || 'error' in ts) {
      if ('error' in python)
        differences.push({ path: 'request', kind: 'capture_failed', side: 'python' });
      if ('error' in ts) differences.push({ path: 'request', kind: 'capture_failed', side: 'ts' });
    } else if (python.requestDigest !== ts.requestDigest) {
      const found = requestDifferences(python.request, ts.request);
      // 解析后的值相同而摘要不同：差在编码（比如 1.0 写成了 1）。
      differences.push(...(found.length ? found : [{ path: 'request', kind: 'encoding' }]));
    }
  }
  return {
    outcome: differences.length ? 'diff' : 'match',
    differences: differences.slice(0, MAX_DIFFERENCES),
    truncated: differences.length > MAX_DIFFERENCES,
  };
}
