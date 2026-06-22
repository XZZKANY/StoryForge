import { TauriFileSystem, type FileEntry } from './tauri-fs';

export type SemanticKind =
  | 'outline'
  | 'character'
  | 'setting'
  | 'timeline'
  | 'foreshadowing'
  | 'draft'
  | 'quality'
  | 'export'
  | 'other';

export type SemanticFile = {
  path: string;
  relativePath: string;
  name: string;
  kind: SemanticKind;
  modified: number;
  size: number;
};

export type ProjectSemanticSummary = {
  hasStoryStructure: boolean;
  counts: Record<SemanticKind, number>;
};

export type ContextBundleBudget = {
  fileCount: number;
  charCount: number;
  maxFiles: number;
  maxExcerptChars: number;
  truncated: boolean;
  pinnedFileCount: number;
  missingPinnedFiles: string[];
};

export type ProjectIndex = {
  projectPath: string;
  files: SemanticFile[];
  summary: ProjectSemanticSummary;
};

export type ContextBundleFile = {
  path: string;
  relativePath: string;
  kind: SemanticKind;
  title: string;
  excerpt: string;
};

export type ContextBundle = {
  projectRoot: string;
  currentFile: string;
  files: ContextBundleFile[];
  summary: ProjectSemanticSummary;
  budget: ContextBundleBudget;
};

export type StoryProjectInitializationPlan = {
  directories: string[];
  readmePath: string;
  readmeContent: string;
};

const KIND_LABELS: Record<SemanticKind, string> = {
  outline: '大纲',
  character: '人物',
  setting: '设定',
  timeline: '时间线',
  foreshadowing: '伏笔',
  draft: '正文',
  quality: '质量',
  export: '导出',
  other: '其他',
};

const DIR_KIND: Record<string, SemanticKind> = {
  '大纲': 'outline',
  outline: 'outline',
  outlines: 'outline',
  '人物': 'character',
  character: 'character',
  characters: 'character',
  '角色': 'character',
  '设定': 'setting',
  setting: 'setting',
  settings: 'setting',
  world: 'setting',
  worldbuilding: 'setting',
  '世界观': 'setting',
  '时间线': 'timeline',
  timeline: 'timeline',
  timelines: 'timeline',
  chronology: 'timeline',
  '伏笔': 'foreshadowing',
  foreshadowing: 'foreshadowing',
  foreshadows: 'foreshadowing',
  seeds: 'foreshadowing',
  '正文': 'draft',
  draft: 'draft',
  drafts: 'draft',
  chapter: 'draft',
  chapters: 'draft',
  manuscript: 'draft',
  '质量': 'quality',
  quality: 'quality',
  reports: 'quality',
  '导出': 'export',
  export: 'export',
  exports: 'export',
};

const STORY_DIRS = ['正文', '大纲', '人物', '设定', '世界观', '时间线', '伏笔'];
const CONTEXT_BUNDLE_CACHE_TTL_MS = 30000;

type ContextBundleCacheEntry = {
  createdAt: number;
  bundle: ContextBundle;
};

const contextBundleCache = new Map<string, ContextBundleCacheEntry>();

function normalizeRoot(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

export function relativeToProject(projectPath: string, filePath: string): string {
  const root = normalizeRoot(projectPath);
  return filePath.startsWith(root) ? filePath.slice(root.length).replace(/^[/\\]+/, '') : filePath;
}

export function projectBasename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function semanticKindLabel(kind: SemanticKind): string {
  return KIND_LABELS[kind];
}

export function classifyRelativePath(relativePath: string): SemanticKind {
  const firstSegment = relativePath.split(/[/\\]/).find(Boolean);
  if (!firstSegment) return 'other';
  return DIR_KIND[firstSegment.toLowerCase()] ?? DIR_KIND[firstSegment] ?? 'other';
}

function emptyCounts(): Record<SemanticKind, number> {
  return {
    outline: 0,
    character: 0,
    setting: 0,
    timeline: 0,
    foreshadowing: 0,
    draft: 0,
    quality: 0,
    export: 0,
    other: 0,
  };
}

export function buildProjectIndexFromEntries(projectPath: string, entries: FileEntry[]): ProjectIndex {
  const files = entries
    .filter((entry) => !entry.isDir)
    .filter((entry) => entry.extension === 'md' || entry.extension === 'markdown')
    .filter((entry) => !/[/\\]\.storyforge[/\\]/.test(entry.path))
    .map((entry) => {
      const relativePath = relativeToProject(projectPath, entry.path);
      return {
        path: entry.path,
        relativePath,
        name: entry.name,
        kind: classifyRelativePath(relativePath),
        modified: entry.modified,
        size: entry.size,
      };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const counts = emptyCounts();
  for (const file of files) {
    counts[file.kind] += 1;
  }

  const hasStoryStructure = counts.outline + counts.character + counts.setting + counts.timeline + counts.foreshadowing + counts.draft > 0;
  return { projectPath, files, summary: { hasStoryStructure, counts } };
}

export async function buildProjectIndex(projectPath: string): Promise<ProjectIndex> {
  const entries = await TauriFileSystem.listDir(projectPath, true);
  return buildProjectIndexFromEntries(projectPath, entries);
}

export function buildStoryProjectInitializationPlan(projectPath: string): StoryProjectInitializationPlan {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const root = normalizeRoot(projectPath);
  const readmePath = `${root}${separator}大纲${separator}项目说明.md`;
  return {
    directories: STORY_DIRS.map((dir) => `${root}${separator}${dir}`),
    readmePath,
    readmeContent: [
      '# 项目说明',
      '',
      '- 大纲：存放总纲、章节节点、反转表。',
      '- 人物：存放角色小传、关系、成长线。',
      '- 设定：存放世界观、地点、物件、规则。',
      '- 世界观：存放世界底层规则、势力、历史和专有名词。',
      '- 时间线：存放事件顺序、回忆、伏笔兑现节点。',
      '- 伏笔：存放埋线、回收计划、读者预期管理。',
      '- 正文：存放章节正文。',
    ].join('\n'),
  };
}

export async function initializeStoryProject(projectPath: string): Promise<void> {
  const plan = buildStoryProjectInitializationPlan(projectPath);
  for (const dir of plan.directories) {
    await TauriFileSystem.createDir(dir, true);
  }

  const readmePath = plan.readmePath;
  const exists = await TauriFileSystem.pathExists(readmePath);
  if (!exists) {
    await TauriFileSystem.writeFile(readmePath, plan.readmeContent);
  }
}

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

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
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
    .sort((a, b) => a.pinIndex - b.pinIndex || a.file.relativePath.localeCompare(b.file.relativePath))
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
  const { projectPath, currentFile, maxFiles = 8, maxExcerptChars = 1200, pinnedFiles = [] } = params;
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

  const bundle = {
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
      pinnedFileCount: files.filter((file) => pinnedIndexByPath({
        path: file.path,
        relativePath: file.relativePath,
        name: file.title,
        kind: file.kind,
        modified: 0,
        size: 0,
      }, projectPath, pinnedFiles) >= 0).length,
      missingPinnedFiles: selection.missingPinnedFiles,
    },
  };
  contextBundleCache.set(cacheKey, { createdAt: Date.now(), bundle });
  return bundle;
}
