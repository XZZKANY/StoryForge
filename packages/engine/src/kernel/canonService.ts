import type { ProjectReader } from '../readPort';
import type { ProjectWriter } from '../writePort';
import { buildDossiers, renderDossiersMarkdown } from './canonDossier';
import {
  readCanon,
  readDerived,
  scaffoldCanonIfMissing,
  writeDerived,
  writeDerivedText,
} from './canonFiles';
import { checkCanon } from './canonGate';
import { presenceFromCache, rebuildPresence, type Presence } from './canonRebuild';
import { captureCanonSourceRevision } from './canonStore';
import { isJsonObject, type JsonObject } from './json';

export const UNCACHED_SCAN_NOTE =
  '写回历史无法完整核验；本次直接扫描结果仅供参考，扫描期间的来源一致性未经核验，' +
  '未复用或发布正文派生缓存。';

export type CanonProjectionResult = {
  output: { [key: string]: unknown };
  canon: JsonObject;
  presence: Presence;
  sourceRevision: string | null;
};

/**
 * 重建在场分布、跑不变量闸门、写出 dossier，返回参考信号（非质量判定）。
 * refresh=false 时优先复用已落盘的 presence 缓存；来源版本无法确认时仍直接扫描，但不复用、不发布缓存。
 * 只写 `.storyforge/canon/` 下的派生缓存与（缺失时）canon.json 空模板。
 */
export async function buildCanonProjection(
  reader: ProjectReader,
  writer: ProjectWriter,
  root: string,
  options: { glob?: string; refresh?: boolean; platform: 'windows' | 'posix' },
): Promise<CanonProjectionResult> {
  const { glob = '*.md', refresh = true, platform } = options;
  const scaffolded = await scaffoldCanonIfMissing(reader, writer, root, platform);
  const sourceRevision = await captureCanonSourceRevision(reader, root);
  const canon = await readCanon(reader, root);
  const entities = Array.isArray(canon.entities) ? canon.entities.filter(isJsonObject) : [];

  const cached =
    refresh || sourceRevision === null ? null : await readDerived(reader, root, 'presence.json');
  let presence = cached === null ? null : presenceFromCache(cached);
  if (presence === null) {
    presence = await rebuildPresence(reader, root, entities, { glob, platform });
    if (sourceRevision !== null)
      await writeDerived(reader, writer, root, 'presence.json', presence, {
        sourceRevision,
        platform,
      });
  }

  const gate = await checkCanon(canon, presence);
  const report = {
    conflicts: gate.conflicts,
    advisories: gate.advisories,
    checked_invariants: gate.checked_invariants,
    entity_count: entities.length,
    scaffolded_canon: scaffolded,
  };
  if (sourceRevision !== null)
    await writeDerived(reader, writer, root, 'report.json', report, { sourceRevision, platform });

  const dossiers = buildDossiers(canon, presence);
  let dossierPath: string | null = null;
  if (sourceRevision !== null)
    dossierPath = await writeDerivedText(
      reader,
      writer,
      root,
      'dossier.md',
      renderDossiersMarkdown(dossiers),
      { sourceRevision, platform },
    );

  let note = gate.checked_invariants.length
    ? '结果为参考信号：硬矛盾（blocking）是声明内部结构冲突，advisory 须抽读原文核实。'
    : 'canon.json 尚无不变量声明，已建立空格式骨架；在场分布已扫描但暂无可校验项，' +
      '请在 .storyforge/canon/canon.json 声明实体与不变量后再查。';
  if (sourceRevision === null) note += UNCACHED_SCAN_NOTE;
  const output = {
    cache_status: sourceRevision === null ? 'uncached_unverified' : 'published',
    entity_count: entities.length,
    checked_invariants: gate.checked_invariants,
    conflicts: gate.conflicts,
    advisories: gate.advisories,
    conflict_count: gate.conflict_count,
    advisory_count: gate.advisory_count,
    presence_summary: {
      chapter_count: presence.chapter_count,
      scanned_files: presence.scanned_files,
      terms_truncated: presence.terms_truncated,
      missing_entities: presence.entities.filter((entry) => entry.missing).map((entry) => entry.id),
    },
    scaffolded_canon: scaffolded,
    dossier: {
      entity_count: dossiers.length,
      path: dossierPath,
      missing_entities: dossiers
        .filter((entry) => entry.appearance.missing)
        .map((entry) => entry.id),
    },
    note,
  };
  return { output, canon, presence, sourceRevision };
}
