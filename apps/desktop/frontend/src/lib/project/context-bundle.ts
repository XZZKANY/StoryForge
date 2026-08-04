import { TauriFileSystem } from '../tauri-fs';
import { buildProjectIndex } from './index';
import { normalizePathForMatch, normalizeRoot, relativePathInsideProject } from './path';
import type {
  ContextBundle,
  ContextBundleFile,
  ProjectIndex,
  SemanticFile,
  SemanticKind,
} from './types';

const CONTEXT_BUNDLE_CACHE_TTL_MS = 30000;

type ContextBundleCacheEntry = {
  createdAt: number;
  bundle: ContextBundle;
};

const contextBundleCache = new Map<string, ContextBundleCacheEntry>();

const KIND_PRIORITY: Record<SemanticKind, number> = {
  outline: 0,
  character: 1,
  setting: 2,
  timeline: 3,
  foreshadowing: 4,
  knowledge: 5,
  quality: 6,
  draft: 7,
  export: 8,
  other: 9,
};

// 上一章仅次于大纲：续写要接的是它，排在人物 / 设定之后就会被挤出 maxFiles。
const PREVIOUS_CHAPTER_PRIORITY = 0.5;

type DraftOrder = {
  /** 正文 path → 阅读序下标。路径序即阅读序，与后端 `app/common/manuscript.py` 同判据。 */
  positionByPath: Map<string, number>;
  total: number;
  /** 当前文件在阅读序中的位置；当前文件不是正文（比如在改人物卡）时为 null。 */
  currentPosition: number | null;
};

function buildDraftOrder(files: SemanticFile[], currentFile: string | null): DraftOrder {
  const positionByPath = new Map<string, number>();
  files
    .filter((file) => file.kind === 'draft')
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .forEach((file, position) => positionByPath.set(file.path, position));
  const currentPosition = currentFile ? (positionByPath.get(currentFile) ?? null) : null;
  return { positionByPath, total: positionByPath.size, currentPosition };
}

/** 越小越该进上下文。前序章一律排在后续章之前——后续章通常还没写，且接不上笔。 */
function draftDistance(order: DraftOrder, file: SemanticFile): number {
  const position = order.positionByPath.get(file.path);
  if (position === undefined) return Number.MAX_SAFE_INTEGER;
  if (order.currentPosition === null) {
    // 当前文件不是正文时没有「上一章」可言：连载最前沿比开篇更能反映故事现状。
    return order.total - position;
  }
  const delta = position - order.currentPosition;
  return delta < 0 ? -delta : order.total + delta;
}

function isPreviousChapter(order: DraftOrder, file: SemanticFile): boolean {
  if (order.currentPosition === null) return false;
  return order.positionByPath.get(file.path) === order.currentPosition - 1;
}

function contextPriority(
  file: SemanticFile,
  currentFile: string | null,
  draftOrder: DraftOrder,
): number {
  if (currentFile && file.path === currentFile) return 99;
  if (file.kind === 'draft' && isPreviousChapter(draftOrder, file)) {
    return PREVIOUS_CHAPTER_PRIORITY;
  }
  return KIND_PRIORITY[file.kind];
}

/**
 * 正文取**结尾**、其余取开头。
 *
 * 连载写到第 30 章时，第 1 章的开头 1200 字对接笔毫无用处；真正接得上的是紧邻前一章
 * 怎么收的场。大纲 / 人物 / 设定是结构化文档，头部才是纲要，保持取开头。
 */
export function excerptForContext(content: string, kind: SemanticKind, maxChars: number): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (kind !== 'draft') return trimmed.slice(0, maxChars);
  return `……（本章前文略）\n${trimmed.slice(trimmed.length - maxChars)}`;
}

function pinnedIndexByPath(file: SemanticFile, projectPath: string, pinnedFiles: string[]): number {
  const aliases = [
    normalizePathForMatch(file.path),
    normalizePathForMatch(file.relativePath),
    normalizePathForMatch(file.name),
  ];
  return pinnedFiles.findIndex((raw) => {
    const trimmed = raw.trim();
    const normalized = normalizePathForMatch(trimmed);
    if (!normalized) return false;
    const projectRelative = relativePathInsideProject(projectPath, trimmed);
    const normalizedRelative = projectRelative
      ? normalizePathForMatch(projectRelative)
      : normalized;
    return aliases.includes(normalized) || aliases.includes(normalizedRelative);
  });
}

/**
 * 席位按优先级**轮转**分配：每个类目先各得一席，再回头填第二席。
 *
 * 此前是严格按优先级自上而下铺满。人物卡攒到十张（长篇的常态）时，8 席会被
 * 大纲 2 + 上一章 1 + 人物 5 吃干净——模型写第 30 章时手里一条世界规则、一条时间线、
 * 一条伏笔都没有，而且 truncated 只是个布尔，作者永远不知道整类被丢了。
 *
 * 类目之间是互补的：大纲答「往哪去」、人物答「谁」、设定答「什么能做」。少一整类比
 * 某一类少一篇伤得多，所以广度优先于深度。
 *
 * `ordered` 只需保证**车道内**次序（邻章距离、路径序）；车道之间的先后由本函数按
 * priority 排定——优先级只在这一处生效，调用方再排一遍就没人能证伪它了。
 */
