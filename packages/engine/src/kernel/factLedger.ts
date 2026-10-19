import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  JsonFields,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
} from './json';
import { MAX_READ_BYTES } from './projectTree';

/**
 * 事实台账 `.storyforge/canon/facts.json`：检查器顺带抽出、原句核对过的已写事实，起草时带上。
 * 和作者手写的 canon.json 分开放；只由界面写（写前快照、可撤销），引擎只算出写什么。
 */
export const FACTS_LEDGER_PATH = '.storyforge/canon/facts.json';
export const FACTS_LEDGER_VERSION = 1;
/** 章节检查顺带抽出的事实类别（离线回放里检查器实际抽出的那几类）。 */
export const FACT_KINDS = ['生死', '身份', '关系', '持有', '处境', '数值', '来历'];
/**
 * 出现第二种说法就算冲突的类别；其余是状态，新值替代旧值。身份不在里面：检查器会把职位、
 * 境界、等级也记成身份，它们一直在变（回放里第 1 章的「杂役」被拿去比第 226 章）。
 */
const FIXED_KINDS = new Set(['生死', '关系', '来历']);
// disputed：和别的章已记的固定事实对不上，等作者定；不进起草，旧值照旧有效。
const FACT_STATUSES = new Set(['active', 'superseded', 'retired', 'disputed']);

/** 台账格式：被读到的字段类型必须对，否则报错并指出位置；未知字段原样保留。 */
export function checkFactLedger(ledger: JsonObject, source: string): void {
  const fields = new JsonFields(source);
  fields.optionalInteger(fields.member(ledger, 'version'), 'version');
  fields
    .optionalArray(fields.member(ledger, 'checked_chapters'), 'checked_chapters')
    .forEach((value, index) => fields.string(value, `checked_chapters[${index}]`));
  const ids = new Set<string>();
  fields.optionalArray(fields.member(ledger, 'facts'), 'facts').forEach((value, index) => {
    const at = `facts[${index}]`;
    const fact = fields.object(value, at);
    const id = fields.string(fields.member(fact, 'id'), `${at}.id`);
    if (ids.has(id)) throw new InputDomainError(`${source} 的 ${at}.id 和前面重复：${id}`);
    ids.add(id);
    const kind = fields.string(fields.member(fact, 'kind'), `${at}.kind`);
    if (!FACT_KINDS.includes(kind))
      throw new InputDomainError(
        `${source} 的 ${at}.kind 应为 ${FACT_KINDS.join(' / ')} 之一，实际是「${kind}」`,
      );
    fields.string(fields.member(fact, 'subject'), `${at}.subject`);
    fields.optionalString(fields.member(fact, 'attribute'), `${at}.attribute`);
    fields.string(fields.member(fact, 'value'), `${at}.value`);
    fields.optionalString(fields.member(fact, 'object'), `${at}.object`);
    fields.string(fields.member(fact, 'path'), `${at}.path`);
    const status = fields.optionalString(fields.member(fact, 'status'), `${at}.status`);
    if (status !== null && !FACT_STATUSES.has(status))
      throw new InputDomainError(
        `${source} 的 ${at}.status 应为 active / superseded / retired / disputed 之一，实际是「${status}」`,
      );
    for (const key of ['supersedes', 'disputes', 'assertion_type', 'recorded_by', 'recorded_at'])
      fields.optionalString(fields.member(fact, key), `${at}.${key}`);
    fields
      .optionalArray(fields.member(fact, 'evidence'), `${at}.evidence`)
      .forEach((item, position) => {
        const where = `${at}.evidence[${position}]`;
        const evidence = fields.object(item, where);
        fields.string(fields.member(evidence, 'quote'), `${where}.quote`);
        fields.optionalString(fields.member(evidence, 'path'), `${where}.path`);
        fields.optionalInteger(fields.member(evidence, 'start_line'), `${where}.start_line`);
      });
  });
}

