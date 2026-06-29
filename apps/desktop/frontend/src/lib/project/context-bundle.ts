import { TauriFileSystem } from '../tauri-fs';
import { buildProjectIndex } from './index';
import { normalizePathForMatch, normalizeRoot } from './path';
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

function contextPriority(file: SemanticFile, currentFile: string): number {
  if (file.path === currentFile) return 99;
  const kindPriority: Record<SemanticKind, number> = {
    outline: 0,
    character: 1,
    setting: 2,
    timeline: 3,
    foreshadowing: 4,
    quality: 5,
    draft: 6,
    export: 7,
    other: 8,
  };
  return kindPriority[file.kind];
}

function pinnedIndexByPath(file: SemanticFile, projectPath: string, pinnedFiles: string[]): number {
  const normalizedProject = normalizePathForMatch(projectPath).replace(/\/+$/, '');
  const aliases = [
    normalizePathForMatch(file.path),
    normalizePathForMatch(file.relativePath),
    normalizePathForMatch(file.name),
  ];
  return pinnedFiles.findIndex((raw) => {
    const normalized = normalizePathForMatch(raw.trim());
    if (!normalized) return false;
    const projectRelative = normalized.startsWith(`${normalizedProject}/`)
      ? normalized.slice(normalizedProject.length + 1)
      : normalized;
    return aliases.includes(normalized) || aliases.includes(projectRelative);
  });
}

export function selectContextBundleFiles(params: {
  index: ProjectIndex;
  currentFile: string;
  maxFiles: number;
  pinnedFiles?: string[];
}): {
  files: SemanticFile[];
  truncated: boolean;
  missingPinnedFiles: string[];
} {
  const { index, currentFile, maxFiles, pinnedFiles = [] } = params;
  const eligible = index.files
    .filter((file) => file.path !== currentFile)
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
    const normalized = normalizePathForMatch(raw.trim());
    if (!normalized) return false;
    const normalizedProject = normalizePathForMatch(index.projectPath).replace(/\/+$/, '');
    const projectRelative = normalized.startsWith(`${normalizedProject}/`)
      ? normalized.slice(normalizedProject.length + 1)
      : normalized;
    return !pinnedMatches.has(normalized) && !pinnedMatches.has(projectRelative);
  });
  const pinnedPaths = new Set(pinned.map((file) => file.path));
  const automatic = eligible
    .filter((file) => !pinnedPaths.has(file.path) && file.kind !== 'other')
    .sort((a, b) => {
      const priority = contextPriority(a, currentFile) - contextPriority(b, currentFile);
      return priority !== 0 ? priority : a.relativePath.localeCompare(b.relativePath);
    });
  const candidates = [...pinned, ...automatic];
  return {
    files: candidates.slice(0, maxFiles),
    truncated: candidates.length > maxFiles,
    missingPinnedFiles,
  };
}

export async function buildContextBundle(params: {
  projectPath: string;
  currentFile: string;
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
    currentFile,
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
      const content = await TauriFileSystem.readFile(file.path);
      const excerpt = content.trim().slice(0, maxExcerptChars);
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
