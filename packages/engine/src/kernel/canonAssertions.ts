import { FsToolError } from './fsTools';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { PYTHON_WHITESPACE, pythonStrip } from './pythonText';

const ASSERTION_LABELS: Readonly<Record<string, string>> = {
  author_setting: '作者设定',
  text_observation: '文本观察',
  model_inference: '模型推断（待核实）',
  unknown: '来源类型未知',
};

/** 工具 schema 共用：逐条断言的来源类型与依据（P3 搬工具 schema 时逐字节对照）。 */
export const ASSERTION_METADATA_PROPERTIES = {
  assertion_type: {
    type: 'string',
    enum: Object.keys(ASSERTION_LABELS),
    description:
      '逐条区分作者设定、文本观察与模型推断；无法判断用 unknown。作者接受不改变来源类型。',
  },
  evidence: {
    type: 'array',
    description:
      '支持本条断言的原文引用，不是实体提及位置或送达记录；没有依据不要编造。工具不验证引文或蕴含关系。',
    items: {
      type: 'object',
      properties: {
        quote: { type: 'string', minLength: 1 },
        path: { type: 'string', description: '作品内相对路径（可选），不可越界。' },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
      },
      required: ['quote'],
    },
  },
} as const;

const METADATA_KEYS = Object.keys(ASSERTION_METADATA_PROPERTIES);
const isInt = (value: JsonValue | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const own = (entry: JsonObject, key: string) =>
  Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : undefined;
const splitWords = (text: string) =>
  text.split(new RegExp(`${PYTHON_WHITESPACE}+`, 'u')).filter(Boolean);
const slicePoints = (text: string, end: number) => Array.from(text).slice(0, end).join('');

/** 原样保留已给出的字段，不替历史声明补造来源。 */
export function assertionMetadata(entry: JsonObject): JsonObject {
  const output: JsonObject = Object.create(null);
  for (const key of METADATA_KEYS) {
    const value = own(entry, key);
    if (value !== undefined) output[key] = structuredClone(value);
  }
  return output;
}

/** 校验模型/作者提交的断言元数据；引用只做词法上的项目内检查，从不打开路径。 */
export function normalizeAssertionMetadata(entry: JsonObject, label: string): JsonObject {
  const metadata = assertionMetadata(entry);
  if ('assertion_type' in metadata) {
    const kind = metadata.assertion_type;
    if (typeof kind !== 'string' || !(kind in ASSERTION_LABELS))
      throw new FsToolError(
        `${label}.assertion_type 必须是 author_setting / text_observation / model_inference / unknown。`,
      );
  }
  if (!('evidence' in metadata)) return metadata;
  const evidence = metadata.evidence;
  if (!Array.isArray(evidence)) throw new FsToolError(`${label}.evidence 必须是数组。`);
  evidence.forEach((source, index) => {
    const sourceLabel = `${label}.evidence[${index}]`;
    const quote = isJsonObject(source) ? own(source, 'quote') : undefined;
    if (!isJsonObject(source) || typeof quote !== 'string' || !pythonStrip(quote))
      throw new FsToolError(`${sourceLabel}.quote 必须是非空字符串。`);
    const rawPath = own(source, 'path');
    if (rawPath !== undefined) {
      if (typeof rawPath !== 'string' || !pythonStrip(rawPath))
        throw new FsToolError(`${sourceLabel}.path 必须是非空的作品内相对路径。`);
      const path = rawPath.replace(/\\/g, '/');
      const parts = path.split('/').filter((part) => part !== '' && part !== '.');
      if (
        path.startsWith('/') ||
        /^[A-Za-z]:/.test(path) ||
        path.startsWith('//') ||
        parts.includes('..') ||
        path.includes(':') ||
        path.includes('\u0000')
      )
        throw new FsToolError(`${sourceLabel}.path 必须是作品内相对路径。`);
    }
    for (const key of ['start_line', 'end_line']) {
      const line = own(source, key);
      if (line === undefined) continue;
      if (!isInt(line) || line < 1 || rawPath === undefined)
        throw new FsToolError(`${sourceLabel}.${key} 必须是带 path 的正整数行号。`);
    }
    const start = own(source, 'start_line');
    const end = own(source, 'end_line');
    if (end !== undefined && (start === undefined || (end as number) < (start as number)))
      throw new FsToolError(`${sourceLabel}.end_line 需要 start_line 且不能早于它。`);
  });
  return metadata;
}

/** 只截断展示，不改声明；容忍旧作者 JSON 里的非标准值。 */
export function renderAssertionMetadata(entry: JsonObject): string {
  const kind = own(entry, 'assertion_type');
  const label =
    typeof kind === 'string' && kind in ASSERTION_LABELS
      ? ASSERTION_LABELS[kind]
      : ASSERTION_LABELS.unknown;
  const raw = own(entry, 'evidence');
  const sources = (Array.isArray(raw) ? raw : []).filter(
    (source): source is JsonObject =>
      isJsonObject(source) &&
      typeof own(source, 'quote') === 'string' &&
      Boolean(pythonStrip(own(source, 'quote') as string)),
  );
  if (!sources.length) return `${label}；依据未提供`;
  const refs = sources.slice(0, 2).map((source) => {
    const path = own(source, 'path');
    let location =
      typeof path === 'string' ? slicePoints(splitWords(path).join(' '), 160) : '位置未提供';
    const start = own(source, 'start_line');
    const end = own(source, 'end_line');
    if (isInt(start)) {
      location += `:${start}`;
      if (isInt(end) && end !== start) location += `–${end}`;
    }
    const quote = splitWords(own(source, 'quote') as string).join(' ');
    const snippet = slicePoints(quote, 120) + (Array.from(quote).length > 120 ? '…' : '');
    return `${location}「${snippet}」`;
  });
  const omitted = sources.length > 2 ? `；另 ${sources.length - 2} 条依据未展开` : '';
  return `${label}；声明所附依据（未核验）：${refs.join('；')}${omitted}`;
}

/** 与场景窗口过滤相同的生效缺省。 */
export function formatChapterWindow(entry: JsonObject): string {
  const from = own(entry, 'from_chapter');
  const to = own(entry, 'to_chapter');
  const start = isInt(from) ? from : 1;
  return isInt(to) ? `第 ${start}–${to} 章` : `第 ${start} 章起（未声明终止）`;
}