function allocateSeatsByPriority(
  ordered: SemanticFile[],
  seats: number,
  priorityOf: (file: SemanticFile) => number,
): SemanticFile[] {
  if (seats <= 0) return [];
  const lanes = new Map<number, SemanticFile[]>();
  for (const file of ordered) {
    const lane = lanes.get(priorityOf(file));
    if (lane) lane.push(file);
    else lanes.set(priorityOf(file), [file]);
  }
  const byPriority = [...lanes.entries()].sort(([a], [b]) => a - b).map(([, files]) => files);
  const deepest = Math.max(0, ...byPriority.map((lane) => lane.length));

  const picked: SemanticFile[] = [];
  for (let round = 0; round < deepest && picked.length < seats; round += 1) {
    for (const lane of byPriority) {
      if (round >= lane.length) continue;
      picked.push(lane[round]);
      if (picked.length >= seats) break;
    }
  }
  return picked;
}

export function selectContextBundleFiles(params: {
  index: ProjectIndex;
  currentFile: string | null;
  maxFiles: number;
  pinnedFiles?: string[];
}): {
  files: SemanticFile[];
  truncated: boolean;
  missingPinnedFiles: string[];
} {
  const { index, currentFile, maxFiles, pinnedFiles = [] } = params;
  const draftOrder = buildDraftOrder(index.files, currentFile);
  const eligible = index.files
    .filter((file) => !currentFile || file.path !== currentFile)
    .filter((file) => file.kind !== 'export' && file.kind !== 'quality');
  const pinnedMatches = new Set<string>();
  const pinned = eligible
    .map((file) => ({ file, pinIndex: pinnedIndexByPath(file, index.projectPath, pinnedFiles) }))
    .filter((item) => item.pinIndex >= 0)
    .sort(
      (a, b) => a.pinIndex - b.pinIndex || a.file.relativePath.localeCompare(b.file.relativePath),
    )
    .map((item) => {
      pinnedMatches.add(normalizePathForMatch(item.file.path));
      pinnedMatches.add(normalizePathForMatch(item.file.relativePath));
      pinnedMatches.add(normalizePathForMatch(item.file.name));
      return item.file;
    });
  const missingPinnedFiles = pinnedFiles.filter((raw) => {
    const trimmed = raw.trim();
    const normalized = normalizePathForMatch(trimmed);
    if (!normalized) return false;
    const projectRelative = relativePathInsideProject(index.projectPath, trimmed);
    const normalizedRelative = projectRelative
      ? normalizePathForMatch(projectRelative)
      : normalized;
    return !pinnedMatches.has(normalized) && !pinnedMatches.has(normalizedRelative);
  });
  const pinnedPaths = new Set(pinned.map((file) => file.path));
  // 只排车道**内**的次序；类目之间谁先谁后交给 allocateSeatsByPriority 单点裁决。
  const automatic = eligible
    .filter(
      (file) => !pinnedPaths.has(file.path) && file.kind !== 'other' && file.kind !== 'knowledge',
    )
    .sort((a, b) => {
      if (a.kind === 'draft' && b.kind === 'draft') {
        const distance = draftDistance(draftOrder, a) - draftDistance(draftOrder, b);
        if (distance !== 0) return distance;
      }
      return a.relativePath.localeCompare(b.relativePath);
    });
  // 作者显式 pin 的文件是命令不是建议，先占席；剩下的席位才交给轮转分配。
  const files = [
    ...pinned.slice(0, maxFiles),
    ...allocateSeatsByPriority(automatic, maxFiles - pinned.length, (file) =>
      contextPriority(file, currentFile, draftOrder),
    ),
  ];
  return {
    files,
    truncated: pinned.length + automatic.length > maxFiles,
    missingPinnedFiles,
  };
}

export async function buildContextBundle(params: {
  projectPath: string;
  currentFile: string | null;
  maxFiles?: number;
  maxExcerptChars?: number;
  pinnedFiles?: string[];
}): Promise<ContextBundle> {
  const {
    projectPath,
    currentFile,
    maxFiles = 8,
    maxExcerptChars = 1200,
    pinnedFiles = [],
  } = params;
  const cacheKey = [
    normalizeRoot(projectPath),
    currentFile ?? '',
    maxFiles,
    maxExcerptChars,
    ...pinnedFiles.map((item) => item.trim()).sort(),
  ].join('\u0000');
  const cached = contextBundleCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CONTEXT_BUNDLE_CACHE_TTL_MS) {
    return cached.bundle;
  }

  const index = await buildProjectIndex(projectPath);
  const selection = selectContextBundleFiles({ index, currentFile, maxFiles, pinnedFiles });

  const files: ContextBundleFile[] = [];
  for (const file of selection.files) {
    try {
      const content = await TauriFileSystem.readProjectFile(projectPath, file.path);
      const excerpt = excerptForContext(content, file.kind, maxExcerptChars);
      if (excerpt) {
        files.push({
          path: file.path,
          relativePath: file.relativePath,
          kind: file.kind,
          title: file.name,
          excerpt,
        });
      }
    } catch {
      // 单个上下文文件不可读时跳过，不阻断当前文件修订。
    }
  }

  const bundle: ContextBundle = {
    projectRoot: projectPath,
    currentFile,
    files,
    summary: index.summary,
    budget: {
      fileCount: files.length,
      charCount: files.reduce((total, file) => total + file.excerpt.length, 0),
      maxFiles,
      maxExcerptChars,
      truncated: selection.truncated || selection.files.length > files.length,
      pinnedFileCount: files.filter(
        (file) =>
          pinnedIndexByPath(
            {
              path: file.path,
              relativePath: file.relativePath,
              name: file.title,
              kind: file.kind,
              modified: 0,
              size: 0,
            },
            projectPath,
            pinnedFiles,
          ) >= 0,
      ).length,
      missingPinnedFiles: selection.missingPinnedFiles,
    },
  };
  contextBundleCache.set(cacheKey, { createdAt: Date.now(), bundle });
  return bundle;
}