/** 界面读到的 facts.json 原文 → 校验过的台账；缺失（null）就是空台账。 */
export function parseFactLedger(text: string | null): JsonObject {
  if (text === null) return { version: FACTS_LEDGER_VERSION, facts: [] };
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_READ_BYTES)
    throw new InputDomainError(`${FACTS_LEDGER_PATH}：文件超过 2 MiB`);
  const ledger = new JsonFields(FACTS_LEDGER_PATH).object(
    parseJsonBytes(bytes, FACTS_LEDGER_PATH),
    '顶层',
  );
  checkFactLedger(ledger, FACTS_LEDGER_PATH);
  return {
    ...ledger,
    version: ledger.version ?? FACTS_LEDGER_VERSION,
    facts: Array.isArray(ledger.facts) ? ledger.facts : [],
  };
}

export function serializeFactLedger(ledger: JsonObject, platform: 'windows' | 'posix'): string {
  const text = dumpJson(ledger, { indent: 2, ensureAscii: false }) + '\n';
  return platform === 'windows' ? text.replace(/\n/g, '\r\n') : text;
}

/**
 * 作者作废一条事实：它不再进起草；它替代过的旧状态重新有效（作废的往往正是记错的新值）。
 * 别的条目原样不动。找不到或已经不是有效事实就报错，不静默写。
 */
export function retireFact(
  ledgerText: string | null,
  factId: string,
  platform: 'windows' | 'posix',
): string {
  const ledger = parseFactLedger(ledgerText);
  const facts = ledger.facts as JsonObject[];
  const target = facts.find((fact) => fact.id === factId);
  if (target === undefined || !isActiveFact(target))
    throw new InputDomainError(`台账里没有这条有效事实（${factId}），可能已经作废或被改过。`);
  const restored = typeof target.supersedes === 'string' ? target.supersedes : null;
  const next = facts.map((fact) => {
    if (fact === target) return { ...fact, status: 'retired' };
    if (fact.id === restored && fact.status === 'superseded') return { ...fact, status: 'active' };
    return fact;
  });
  return serializeFactLedger({ ...ledger, facts: next }, platform);
}

const text = (value: JsonValue | undefined) => (typeof value === 'string' ? value : '');
export const isActiveFact = (fact: JsonObject) => (fact.status ?? 'active') === 'active';

const CN_DIGITS: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CN_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };

/** 一万以内的中文数字（七、十七、二十、一百零五）→ 阿拉伯数字；连写的数字（二〇二六）原样。 */
function chineseNumber(run: string): string {
  let total = 0;
  let digit: number | null = null;
  for (const char of run) {
    if (char === '零' || char === '〇') {
      if (digit !== null) return run;
    } else if (char in CN_DIGITS) {
      if (digit !== null) return run;
      digit = CN_DIGITS[char];
    } else {
      total += (digit ?? 1) * CN_UNITS[char];
      digit = null;
    }
  }
  return String(total + (digit ?? 0));
}

