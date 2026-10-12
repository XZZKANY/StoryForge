import { assertionMetadata, formatChapterWindow, renderAssertionMetadata } from './canonAssertions';
import type { Presence, PresenceEntity } from './canonRebuild';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { pythonStrip } from './pythonText';

/** 每实体最多列这么多处出现，避免长书把派生文件撑爆（超出只留计数）。 */
const MAX_PROVENANCE = 20;

export type Dossier = {
  id: string;
  canonical_name: string | null;
  metadata: JsonObject;
  kind: string | null;
  aliases: string[];
  appearance: {
    missing: boolean;
    total_count: number;
    first_chapter: number | null;
    last_chapter: number | null;
  };
  holdings: { item: string; entry: JsonObject }[];
  lifespan: { exits_after_chapter: number; reason: string | null; entry: JsonObject } | null;
  provenance: { path: string; chapter: number | null; first_line: number | null; count: number }[];
  provenance_truncated: boolean;
};

const objects = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : [];
const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

/** 按实体归并 canon 声明 + presence 分布成事实 dossier（保 canon.entities 序）；确定性，无推断。 */
export function buildDossiers(canon: JsonObject, presence: Presence): Dossier[] {
  const invariants = isJsonObject(canon.invariants) ? canon.invariants : {};
  const singleHolder = objects((invariants as JsonObject).single_holder);
  const lifespans = objects((invariants as JsonObject).lifespan);
  const byId = new Map<string, PresenceEntity>();
  for (const entry of presence.entities) if (entry.id !== null) byId.set(entry.id, entry);

  const dossiers: Dossier[] = [];
  for (const entity of objects(canon.entities)) {
    const entityId = text(entity.id);
    if (entityId === null || !pythonStrip(entityId)) continue;
    const record = byId.get(entityId);
    const lifespan = lifespans.find(
      (entry) => entry.entity === entityId && typeof entry.exits_after_chapter === 'number',
    );
    dossiers.push({
      id: entityId,
      canonical_name: text(entity.canonical_name),
      metadata: assertionMetadata(entity),
      kind: text(entity.kind),
      aliases: Array.isArray(entity.aliases)
        ? entity.aliases.filter((alias): alias is string => typeof alias === 'string')
        : [],
      appearance: {
        missing: record ? record.missing : true,
        total_count: record ? record.total_count : 0,
        first_chapter: record ? record.first_chapter : null,
        last_chapter: record ? record.last_chapter : null,
      },
      holdings: singleHolder
        .filter(
          (entry) =>
            entry.holder === entityId &&
            typeof entry.item === 'string' &&
            Boolean(pythonStrip(entry.item)),
        )
        .map((entry) => ({ item: entry.item as string, entry })),
      lifespan: lifespan
        ? {
            exits_after_chapter: lifespan.exits_after_chapter as number,
            reason: text(lifespan.reason),
            entry: lifespan,
          }
        : null,
      provenance: (record?.occurrences ?? [])
        .map(({ path, chapter, first_line, count }) => ({ path, chapter, first_line, count }))
        .slice(0, MAX_PROVENANCE),
      provenance_truncated: Boolean(record) && record!.occurrences.length > MAX_PROVENANCE,
    });
  }
  return dossiers;
}

function chapterSpan(appearance: Dossier['appearance']): string {
  const { first_chapter: first, last_chapter: last } = appearance;
  if (first === null) return '未在正文出现';
  if (first === last) return `第 ${first} 章`;
  return `第 ${first}–${last} 章`;
}

function renderOne(dossier: Dossier): string[] {
  const name = dossier.canonical_name || dossier.id;
  const kind = dossier.kind;
  const heading = `## ${name}` + (kind !== null && pythonStrip(kind) ? `（${kind}）` : '');
  const lines = [heading, '', `- 实体声明：${renderAssertionMetadata(dossier.metadata)}`];
  if (dossier.aliases.length) lines.push(`- 别名：${dossier.aliases.join('、')}`);
  const appearance = dossier.appearance;
  if (appearance.missing) lines.push('- 出场：未在正文检出表面形（可能未登场或表面形与正文不符）');
  else lines.push(`- 出场：${chapterSpan(appearance)}，共 ${appearance.total_count} 处`);
  for (const holding of dossier.holdings) {
    lines.push(
      `- 持有声明：${holding.item}（${formatChapterWindow(holding.entry)}）；${renderAssertionMetadata(holding.entry)}`,
    );
  }
  const lifespan = dossier.lifespan;
  if (lifespan) {
    const reasonHint =
      lifespan.reason !== null && pythonStrip(lifespan.reason) ? `，原因：${lifespan.reason}` : '';
    lines.push(
      `- 生命期：声明第 ${lifespan.exits_after_chapter} 章后退场${reasonHint}；${renderAssertionMetadata(lifespan.entry)}`,
    );
  }
  if (dossier.provenance.length) {
    lines.push('- provenance（实体提及位置，非逐条断言依据）：');
    for (const occurrence of dossier.provenance) {
      const chapterHint = occurrence.chapter !== null ? `第 ${occurrence.chapter} 章 ` : '';
      const lineHint = occurrence.first_line !== null ? `:${occurrence.first_line}` : '';
      lines.push(`  - ${chapterHint}\`${occurrence.path}${lineHint}\`（${occurrence.count} 处）`);
    }
    if (dossier.provenance_truncated)
      lines.push(`  - …（出现处超过 ${MAX_PROVENANCE}，仅列前 ${MAX_PROVENANCE} 处）`);
  }
  lines.push('');
  return lines;
}

/** 把 dossier 列表渲染成一份聚合 markdown（可弃派生缓存，非作者手稿）。 */
export function renderDossiersMarkdown(dossiers: readonly Dossier[]): string {
  const out = [
    '# Canon Dossier（派生缓存，勿手改）',
    '',
    '> 本文件由 project.canon 从 canon.json 声明 + 正文在场分布确定性重建，',
    '> 是可弃缓存（删除后下次调用自愈），不是作者手稿。要改事实请改 canon.json。',
    '',
  ];
  if (!dossiers.length) {
    out.push('_canon.json 尚无实体声明。_', '');
    return out.join('\n');
  }
  for (const dossier of dossiers) out.push(...renderOne(dossier));
  return out.join('\n');
}
