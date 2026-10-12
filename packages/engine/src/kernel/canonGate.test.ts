import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-canon-gate.json';
import { checkCanon } from './canonGate';
import {
  InputDomainError,
  JsonFloat,
  parseJson,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
} from './json';
import { fromPythonFact, type TypedValue } from './pythonFacts.test-support';

type Case = {
  id: string;
  canon_json: string;
  presence_json?: string;
  presence_bytes_hex?: string;
  output?: TypedValue;
  error?: { type: string; message: string };
};
const cases = golden.cases as Case[];

// 迁移计划 §4.3.1 的另一份独立表述：只看输入，不调用被测实现的校验。
const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof JsonFloat);
const isInt = (v: JsonValue | undefined) => typeof v === 'number';
const isText = (v: JsonValue | undefined) => typeof v === 'string';
const optional = (v: JsonValue | undefined, test: (v: JsonValue | undefined) => boolean) =>
  v === undefined || v === null || test(v);
const objects = (v: JsonValue | undefined): JsonObject[] | null =>
  v === undefined || v === null ? [] : Array.isArray(v) && v.every(isObject) ? v : null;

function inDomain(canon: JsonValue, presence: JsonValue): boolean {
  if (!isObject(canon) || !isObject(presence)) return false;
  const invariants = canon.invariants ?? {};
  if (!isObject(invariants)) return false;
  const holders = objects(invariants.single_holder);
  const edges = objects(invariants.timeline_order);
  const lifespans = objects(invariants.lifespan);
  const entities = objects(presence.entities);
  if (!holders || !edges || !lifespans || !entities) return false;
  return (
    holders.every(
      (e) =>
        isText(e.item) &&
        isText(e.holder) &&
        optional(e.from_chapter, isInt) &&
        optional(e.to_chapter, isInt),
    ) &&
    edges.every((e) => isText(e.before) && isText(e.after)) &&
    lifespans.every(
      (e) => isText(e.entity) && isInt(e.exits_after_chapter) && optional(e.reason, isText),
    ) &&
    entities.every(
      (e) =>
        optional(e.id, isText) &&
        optional(e.canonical_name, isText) &&
        (objects(e.occurrences)?.every(
          (o) => isText(o.path) && optional(o.chapter, isInt) && optional(o.first_line, isInt),
        ) ??
          false),
    )
  );
}

function parse(row: Case): [JsonValue, JsonValue] | null {
  try {
    const presence = row.presence_bytes_hex
      ? parseJsonBytes(
          Uint8Array.from(row.presence_bytes_hex.match(/../g)!, (byte) => parseInt(byte, 16)),
          'presence.json',
        )
      : parseJson(row.presence_json!, 'presence.json');
    return [parseJson(row.canon_json, 'canon.json'), presence];
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    return null;
  }
}

describe('actual Python canon gate under the input domain', () => {
  it('splits the Python cases into 194 in-domain and 648 out-of-domain', () => {
    const inside = cases.filter((row) => {
      const parsed = parse(row);
      return parsed !== null && inDomain(...parsed);
    });
    expect([inside.length, cases.length - inside.length]).toEqual([194, 648]);
    // Python 报过错的用例全在范围外：范围内没有需要模仿的 Python 异常。
    expect(inside.filter((row) => row.error)).toEqual([]);
  });
  for (const row of cases) {
    it(row.id, async () => {
      const parsed = parse(row);
      if (parsed === null) return;
      if (!inDomain(...parsed)) {
        await expect(checkCanon(...parsed)).rejects.toThrow(InputDomainError);
        return;
      }
      expect(await checkCanon(...parsed)).toEqual(fromPythonFact(row.output!));
    });
  }
});

it('names the offending field of an out-of-domain declaration', async () => {
  const canon = parseJson(
    '{"invariants":{"single_holder":[{"item":"玉佩","holder":"林舟","from_chapter":true}]}}',
    'canon.json',
  );
  await expect(checkCanon(canon, parseJson('{}', 'presence.json'))).rejects.toThrow(
    '.storyforge/canon/canon.json 的 invariants.single_holder[0].from_chapter 应为整数，实际是布尔值',
  );
});
