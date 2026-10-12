import type { ProjectReader } from '../readPort';
import { readHooks } from './canonFiles';
import { FsToolError } from './fsTools';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { pythonStrip } from './pythonText';

// 叙事承诺信号：低精度高召回，用于提示而非判决。Python 的 `.` 不含换行但含 \r、U+2028/2029。
const NARRATIVE_PROMISE_PATTERNS: [RegExp, string][] = [
  [/(?:如果|只要|一旦)[^\n]{1,60}(?:就|便|则|一定|必然|必定)/gu, 'conditional_promise'],
  [/(?:还剩|仅剩|还有|只有)[^\n]{0,20}(?:天|日|小时|分钟|秒|年|月)/gu, 'countdown'],
  [/(?:达到|突破|升到|攒够|达到|触发)[^\n]{0,20}(?:触发|开启|解锁|激活|便会|即可)/gu, 'threshold'],
  [/(?:答应|承诺|发誓|保证|约定|立誓|许诺)[^\n]{0,50}(?:一定|会|要|必)/gu, 'oath'],
  [
    /(?:有个[^\n]{0,15}(?:秘密|谜团|真相|隐情)|有[^\n]{0,10}人[^\n]{0,8}(?:身份|来历|目的|秘密))/gu,
    'mystery',
  ],
  [/(?:绝不能|严禁|切勿|千万不能)[^\n]{0,40}(?:否则|一旦|不然|后果)/gu, 'taboo'],
  [/(?:不知道的是|殊不知|无人知晓|没有人知道|只有[^\n]*知道)/gu, 'hidden_info'],
];

const codePointLength = (text: string) => Array.from(text).length;
const isCjk = (char: string) => char >= '一' && char <= '鿿';

function findPatternMatches(text: string): JsonObject[] {
  const matches: JsonObject[] = [];
  for (const [pattern, category] of NARRATIVE_PROMISE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const matched = pythonStrip(match[0]);
      if (codePointLength(matched) < 4) continue;
      matches.push({
        evidence: Array.from(matched).slice(0, 80).join(''),
        category,
        position: codePointLength(text.slice(0, match.index)),
      });
    }
  }
  return matches;
}

/** 仅拒绝空描述或文本完全重复；词面相关不等于同一叙事承诺。 */
export function evaluateHookAdmission(existing: JsonObject, hook: JsonObject) {
  const raw = hook.description;
  const description = typeof raw === 'string' ? pythonStrip(raw).toLowerCase() : '';
  if (!description) return { admitted: false, reason: 'description 不可为空', similar_hook: null };
  const hooks = existing.hooks;
  let related: JsonObject | null = null;
  let reason: string | null = null;
  const chars = new Set(Array.from(description).filter(isCjk));
  for (const item of Array.isArray(hooks) ? hooks : []) {
    if (!isJsonObject(item) || typeof item.description !== 'string') continue;
    const other = pythonStrip(item.description).toLowerCase();
    if (!other) continue;
    // 完全相同优先于先前的相关提示，覆盖所有状态与同批观察。
    if (description === other)
      return { admitted: false, reason: '描述文本完全重复（非语义判定）', similar_hook: item };
    if (related !== null) continue;
    if (description.includes(other) || other.includes(description)) {
      related = item;
      reason = '可能相关：描述子串重合，需核实主体、行为与对象';
    } else {
      const otherChars = new Set(Array.from(other).filter(isCjk));
      const shared = [...chars].filter((char) => otherChars.has(char)).length;
      if (chars.size && otherChars.size && shared / Math.max(chars.size, otherChars.size) > 0.6) {
        related = item;
        reason = '可能相关：中文字符重合，不能据此判定重复';
      }
    }
  }
  return { admitted: true, reason, similar_hook: related };
}

function validateObservedHooks(observed: readonly JsonValue[]): JsonObject[] {
  return observed.map((entry, index) => {
    if (!isJsonObject(entry)) throw new FsToolError(`observed_hooks[${index}] 必须是对象。`);
    const description = entry.description;
    if (typeof description !== 'string' || !pythonStrip(description))
      throw new FsToolError(`observed_hooks[${index}].description 必须是非空字符串。`);
    const verified: JsonObject = { description: pythonStrip(description), status: 'active' };
    for (const key of ['verification', 'category', 'note']) {
      const value = entry[key];
      if (typeof value === 'string' && pythonStrip(value)) verified[key] = pythonStrip(value);
    }
    return verified;
  });
}

/** 把模型观察到的叙事承诺与既有 hooks 做确定性归并；只出提案，不写盘。 */
export async function hooksDelta(
  reader: ProjectReader,
  root: string,
  input: { observedHooks?: readonly JsonValue[] | null; evidenceText?: string | null },
) {
  let existing: JsonObject;
  try {
    existing = await readHooks(reader, root);
  } catch (error) {
    if (!(error instanceof FsToolError)) throw error;
    existing = { version: 1, hooks: [] };
  }
  const existingHooks = Array.isArray(existing.hooks) ? existing.hooks : [];
  const evidence = input.evidenceText;
  const patternHits =
    typeof evidence === 'string' && pythonStrip(evidence) ? findPatternMatches(evidence) : [];
  const newHooks: JsonObject[] = [];
  const duplicates: JsonObject[] = [];
  const relatedHooks: JsonObject[] = [];
  if (input.observedHooks?.length) {
    for (const hook of validateObservedHooks(input.observedHooks)) {
      const admission = evaluateHookAdmission({ hooks: [...existingHooks, ...newHooks] }, hook);
      if (!admission.admitted) {
        duplicates.push(hook);
        continue;
      }
      newHooks.push(hook);
      if (admission.similar_hook !== null)
        relatedHooks.push({
          candidate: hook,
          similar_hook: admission.similar_hook,
          reason: admission.reason,
        });
    }
  }
  const parts: string[] = [];
  if (newHooks.length) parts.push(`检测到 ${newHooks.length} 条新钩子`);
  if (duplicates.length)
    parts.push(`${duplicates.length} 条描述与既有或同批钩子文本完全重复（非语义判定）`);
  if (relatedHooks.length)
    parts.push(`${relatedHooks.length} 条可能相关，已保留为提案，需核实主体、行为与对象`);
  if (patternHits.length) parts.push(`正则模式命中 ${patternHits.length} 处（辅助参考）`);
  if (!newHooks.length && !patternHits.length) parts.push('本章未发现新的叙事承诺信号');
  return {
    new_hooks: newHooks,
    duplicates,
    related_hooks: relatedHooks,
    pattern_hits: patternHits,
    summary: parts.join('；') + '；这些只是提案，hooks.json 未改动——要记进伏笔账需作者自己确认。',
  };
}
