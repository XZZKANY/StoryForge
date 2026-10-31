import { compareCodePoints, isObj, JsonFloat, type Obj } from '../../kernel/json';
import { llmContextSnapshotTraceSummary } from '../../kernel/llmContext';
import { compactText, cpLen, pythonStrip } from '../../kernel/pythonText';
import {
  isSensitiveKey,
  REDACTED,
  redactSensitiveText,
  type SecretContext,
} from '../../kernel/redaction';
import { AgentOrchestrationError, optionalString } from '../runPayloads';
import { listLoopToolSpecs } from './catalog';

/** Python 的 int 包含 bool；非整数的 number 视为 float。 */
const isPyInt = (value: unknown): value is number | boolean =>
  typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value));

/** 后端独占的参数：模型给了也在进执行与证据之前丢掉。 */
export const PROTECTED_LOOP_TOOL_ARGUMENT_KEYS = new Set([
  '_agent_intent',
  '_trace_file_path',
  // `confirmed` 是唯一能把模型参数变成权限授予的键，必须只来自作者确认回执。
  'confirmed',
  'user_confirmed',
  'use_main_model',
  'online_enabled',
  'protected_entities',
  'character_constraints',
  'continuity_facts',
  'required_facts',
  'content',
  'context_bundle',
  'context_provenance',
  'file_path',
  'llm_context_snapshot',
  'llm_prompt_context_bundle',
  'prepared_context',
  'generation_delivery_refs',
  'project_root',
  'loop_input_mode',
  'loop_trusted_context',
  'loop_trace_owner',
]);
export const TRUSTED_WRITING_CONTEXT_TOOL_NAMES = new Set(
  listLoopToolSpecs()
    .filter((spec) => spec.loop_trusted_context)
    .map((spec) => spec.name),
);
export const HANDLER_OWNED_TRACE_TOOL_NAMES = new Set(
  listLoopToolSpecs()
    .filter((spec) => spec.loop_trace_owner === 'handler')
    .map((spec) => spec.name),
);

export const sanitizeLoopToolArguments = (args: Obj): Obj =>
  Object.fromEntries(
    Object.entries(args).filter(([key]) => !PROTECTED_LOOP_TOOL_ARGUMENT_KEYS.has(key)),
  );

/**
 * 模型给的整数参数容错：整数直接用，「-12」这类十进制字符串转换，其余回退默认值。
 * Python 的 str.isdigit 还认全角 / 上标等数字（其中一部分转换时会抛错），这里只认 ASCII。
 */
export function fsIntArg(payload: Obj, key: string, fallback: number): number {
  const value = payload[key];
  // JS 的布尔值不是 number，Python 里要单独排除的 bool 在这里天然走回退。
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?[0-9]+$/.test(pythonStrip(value))) {
    const parsed = Number(pythonStrip(value));
    return Number.isSafeInteger(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** 从前端上下文包拼一段对话用的摘录；没有就返回空串。 */
export function chatContextBlock(args: Obj): string {
  const bundle = args.context_bundle;
  if (!isObj(bundle) || !Array.isArray(bundle.files)) return '';
  const entries: string[] = [];
  for (const item of bundle.files) {
    if (!isObj(item)) continue;
    const excerpt = compactText(item.excerpt, 1500);
    if (!excerpt) continue;
    const rel = optionalString(item.relative_path) ?? optionalString(item.path) ?? '（未命名）';
    const kind = optionalString(item.kind);
    entries.push(`### ${rel}${kind ? `（${kind}）` : ''}\n<<<\n${excerpt}\n>>>`);
  }
  return entries.join('\n\n');
}

const missing = (key: string) => new AgentOrchestrationError(`Agent intent 缺少参数：${key}。`);

export function requiredString(args: Obj, key: string): string {
  const value = args[key];
  if (typeof value === 'string' && pythonStrip(value)) return value;
  throw missing(key);
}

/** 必须是字符串但允许空串：空文件的正文本来就是空的。 */
export function requiredText(args: Obj, key: string): string {
  const value = args[key];
  if (typeof value === 'string') return value;
  throw missing(key);
}

export function requiredInt(args: Obj, key: string): number | boolean {
  const value = args[key];
  if (isPyInt(value) && Number(value) > 0) return value;
  throw missing(key);
}

export const optionalPositiveInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

export const optionalInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/** 压缩修订的指令模板。 */
export const trimProseInstruction = (targetPercent: number): string =>
  `将本章字数压缩 ${targetPercent}%，要求：\n` +
  '- 保留所有剧情信息、情感高潮、人物动作\n' +
  '- 砍掉冗余的副词（「他愤怒地说」→「他说」或直接用动作语气带）\n' +
  '- 砍掉情绪声明句（「她感到恐惧」→ 用生理反应/环境暗示替代）\n' +
  '- 每段不超过 5 句（长段落拆开，除非是刻意营造的紧迫感）\n' +
  '- 不要删除对话和关键描写\n' +
  `- 在回复末尾给出字数审计报告：原字数 → 压缩后字数 → 压缩率（目标 ${targetPercent}%）`;

/** 落证据的参数摘要：敏感键遮掉，正文只记长度，长串截断脱敏，容器只记形状。 */
export function safeSummary(payload: Obj, secrets: SecretContext): Obj {
  const summary: Obj = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isSensitiveKey(key)) summary[key] = REDACTED;
    else if (key === 'content' && typeof value === 'string') summary.content_chars = cpLen(value);
    else if (typeof value === 'string')
      summary[key] = redactSensitiveText(compactText(value, 240), secrets);
    else if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof JsonFloat
    )
      summary[key] = value;
    else if (Array.isArray(value)) summary[key] = { count: value.length };
    else if (isObj(value))
      summary[key] = { keys: Object.keys(value).sort(compareCodePoints).slice(0, 20) };
  }
  return summary;
}

export function llmContextInputSummary(snapshot: unknown): Obj {
  if (!isObj(snapshot)) return {};
  const snapshotId = snapshot.snapshot_id;
  if (typeof snapshotId !== 'string' || !snapshotId) return {};
  const summary = llmContextSnapshotTraceSummary(snapshot as never) as Obj;
  const files = summary.context_files;
  const knowledge = summary.knowledge_entries;
  return {
    llm_context_snapshot_id: snapshotId,
    context_provenance: {
      snapshot_id: snapshotId,
      context_file_count: summary.context_file_count,
      context_files: Array.isArray(files) ? files : [],
      context_source: 'request_bundle',
      knowledge_entry_count: Array.isArray(knowledge) ? knowledge.length : 0,
      knowledge_entries: Array.isArray(knowledge)
        ? knowledge.filter(isObj).map((item) => ({ ...item, snapshot_id: snapshotId }))
        : [],
      warning_count: summary.warning_count,
      source_manifest: summary.source_manifest,
      selected_content_sha256: summary.selected_content_sha256,
    },
  };
}

export const dictList = (value: unknown): Obj[] =>
  Array.isArray(value) ? value.filter(isObj) : [];
export const payloadList = dictList;

export function styleRules(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const rules: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && pythonStrip(item)) rules.push(pythonStrip(item));
    else if (isObj(item) && typeof item.rule === 'string' && pythonStrip(item.rule))
      rules.push(pythonStrip(item.rule));
  }
  return rules;
}