const SKIPPED = /[\s，。、；：！？“”‘’「」『』《》（）()[\]【】,.;:!?"'·…—-]/u;

const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';

/**
 * 比较用的写法：去空白和标点、全角转半角、中文数字转阿拉伯数字。
 * 数字里的小数点和负号留着：1.5 米和 15 米、-10 和 10 不是同一个值。
 */
export function factKey(value: string): string {
  const chars = Array.from(value);
  const half = chars.map((char) => {
    const code = char.codePointAt(0)!;
    return code >= 0xff01 && code <= 0xff5e ? String.fromCodePoint(code - 0xfee0) : char;
  });
  const numeric = (index: number) =>
    (half[index] === '.' && isDigit(half[index - 1]) && isDigit(half[index + 1])) ||
    (half[index] === '-' && isDigit(half[index + 1]) && !isDigit(half[index - 1]));
  let folded = '';
  chars.forEach((char, index) => {
    if (!SKIPPED.test(char) || numeric(index)) folded += half[index];
  });
  return folded.replace(/[零〇一二两三四五六七八九十百千]+/gu, chineseNumber).toLowerCase();
}

export type FactCandidate = {
  kind: string;
  subject: string;
  attribute: string;
  value: string;
  object: string | null;
  quote: string;
  startLine: number;
};

export type FactConflict = { candidate: FactCandidate; existing: JsonObject };

export type FactRecordPlan = {
  ledger: JsonObject;
  /** 新记下、有效的事实。 */
  added: JsonObject[];
  superseded: JsonObject[];
  conflicts: FactConflict[];
  /** 和别的章已记的固定事实对不上、存成待定的（与 conflicts 一一对应）。 */
  disputed: JsonObject[];
  /** 同一章重记时值没变、原句换了：依据换成这次刚核对过的原句（旧原句可能已不在正文里）。 */
  refreshed: JsonObject[];
  /** 这章第一次被记账（抽过就算，哪怕一条新事实都没有）：记进 checked_chapters，补录不再抽它。 */
  newlyChecked: boolean;
  duplicates: number;
};

/**
 * 把一章新核对过的事实并进台账（纯函数，不调模型）：
 * 同值的算已知不重复记；状态类新值替代阅读序上更早的旧值；固定类在别的章已有不同说法时
 * 存成待定（disputed）交给作者，旧值照旧有效（同一章重写过的直接替代）。
 */
export function planFactRecord(input: {
  ledger: JsonObject;
  path: string;
  candidates: readonly FactCandidate[];
  /** 阅读序；不在正文里的路径返回 null。 */
  ordinal: (path: string) => number | null;
  /** 别名 → 本名（canon.json 的实体）。 */
  canonical: (name: string) => string;
  now: string;
  newId: () => string;
}): FactRecordPlan {
  const { path, ordinal, canonical } = input;
  const facts = (input.ledger.facts as JsonObject[]).map((fact) => ({ ...fact }));
  const prior = new Set(facts);
  const ids = new Set(facts.map((fact) => fact.id as string));
  const keyOf = (fact: { kind: string; subject: string; attribute: string }) =>
    [fact.kind, factKey(canonical(fact.subject)), factKey(fact.attribute)].join('|');
  const valueOf = (value: string, object: string | null) =>
    factKey(value) + '|' + factKey(object ? canonical(object) : '');
  const added: JsonObject[] = [];
  const superseded: JsonObject[] = [];
  const conflicts: FactConflict[] = [];
  const disputed: JsonObject[] = [];
  const refreshed: JsonObject[] = [];
  let duplicates = 0;
  const here = ordinal(path);
  const keyed = (fact: JsonObject) =>
    keyOf({ kind: text(fact.kind), subject: text(fact.subject), attribute: text(fact.attribute) });
  const valued = (fact: JsonObject) =>
    valueOf(text(fact.value), (fact.object as string | null) ?? null);
  const nextId = () => {
    let id = `fact_${input.newId().slice(0, 12)}`;
    while (ids.has(id)) id = `fact_${input.newId().slice(0, 12)}`;
    ids.add(id);
    return id;
  };
  const record = (candidate: FactCandidate, fields: JsonObject): JsonObject => ({
    id: nextId(),
    kind: candidate.kind,
    subject: canonical(candidate.subject),
    attribute: candidate.attribute,
    value: candidate.value,
    object: candidate.object === null ? null : canonical(candidate.object),
    path,
    ...fields,
    assertion_type: 'text_observation',
    recorded_by: 'auto',
    evidence: [{ path, quote: candidate.quote, start_line: candidate.startLine }],
    recorded_at: input.now,
  });
  for (const candidate of input.candidates) {
    const key = keyOf(candidate);
    const same = facts.filter((fact) => isActiveFact(fact) && keyed(fact) === key);
    const pending = facts.filter((fact) => fact.status === 'disputed' && keyed(fact) === key);
    const value = valueOf(candidate.value, candidate.object);
    // 已有的说法、已经在等作者定的同一说法，都不再记一遍。
    const known = [...same, ...pending].find((fact) => valued(fact) === value);
    if (known !== undefined) {
      duplicates += 1;
      if (known.path === path && prior.has(known) && firstQuote(known) !== candidate.quote) {
        known.evidence = [{ path, quote: candidate.quote, start_line: candidate.startLine }];
        refreshed.push(known);
      }
      continue;
    }
    if (FIXED_KINDS.has(candidate.kind)) {
      const elsewhere = same.find((fact) => fact.path !== path);
      if (elsewhere) {
        conflicts.push({ candidate, existing: elsewhere });
        const fact = record(candidate, {
          status: 'disputed',
          supersedes: null,
          disputes: elsewhere.id as string,
        });
        facts.push(fact);
        disputed.push(fact);
        continue;
      }
    }
    let status = 'active';
    let supersedes: string | null = null;
    const later: JsonObject[] = [];
    for (const fact of same) {
      const there = ordinal(text(fact.path));
      if (here !== null && there !== null && there > here) {
        status = 'superseded';
        later.push(fact);
        continue;
      }
      fact.status = 'superseded';
      superseded.push(fact);
      supersedes = fact.id as string;
    }
    const fact = record(candidate, { status, supersedes });
    // 补录的是夹在中间的章：插进后面那章的替代链，作废后面那章时回到这一章，而不是更早的说法。
    for (const top of later) {
      let upper = top;
      let lower = facts.find((item) => item.id === upper.supersedes);
      while (lower !== undefined) {
        const there = ordinal(text(lower.path));
        if (here === null || there === null || there <= here) break;
        upper = lower;
        lower = facts.find((item) => item.id === upper.supersedes);
      }
      fact.supersedes = lower === undefined ? null : (lower.id as string);
      upper.supersedes = fact.id as string;
    }
    facts.push(fact);
    added.push(fact);
  }
  const checked = Array.isArray(input.ledger.checked_chapters)
    ? (input.ledger.checked_chapters as string[])
    : [];
  const newlyChecked = !checked.includes(path);
  return {
    ledger: {
      ...input.ledger,
      facts,
      ...(newlyChecked ? { checked_chapters: [...checked, path] } : {}),
    },
    added,
    superseded,
    conflicts,
    disputed,
    refreshed,
    newlyChecked,
    duplicates,
  };
}

function firstQuote(fact: JsonObject): string | null {
  const evidence = Array.isArray(fact.evidence) ? fact.evidence[0] : undefined;
  return isJsonObject(evidence) && typeof evidence.quote === 'string' ? evidence.quote : null;
}

/**
 * 作者处理一条待定事实：accept 以本章为准——它生效，它对上的旧值标为已被替代；
 * reject 保留已记的——它作废。别的条目原样不动；不是待定事实就报错。
 */
export function resolveDisputedFact(
  ledgerText: string | null,
  factId: string,
  choice: 'accept' | 'reject',
  platform: 'windows' | 'posix',
): string {
  const ledger = parseFactLedger(ledgerText);
  const facts = ledger.facts as JsonObject[];
  const target = facts.find((fact) => fact.id === factId);
  if (target === undefined || target.status !== 'disputed')
    throw new InputDomainError(`台账里没有这条待定事实（${factId}），可能已经处理过了。`);
  const keyOf = (fact: JsonObject) =>
    [text(fact.kind), factKey(text(fact.subject)), factKey(text(fact.attribute))].join('|');
  // 以本章为准时替代的是这个属性现在有效的说法——可能已不是当初对上的那条（另一条待定先定成了有效）。
  const current =
    choice === 'accept'
      ? facts.filter(
          (fact) => fact !== target && isActiveFact(fact) && keyOf(fact) === keyOf(target),
        )
      : [];
  const replaced = current.length ? (current[current.length - 1].id as string) : null;
  const next = facts.map((fact) => {
    if (fact === target)
      return choice === 'accept'
        ? { ...fact, status: 'active', supersedes: replaced }
        : { ...fact, status: 'retired' };
    if (current.includes(fact)) return { ...fact, status: 'superseded' };
    return fact;
  });
  return serializeFactLedger({ ...ledger, facts: next }, platform);
}
