import { compareManuscriptPaths } from '@storyforge/project-core';
import type { ProjectReader } from '../readPort';
import { consistencyScan, type ConsistencyScanResult } from './consistencyScan';
import { iterProjectFiles, nativeProjectPath, resolveProjectRoot, scopedTarget } from './fsTools';
import {
  compareCodePoints,
  InputDomainError,
  JsonFields,
  type JsonObject,
  type JsonValue,
} from './json';
import { isManuscriptPath } from './manuscript';
import { matchPythonPath } from './pathMatch';
import { pythonStrip } from './pythonText';

export type PresenceOccurrence = {
  path: string;
  chapter: number | null;
  count: number;
  first_line: number | null;
  matched_forms: string[];
};
export type PresenceEntity = {
  id: string | null;
  canonical_name: string | null;
  surface_forms: string[];
  total_count: number;
  missing: boolean;
  first_chapter: number | null;
  last_chapter: number | null;
  occurrences: PresenceOccurrence[];
};
export type Presence = {
  entities: PresenceEntity[];
  chapter_count: number;
  scanned_files: number;
  terms_truncated: boolean;
};

/**
 * 按路径序给每个正文文件编 1-based 章序（阅读序）。glob 只比对文件名，拦不住
 * `大纲/总纲.md`，所以非正文目录另判；文件别名按解析后的目标再判一次。
 */
export async function chapterOrdinals(
  reader: ProjectReader,
  root: string,
  glob: string,
  platform: 'windows' | 'posix',
): Promise<Map<string, number>> {
  await resolveProjectRoot(reader, root);
  const paths: string[] = [];
  for (const relative of await iterProjectFiles(reader, root)) {
    if (!matchPythonPath(nativeProjectPath(root, relative, platform), glob, platform)) continue;
    if (relative.startsWith('.') || !isManuscriptPath(relative)) continue;
    const resolved = await scopedTarget(reader, root, relative);
    if (resolved.startsWith('.') || !isManuscriptPath(resolved)) continue;
    paths.push(relative);
  }
  return new Map(paths.sort(compareManuscriptPaths).map((path, index) => [path, index + 1]));
}

export function entitySurfaceForms(entity: JsonObject): string[] {
  const forms: string[] = [];
  const aliases = entity.aliases;
  for (const value of [entity.canonical_name, ...(Array.isArray(aliases) ? aliases : [])]) {
    if (typeof value !== 'string') continue;
    const stripped = pythonStrip(value);
    if (stripped && !forms.includes(stripped)) forms.push(stripped);
  }
  return forms;
}

/** 扫正文，产出每个实体（本名 + 别名表面形）的在场分布；正文是唯一真值源。 */
export async function rebuildPresence(
  reader: ProjectReader,
  root: string,
  entities: readonly JsonObject[],
  options: { glob?: string; platform: 'windows' | 'posix' },
): Promise<Presence> {
  const { glob = '*.md', platform } = options;
  const ordinals = await chapterOrdinals(reader, root, glob, platform);
  const allForms: string[] = [];
  for (const entity of entities)
    for (const form of entitySurfaceForms(entity))
      if (!allForms.includes(form)) allForms.push(form);

  // 不截断（max_terms=null）：第 31 个以后的表面形若被截掉，实体会被误标「未登场」。
  // 先按章节筛文件再算扫描预算：资料里的提及不算正文出场。
  const scan: ConsistencyScanResult | null = allForms.length
    ? await consistencyScan(reader, root, allForms, {
        platform,
        glob,
        maxTerms: null,
        includedPaths: new Set(ordinals.keys()),
      })
    : null;
  const termIndex = new Map((scan?.term_occurrences ?? []).map((entry) => [entry.term, entry]));

  const presenceEntities = entities.map((entity): PresenceEntity => {
    const forms = entitySurfaceForms(entity);
    const perPath = new Map<string, PresenceOccurrence>();
    for (const form of forms) {
      for (const file of termIndex.get(form)?.files ?? []) {
        let bucket = perPath.get(file.path);
        if (!bucket) {
          bucket = {
            path: file.path,
            chapter: ordinals.get(file.path) ?? null,
            count: 0,
            first_line: file.first_line,
            matched_forms: [],
          };
          perPath.set(file.path, bucket);
        }
        bucket.count += file.count;
        if (
          file.first_line !== null &&
          (bucket.first_line === null || file.first_line < bucket.first_line)
        )
          bucket.first_line = file.first_line;
        if (!bucket.matched_forms.includes(form)) bucket.matched_forms.push(form);
      }
    }
    const occurrences = [...perPath.values()].sort(
      (a, b) =>
        Number(a.chapter === null) - Number(b.chapter === null) ||
        (a.chapter ?? 0) - (b.chapter ?? 0) ||
        compareCodePoints(a.path, b.path),
    );
    const chapters = occurrences.flatMap((item) => (item.chapter === null ? [] : [item.chapter]));
    return {
      id: typeof entity.id === 'string' ? entity.id : null,
      canonical_name: typeof entity.canonical_name === 'string' ? entity.canonical_name : null,
      surface_forms: forms,
      total_count: occurrences.reduce((sum, item) => sum + item.count, 0),
      missing: !occurrences.length,
      first_chapter: chapters.length ? Math.min(...chapters) : null,
      last_chapter: chapters.length ? Math.max(...chapters) : null,
      occurrences,
    };
  });
  return {
    entities: presenceEntities,
    chapter_count: ordinals.size,
    scanned_files: scan?.scanned_files ?? 0,
    terms_truncated: scan?.terms_truncated ?? false,
  };
}

