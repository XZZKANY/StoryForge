import {
  authorEditPolicyFailures,
  authorEditPolicySummary,
  buildAuthorEditPolicy,
  type AuthorEditPolicy,
  type ProtectedSpan,
} from './authorEditPolicy';
import { pythonFixed } from './math';
import { checkProseStaticQuality, type ProseConstraints } from './proseScan';
import { DIALOGUE_PATTERN } from './punctuation';
import { codePoints, countOf, PYTHON_WHITESPACE, pythonStrip } from './pythonText';
import { sequenceOpcodes } from './sequenceMatcher';

export const POLISH_RULE_VERSION = 'polish-rules-v2';
export const POLISH_GATE_VERSION = 'polish-gates-v2';

type SegmentKind = 'body' | 'frontmatter' | 'heading' | 'fenced_block' | 'author_span';
export type PolishSegment = { kind: SegmentKind; text: string };
export type PolishDocument = { original: string; segments: PolishSegment[] };

export type PolishGateConfig = {
  version: string;
  min_char_ratio: number;
  max_char_ratio: number;
  max_total_issue_increase: number;
  narrative_min_tokens: number;
  narrative_dominance_ratio: number;
};

export const DEFAULT_POLISH_GATE_CONFIG: PolishGateConfig = {
  version: POLISH_GATE_VERSION,
  min_char_ratio: 0.85,
  max_char_ratio: 1.15,
  max_total_issue_increase: 0,
  narrative_min_tokens: 4,
  narrative_dominance_ratio: 0.65,
};

export type PolishGateResult = {
  passed: boolean;
  reasons: string[];
  metrics: { [key: string]: unknown };
  gate_version: string;
  advisories: string[];
};

export type PolishCandidate = {
  source: 'local' | 'online';
  text: string;
  responseTruncated?: boolean;
  /** 上游按内容安全拒了（finish_reason=content_filter）：哪怕回来的 JSON 完整也不能用。 */
  responseFiltered?: boolean;
};
export type PolishDecision = {
  status: 'accepted' | 'degraded' | 'noop' | 'rejected';
  selected_source: 'original' | 'local' | 'online';
  text: string;
  degraded: boolean;
  evaluations: { [source: string]: PolishGateResult };
  rule_version: string;
};

export type PolishFacts = {
  protectedEntities?: readonly unknown[];
  characterConstraints?: ProseConstraints['characterConstraints'];
  continuityFacts?: readonly unknown[];
  requiredFacts?: readonly string[];
};

const WS = PYTHON_WHITESPACE;
const NON_WS = `[^${WS.slice(1, -1)}]`;
const FRONTMATTER_BOUNDARY = new RegExp(`^${WS}*(?:---|\\.\\.\\.)${WS}*$`, 'u');
const HEADING = new RegExp(`^${WS}{0,3}#{1,6}${WS}+${NON_WS}`, 'u');
const FENCE_OPEN = new RegExp(`^${WS}{0,3}(\`{3,}|~{3,})`, 'u');
const WHITESPACE_RUNS = new RegExp(`${WS}+`, 'gu');
const MODEL_REPLY_LINES = new Set([
  '以下是润色后的版本：',
  '以下为润色后的版本：',
  '润色后的版本如下：',
  '润色结果：',
]);
const PERSON_TOKENS = /我们|你们|他们|她们|我|你|他|她/gu;
const SENTENCE_SPLIT = /[。！？!?\n]+/u;
const SEVERITY_WEIGHT: Record<string, number> = { 严重: 4, 高: 3, 中: 2, 低: 1 };
const FILLER_MARKERS = [
  '不禁',
  '五味杂陈',
  '值得注意的是',
  '需要指出的是',
  '毋庸置疑',
  '显而易见',
  '命运的齿轮',
  '一切才刚刚开始',
];

