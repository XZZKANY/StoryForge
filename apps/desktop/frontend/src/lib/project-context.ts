import { TauriFileSystem, type FileEntry } from './tauri-fs';

export type SemanticKind = 'outline' | 'character' | 'setting' | 'draft' | 'quality' | 'export' | 'other';

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
};

const KIND_LABELS: Record<SemanticKind, string> = {
  outline: '大纲',
  character: '人物',
  setting: '设定',
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

const STORY_DIRS = ['大纲', '人物', '设定', '正文', '质量', '导出'];
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

  const hasStoryStructure = counts.outline + counts.character + counts.setting + counts.draft > 0;
  return { projectPath, files, summary: { hasStoryStructure, counts } };
}

export async function buildProjectIndex(projectPath: string): Promise<ProjectIndex> {
  const entries = await TauriFileSystem.listDir(projectPath, true);
  return buildProjectIndexFromEntries(projectPath, entries);
}

export async function initializeStoryProject(projectPath: string): Promise<void> {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const root = normalizeRoot(projectPath);
  for (const dir of STORY_DIRS) {
    await TauriFileSystem.createDir(`${root}${separator}${dir}`, true);
  }

  const readmePath = `${root}${separator}大纲${separator}项目说明.md`;
  const exists = await TauriFileSystem.pathExists(readmePath);
  if (!exists) {
    await TauriFileSystem.writeFile(
      readmePath,
      [
        '# 项目说明',
        '',
        '- 大纲：存放总纲、章节节点、反转表。',
        '- 人物：存放角色小传、关系、成长线。',
        '- 设定：存放世界观、地点、物件、规则。',
        '- 正文：存放章节正文。',
        '- 质量：存放审查报告、伏笔表、版本记录。',
        '- 导出：存放交付稿和发布制品。',
      ].join('\n'),
    );
  }
}

function contextPriority(file: SemanticFile, currentFile: string): number {
  if (file.path === currentFile) return 99;
  const kindPriority: Record<SemanticKind, number> = {
    outline: 0,
    character: 1,
    setting: 2,
    quality: 3,
    draft: 4,
    export: 5,
    other: 6,
  };
  return kindPriority[file.kind];
}

export async function buildContextBundle(params: {
  projectPath: string;
  currentFile: string;
  maxFiles?: number;
  maxExcerptChars?: number;
}): Promise<ContextBundle> {
  const { projectPath, currentFile, maxFiles = 8, maxExcerptChars = 1200 } = params;
  const cacheKey = [
    normalizeRoot(projectPath),
    currentFile,
    maxFiles,
    maxExcerptChars,
  ].join('\u0000');
  const cached = contextBundleCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CONTEXT_BUNDLE_CACHE_TTL_MS) {
    return cached.bundle;
  }

  const index = await buildProjectIndex(projectPath);
  const candidates = index.files
    .filter((file) => file.path !== currentFile)
    .filter((file) => file.kind !== 'export' && file.kind !== 'other')
    .sort((a, b) => {
      const priority = contextPriority(a, currentFile) - contextPriority(b, currentFile);
      return priority !== 0 ? priority : a.relativePath.localeCompare(b.relativePath);
    })
    .slice(0, maxFiles);

  const files: ContextBundleFile[] = [];
  for (const file of candidates) {
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
  };
  contextBundleCache.set(cacheKey, { createdAt: Date.now(), bundle });
  return bundle;
}