/** 应用写出的 presence 缓存：结构不合视为缓存失效（返回 null），由调用方重建。 */
export function presenceFromCache(value: JsonObject): Presence | null {
  const fields = new JsonFields('presence.json');
  const strings = (list: JsonValue | undefined, path: string) =>
    fields.optionalArray(list, path).map((item, i) => fields.string(item, `${path}[${i}]`));
  try {
    return {
      entities: fields.optionalArray(fields.member(value, 'entities'), 'entities').map((raw, i) => {
        const at = `entities[${i}]`;
        const entry = fields.object(raw, at);
        return {
          id: fields.optionalString(fields.member(entry, 'id'), `${at}.id`),
          canonical_name: fields.optionalString(
            fields.member(entry, 'canonical_name'),
            `${at}.canonical_name`,
          ),
          surface_forms: strings(fields.member(entry, 'surface_forms'), `${at}.surface_forms`),
          total_count: fields.integer(fields.member(entry, 'total_count'), `${at}.total_count`),
          missing: fields.boolean(fields.member(entry, 'missing'), `${at}.missing`),
          first_chapter: fields.optionalInteger(
            fields.member(entry, 'first_chapter'),
            `${at}.first_chapter`,
          ),
          last_chapter: fields.optionalInteger(
            fields.member(entry, 'last_chapter'),
            `${at}.last_chapter`,
          ),
          occurrences: fields
            .optionalArray(fields.member(entry, 'occurrences'), `${at}.occurrences`)
            .map((item, j) => {
              const where = `${at}.occurrences[${j}]`;
              const occurrence = fields.object(item, where);
              return {
                path: fields.string(fields.member(occurrence, 'path'), `${where}.path`),
                chapter: fields.optionalInteger(
                  fields.member(occurrence, 'chapter'),
                  `${where}.chapter`,
                ),
                count: fields.integer(fields.member(occurrence, 'count'), `${where}.count`),
                first_line: fields.optionalInteger(
                  fields.member(occurrence, 'first_line'),
                  `${where}.first_line`,
                ),
                matched_forms: strings(
                  fields.member(occurrence, 'matched_forms'),
                  `${where}.matched_forms`,
                ),
              };
            }),
        };
      }),
      chapter_count: fields.integer(fields.member(value, 'chapter_count'), 'chapter_count'),
      scanned_files: fields.integer(fields.member(value, 'scanned_files'), 'scanned_files'),
      terms_truncated: fields.boolean(fields.member(value, 'terms_truncated'), 'terms_truncated'),
    };
  } catch (error) {
    if (error instanceof InputDomainError) return null;
    throw error;
  }
}