const LINE_BREAK = new RegExp(
  '\r\n|[\n\r\u000b\u000c\u001c\u001d\u001e\u0085' + String.fromCharCode(0x2028, 0x2029) + ']',
  'gu',
);
/** str.splitlines(keepends=True)。 */
export function splitlinesKeepends(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    const end = match.index! + match[0].length;
    lines.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

const isProtected = (segment: PolishSegment) => segment.kind !== 'body';

export function polishableParts(document: PolishDocument): string[] {
  return document.segments.filter((segment) => !isProtected(segment)).map((s) => s.text);
}

function findFrontmatterEnd(lines: readonly string[]): number | null {
  for (let index = 1; index < lines.length; index++)
    if (FRONTMATTER_BOUNDARY.test(lines[index])) return index;
  return null;
}

function findFenceEnd(lines: readonly string[], start: number, opener: string): number | null {
  const marker = opener[0] === '`' ? '`' : '~';
  const closing = new RegExp(`^${WS}{0,3}${marker}{${opener.length},}${WS}*$`, 'u');
  for (let index = start + 1; index < lines.length; index++)
    if (closing.test(lines[index])) return index;
  return null;
}

/** 偏移与 TS 版作者编辑政策的保护片段同为 UTF-16 码元，只在本模块内部换算。 */
function protectAuthorSpans(
  document: PolishDocument,
  spans: readonly ProtectedSpan[],
): PolishDocument {
  const segments: PolishSegment[] = [];
  let offset = 0;
  for (const segment of document.segments) {
    const end = offset + segment.text.length;
    let cursor = offset;
    if (isProtected(segment)) segments.push(segment);
    else {
      for (const span of spans) {
        const left = Math.max(span.start, offset);
        const right = Math.min(span.end, end);
        if (left >= right) continue;
        if (cursor < left)
          segments.push({ kind: 'body', text: document.original.slice(cursor, left) });
        segments.push({ kind: 'author_span', text: document.original.slice(left, right) });
        cursor = right;
      }
      if (cursor < end) segments.push({ kind: 'body', text: document.original.slice(cursor, end) });
    }
    offset = end;
  }
  return { original: document.original, segments };
}

/** 把 frontmatter、首个标题和围栏块从可润色正文中完整隔离。 */
export function splitPolishableMarkdown(
  text: string,
  protectedSpans: readonly ProtectedSpan[] = [],
): PolishDocument {
  const lines = splitlinesKeepends(text);
  const segments: PolishSegment[] = [];
  const body: string[] = [];
  const flushBody = () => {
    if (body.length) {
      segments.push({ kind: 'body', text: body.join('') });
      body.length = 0;
    }
  };
  let index = 0;
  if (lines.length && pythonStrip(lines[0]) === '---') {
    const end = findFrontmatterEnd(lines);
    if (end === null) return { original: text, segments: [{ kind: 'frontmatter', text }] };
    segments.push({ kind: 'frontmatter', text: lines.slice(0, end + 1).join('') });
    index = end + 1;
  }
  let headingProtected = false;
  while (index < lines.length) {
    const line = lines[index];
    if (!headingProtected && HEADING.test(line)) {
      flushBody();
      segments.push({ kind: 'heading', text: line });
      headingProtected = true;
      index += 1;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence !== null) {
      flushBody();
      const end = findFenceEnd(lines, index, fence[1]);
      if (end === null) {
        segments.push({ kind: 'fenced_block', text: lines.slice(index).join('') });
        index = lines.length;
        continue;
      }
      segments.push({ kind: 'fenced_block', text: lines.slice(index, end + 1).join('') });
      index = end + 1;
      continue;
    }
    body.push(line);
    index += 1;
  }
  flushBody();
  return protectAuthorSpans({ original: text, segments }, protectedSpans);
}

export function rebuildPolishableMarkdown(
  document: PolishDocument,
  parts: readonly string[],
): string {
  const expected = polishableParts(document).length;
  if (parts.length !== expected)
    throw new RangeError(`正文片段数量不匹配：expected=${expected}, actual=${parts.length}`);
  let next = 0;
  return document.segments
    .map((segment) => (isProtected(segment) ? segment.text : parts[next++]))
    .join('');
}

function cleanBody(text: string, policy: AuthorEditPolicy): string {
  const lines = splitlinesKeepends(text);
  const first = lines.findIndex((line) => pythonStrip(line));
  if (first !== -1 && MODEL_REPLY_LINES.has(pythonStrip(lines[first]))) {
    lines.splice(first, 1);
    if (first < lines.length && !pythonStrip(lines[first])) lines.splice(first, 1);
  }
  let cleaned = lines
    .join('')
    .replace(/，{2,}/gu, '，')
    .replace(/。{2,}/gu, '。');
  if (!policy.preserve_repeated_marks)
    cleaned = cleaned.replace(/！{2,}/gu, '！').replace(/？{2,}/gu, '？');
  return cleaned.replace(/(?<!\.)\.{3}(?!\.)/gu, '……');
}

export function applyDeterministicPolish(
  text: string,
  editPolicy?: AuthorEditPolicy | null,
): string {
  const policy = editPolicy ?? buildAuthorEditPolicy(text);
  const document = splitPolishableMarkdown(text, policy.protected_spans);
  return rebuildPolishableMarkdown(
    document,
    polishableParts(document).map((part) => cleanBody(part, policy)),
  );
}

const bodyText = (document: PolishDocument) => polishableParts(document).join('');
const visibleBodyChars = (document: PolishDocument) =>
  codePoints(bodyText(document).replace(WHITESPACE_RUNS, '')).length;

function protectedSignature(document: PolishDocument): string {
  return JSON.stringify(
    document.segments.filter(isProtected).map((segment) => [segment.kind, segment.text]),
  );
}

function normalizedEntities(entities: readonly unknown[]): string[] {
  return [
    ...new Set(
      entities
        .filter(
          (entity): entity is string => typeof entity === 'string' && Boolean(pythonStrip(entity)),
        )
        .map(pythonStrip),
    ),
  ];
}

function narrativePerson(text: string, config: PolishGateConfig): string {
  const narrative = bodyText(splitPolishableMarkdown(text)).replace(DIALOGUE_PATTERN, '');
  const counts = new Map<string, number>();
  for (const [token] of narrative.matchAll(PERSON_TOKENS))
    counts.set(token, (counts.get(token) ?? 0) + 1);
  const count = (token: string) => counts.get(token) ?? 0;
  const groups: [string, number][] = [
    ['first', count('我') + count('我们')],
    ['second', count('你') + count('你们')],
    ['third', count('他') + count('她') + count('他们') + count('她们')],
  ];
  const total = groups.reduce((sum, [, value]) => sum + value, 0);
  if (total < config.narrative_min_tokens) return 'undetermined';
  // Python max() 取第一个最大值。
  const [person, best] = groups.reduce((top, item) => (item[1] > top[1] ? item : top));
  return best / total >= config.narrative_dominance_ratio ? person : 'mixed';
}

type Issue = { dimension: string; severity: string };

function issuesRegressed(
  original: readonly Issue[],
  candidate: readonly Issue[],
  config: PolishGateConfig,
): boolean {
  const tally = (issues: readonly Issue[]) => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const key = JSON.stringify([issue.dimension, issue.severity]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const weight = (key: string) => SEVERITY_WEIGHT[JSON.parse(key)[1] as string] ?? 0;
  const originalCounts = tally(original);
  const candidateCounts = tally(candidate);
  const serious = (counts: Map<string, number>) =>
    [...counts].reduce((sum, [key, count]) => sum + (weight(key) >= 3 ? count : 0), 0);
  if (serious(candidateCounts) > serious(originalCounts)) return true;
  if (candidate.length > original.length + config.max_total_issue_increase) return true;
  return [...candidateCounts].some(
    ([key, count]) => count > (originalCounts.get(key) ?? 0) && weight(key) >= 2,
  );
}

function repeatedSentenceStarters(text: string): number {
  const starters = new Map<string, number>();
  for (const raw of text.split(SENTENCE_SPLIT)) {
    const sentence = codePoints(pythonStrip(raw));
    if (sentence.length < 2) continue;
    const starter = sentence.slice(0, 2).join('');
    starters.set(starter, (starters.get(starter) ?? 0) + 1);
  }
  return [...starters.values()].reduce((sum, count) => sum + (count >= 3 ? count - 1 : 0), 0);
}

function styleMetricsRegressed(original: string, candidate: string): boolean {
  const fillers = (text: string) =>
    FILLER_MARKERS.reduce((sum, marker) => sum + countOf(text, marker), 0);
  if (fillers(candidate) > fillers(original)) return true;
  return repeatedSentenceStarters(candidate) > Math.max(repeatedSentenceStarters(original), 2);
}

// ---- polish_fact_guards：只认原文能证明的窄矛盾，不做词袋质量判定 ----

const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

function codePointOccurrences(haystack: readonly string[], needle: readonly string[]): number[] {
  const found: number[] = [];
  let index = 0;
  while (index + needle.length <= haystack.length) {
    if (needle.every((char, j) => haystack[index + j] === char)) {
      found.push(index);
      index += needle.length;
    } else index += 1;
  }
  return found;
}

export function entitySpellingChanges(
  original: string,
  candidate: string,
  entities: readonly string[],
): string[] {
  const changed = new Set<string>();
  // 只在改动过的行区域里比字，不做整本书的平方级逐字 diff。
  const before = splitlinesKeepends(original);
  const after = splitlinesKeepends(candidate);
  for (const [tag, left, right, start, end] of sequenceOpcodes(before, after)) {
    if (tag !== 'replace') continue;
    const old = codePoints(before.slice(left, right).join(''));
    const next = codePoints(after.slice(start, end).join(''));
    if (old.length + next.length > 4000) continue; // 长改写或歧义改写只算信号，不算拼写证据。
    const oldText = old.join('');
    const newText = next.join('');
    for (const [operation, a, b, x, y] of sequenceOpcodes(old, next)) {
      if (operation !== 'replace' || b - a !== 1 || y - x !== 1) continue;
      for (const entity of entities) {
        const name = codePoints(entity);
        for (const occurrence of codePointOccurrences(old, name)) {
          if (!(occurrence <= a && a < occurrence + name.length)) continue;
          const offset = a - occurrence;
          const spelling = [...name.slice(0, offset), next[x], ...name.slice(offset + 1)].join('');
          // 受保护名字上恰好替换了一个字，且新拼写确实出现在候选里。
          if (newText.includes(spelling) && !oldText.includes(spelling)) changed.add(entity);
        }
      }
    }
  }
  return entities
    .filter((entity) => changed.has(entity))
    .map((entity) => `protected_entity_changed:${entity}`);
}

const assertions = (text: string) =>
  text
    .split(/[。！？!?；;，,\n]/u)
    .map(pythonStrip)
    .filter(Boolean);

function transferEvents(prose: string, entities: readonly unknown[]): Set<string> {
  const names = entities.filter(
    (name): name is string => typeof name === 'string' && Boolean(pythonStrip(name)),
  );
  if (names.length < 2) return new Set();
  const actors = [...new Set(names)]
    .sort((a, b) => codePoints(b).length - codePoints(a).length)
    .map(escapeRegExp)
    .join('|');
  const pattern = new RegExp(
    `^(?<actor>${actors})(?<negation>没有|并未|没|不)?把(?<object>[^。！？!?，,\\n]{1,40}?)` +
      `(?:交给|递给|送给)(?<recipient>${actors})$`,
    'u',
  );
  const events = new Set<string>();
  for (const clause of assertions(prose)) {
    const match = pattern.exec(clause);
    if (match === null) continue;
    const groups = match.groups!;
    events.add(
      JSON.stringify([
        groups.actor,
        pythonStrip(groups.object),
        groups.recipient,
        Boolean(groups.negation),
      ]),
    );
  }
  return events;
}

const PREDICATE = /属于|持有|已经|能够|在|是|有/u;

export function groundedFactContradictions(
  original: string,
  candidate: string,
  entities: readonly string[],
  facts: readonly unknown[],
): string[] {
  const before = original.replace(DIALOGUE_PATTERN, '');
  const after = candidate.replace(DIALOGUE_PATTERN, '');
  const beforeAssertions = new Set(assertions(before));
  const afterAssertions = new Set(assertions(after));
  const reasons: string[] = [];
  for (const fact of facts) {
    const statement =
      fact !== null && typeof fact === 'object' && !Array.isArray(fact)
        ? (fact as { statement?: unknown }).statement
        : fact;
    if (typeof statement !== 'string') continue;
    for (const assertion of assertions(statement)) {
      if (!beforeAssertions.has(assertion)) continue;
      // 只否定同一断言的谓语；附近的「院里没有人」说明不了「钥匙在林岚手中」。
      const predicate = PREDICATE.exec(assertion);
      if (predicate === null) continue;
      const prefix = assertion.slice(0, predicate.index);
      const suffix = assertion.slice(predicate.index);
      if (!prefix || ['不', '没', '未'].some((marker) => prefix.includes(marker))) continue;
      for (const negation of ['不', '并不', '没有', '并未', '从未']) {
        const contradiction = prefix + negation + suffix;
        if (afterAssertions.has(contradiction) && !beforeAssertions.has(contradiction))
          reasons.push('grounded_fact_contradicted');
      }
    }
  }
  const originalEvents = transferEvents(before, entities);
  // 原文可能本就有往返交接或正反表述，只把新增关系当作润色引入的矛盾。
  const added = new Set([...transferEvents(after, entities)].filter((e) => !originalEvents.has(e)));
  for (const event of originalEvents) {
    const [actor, obj, recipient, negated] = JSON.parse(event) as [string, string, string, boolean];
    if (added.has(JSON.stringify([recipient, obj, actor, negated])) && actor !== recipient)
      reasons.push('event_relation_changed');
    if (added.has(JSON.stringify([actor, obj, recipient, !negated])))
      reasons.push('event_relation_changed');
  }
  return [...new Set(reasons)];
}

// ---- 候选门禁与选择 ----

export function evaluatePolishCandidate(
  original: string,
  candidate: string,
  options: PolishFacts & {
    responseTruncated?: boolean;
    responseFiltered?: boolean;
    config?: PolishGateConfig | null;
    editPolicy?: AuthorEditPolicy | null;
  } = {},
): PolishGateResult {
  const gate = options.config ?? DEFAULT_POLISH_GATE_CONFIG;
  const reasons: string[] = [];
  const advisories: string[] = [];
  const policy = options.editPolicy ?? buildAuthorEditPolicy(original);
  reasons.push(...authorEditPolicyFailures(original, candidate, policy));
  if (!pythonStrip(candidate)) reasons.push('empty_candidate');
  if (options.responseTruncated) reasons.push('response_truncated');
  if (options.responseFiltered) reasons.push('response_filtered');

  const originalDocument = splitPolishableMarkdown(original);
  const candidateDocument = splitPolishableMarkdown(candidate);
  if (protectedSignature(originalDocument) !== protectedSignature(candidateDocument))
    reasons.push('protected_structure_changed');

  const originalChars = visibleBodyChars(originalDocument);
  const candidateChars = visibleBodyChars(candidateDocument);
  const charRatio = candidateChars / Math.max(originalChars, 1);
  if (originalChars && !(gate.min_char_ratio <= charRatio && charRatio <= gate.max_char_ratio))
    reasons.push('word_count_drift');

  const entities = normalizedEntities(options.protectedEntities ?? []);
  const entityDrift = entities.filter(
    (entity) => countOf(original, entity) !== countOf(candidate, entity),
  );
  for (let i = 0; i < entityDrift.length; i++) advisories.push('entity_reference_count_changed');
  reasons.push(...entitySpellingChanges(original, candidate, entities));
  const continuityFacts = options.continuityFacts ?? [];
  const requiredFacts = options.requiredFacts ?? [];
  reasons.push(
    ...groundedFactContradictions(original, candidate, entities, [
      ...continuityFacts,
      ...requiredFacts,
    ]),
  );

  const originalPerson = narrativePerson(original, gate);
  const candidatePerson = narrativePerson(candidate, gate);
  if (originalPerson !== candidatePerson && !policy.allow_person_change) {
    const definite = new Set(['first', 'second', 'third']);
    if (definite.has(originalPerson) && definite.has(candidatePerson))
      reasons.push('narrative_person_changed');
    else advisories.push('narrative_person_uncertain');
  }

  const constraints: ProseConstraints = {
    characterConstraints: options.characterConstraints,
    continuityFacts: continuityFacts as ProseConstraints['continuityFacts'],
    requiredFacts,
  };
  const originalIssues = checkProseStaticQuality(bodyText(originalDocument), constraints);
  const candidateIssues = checkProseStaticQuality(bodyText(candidateDocument), constraints);
  if (issuesRegressed(originalIssues, candidateIssues, gate))
    advisories.push('prose_issue_regressed');
  if (styleMetricsRegressed(bodyText(originalDocument), bodyText(candidateDocument)))
    advisories.push('style_pattern_regressed');

  const uniqueReasons = [...new Set(reasons)];
  return {
    passed: !uniqueReasons.length,
    reasons: uniqueReasons,
    metrics: {
      edit_policy: authorEditPolicySummary(policy),
      original_chars: originalChars,
      candidate_chars: candidateChars,
      char_ratio: Number(pythonFixed(charRatio, 4)),
      protected_entity_drift_count: entityDrift.length,
      original_narrative_person: originalPerson,
      candidate_narrative_person: candidatePerson,
      original_issue_count: originalIssues.length,
      candidate_issue_count: candidateIssues.length,
    },
    gate_version: gate.version,
    advisories: [...new Set(advisories)],
  };
}

export function selectPolishCandidate(
  original: string,
  options: PolishFacts & {
    localCandidate?: PolishCandidate | null;
    onlineCandidate?: PolishCandidate | null;
    config?: PolishGateConfig | null;
    editPolicy?: AuthorEditPolicy | null;
  },
): PolishDecision {
  const { localCandidate = null, onlineCandidate = null, ...facts } = options;
  const candidates = [onlineCandidate, localCandidate].filter(
    (candidate): candidate is PolishCandidate => candidate !== null,
  );
  const evaluations: { [source: string]: PolishGateResult } = {};
  const bySource: { [source: string]: PolishCandidate } = {};
  for (const candidate of candidates) {
    evaluations[candidate.source] = evaluatePolishCandidate(original, candidate.text, {
      ...facts,
      responseTruncated: candidate.responseTruncated ?? false,
      responseFiltered: candidate.responseFiltered ?? false,
    });
    bySource[candidate.source] = candidate;
  }
  const decision = (
    status: PolishDecision['status'],
    source: PolishDecision['selected_source'],
    text: string,
    degraded: boolean,
  ): PolishDecision => ({
    status,
    selected_source: source,
    text,
    degraded,
    evaluations,
    rule_version: POLISH_RULE_VERSION,
  });
  if (evaluations.online?.passed) {
    const online = bySource.online;
    if (online.text === original) return decision('noop', 'original', original, false);
    return decision('accepted', 'online', online.text, false);
  }
  if (evaluations.local?.passed) {
    const local = bySource.local;
    if (local.text === original) return decision('noop', 'original', original, false);
    return decision(
      onlineCandidate !== null ? 'degraded' : 'accepted',
      'local',
      local.text,
      onlineCandidate !== null,
    );
  }
  return decision('rejected', 'original', original, false);
}
