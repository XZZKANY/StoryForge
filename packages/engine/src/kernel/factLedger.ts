import {
  dumpJson,
  InputDomainError,
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
const FACT_STATUSES = new Set(['active', 'superseded', 'retired']);

/** 台账格式：被读到的字段类型必须对，否则报错并指出位置；未知字段原样保留。 */
export function checkFactLedger(ledger: JsonObject, source: string): void {
  const fields = new JsonFields(source);
  fields.optionalInteger(fields.member(ledger, 'version'), 'version');
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
        `${source} 的 ${at}.status 应为 active / superseded / retired 之一，实际是「${status}」`,
      );
    for (const key of ['supersedes', 'assertion_type', 'recorded_by', 'recorded_at'])
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

/** 比较用的写法：去空白和标点、全角转半角、中文数字转阿拉伯数字。 */
export function factKey(value: string): string {
  let folded = '';
  for (const char of value) {
    if (SKIPPED.test(char)) continue;
    const code = char.codePointAt(0)!;
    folded += code >= 0xff01 && code <= 0xff5e ? String.fromCodePoint(code - 0xfee0) : char;
  }
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
  added: JsonObject[];
  superseded: JsonObject[];
  conflicts: FactConflict[];
  duplicates: number;
};

/**
 * 把一章新核对过的事实并进台账（纯函数，不调模型）：
 * 同值的算已知不重复记；状态类新值替代阅读序上更早的旧值；固定类在别的章已有不同说法时
 * 不记、交给作者（同一章重写过的直接替代）。
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
  const ids = new Set(facts.map((fact) => fact.id as string));
  const keyOf = (fact: { kind: string; subject: string; attribute: string }) =>
    [fact.kind, factKey(canonical(fact.subject)), factKey(fact.attribute)].join('|');
  const valueOf = (value: string, object: string | null) =>
    factKey(value) + '|' + factKey(object ? canonical(object) : '');
  const added: JsonObject[] = [];
  const superseded: JsonObject[] = [];
  const conflicts: FactConflict[] = [];
  let duplicates = 0;
  const here = ordinal(path);
  for (const candidate of input.candidates) {
    const key = keyOf(candidate);
    const same = facts.filter(
      (fact) =>
        isActiveFact(fact) &&
        keyOf({
          kind: text(fact.kind),
          subject: text(fact.subject),
          attribute: text(fact.attribute),
        }) === key,
    );
    const value = valueOf(candidate.value, candidate.object);
    if (
      same.some(
        (fact) => valueOf(text(fact.value), (fact.object as string | null) ?? null) === value,
      )
    ) {
      duplicates += 1;
      continue;
    }
    if (FIXED_KINDS.has(candidate.kind)) {
      const elsewhere = same.find((fact) => fact.path !== path);
      if (elsewhere) {
        conflicts.push({ candidate, existing: elsewhere });
        continue;
      }
    }
    let id = `fact_${input.newId().slice(0, 12)}`;
    while (ids.has(id)) id = `fact_${input.newId().slice(0, 12)}`;
    ids.add(id);
    let status = 'active';
    let supersedes: string | null = null;
    for (const fact of same) {
      const there = ordinal(text(fact.path));
      if (here !== null && there !== null && there > here) {
        status = 'superseded';
        continue;
      }
      fact.status = 'superseded';
      superseded.push(fact);
      supersedes = fact.id as string;
    }
    const fact: JsonObject = {
      id,
      kind: candidate.kind,
      subject: canonical(candidate.subject),
      attribute: candidate.attribute,
      value: candidate.value,
      object: candidate.object === null ? null : canonical(candidate.object),
      path,
      status,
      supersedes,
      assertion_type: 'text_observation',
      recorded_by: 'auto',
      evidence: [{ path, quote: candidate.quote, start_line: candidate.startLine }],
      recorded_at: input.now,
    };
    facts.push(fact);
    added.push(fact);
  }
  return { ledger: { ...input.ledger, facts }, added, superseded, conflicts, duplicates };
}
