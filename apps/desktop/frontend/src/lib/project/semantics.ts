import type { SemanticKind } from './types';

const SAFE_STORYFORGE_KNOWLEDGE_FILES = new Set([
  '.storyforge/book.json',
  '.storyforge/agent-instructions.md',
  '.storyforge/serial-plan.json',
  '.storyforge/canon/canon.json',
  '.storyforge/canon/hooks.json',
]);

const KIND_LABELS: Record<SemanticKind, string> = {
  outline: '大纲',
  character: '人物',
  setting: '设定',
  timeline: '时间线',
  foreshadowing: '伏笔',
  knowledge: '创作资料',
  draft: '正文',
  quality: '质量',
  export: '导出',
  other: '其他',
};

const DIR_KIND: Record<string, SemanticKind> = {
  大纲: 'outline',
  outline: 'outline',
  outlines: 'outline',
  人物: 'character',
  character: 'character',
  characters: 'character',
  角色: 'character',
  设定: 'setting',
  setting: 'setting',
  settings: 'setting',
  world: 'setting',
  worldbuilding: 'setting',
  世界观: 'setting',
  时间线: 'timeline',
  timeline: 'timeline',
  timelines: 'timeline',
  chronology: 'timeline',
  伏笔: 'foreshadowing',
  foreshadowing: 'foreshadowing',
  foreshadows: 'foreshadowing',
  seeds: 'foreshadowing',
  '.资料': 'knowledge',
  资料: 'knowledge',
  materials: 'knowledge',
  knowledge: 'knowledge',
  正文: 'draft',
  draft: 'draft',
  drafts: 'draft',
  chapter: 'draft',
  chapters: 'draft',
  manuscript: 'draft',
  质量: 'quality',
  quality: 'quality',
  reports: 'quality',
  导出: 'export',
  export: 'export',
  exports: 'export',
};

export function semanticKindLabel(kind: SemanticKind): string {
  return KIND_LABELS[kind];
}

export function classifyRelativePath(relativePath: string): SemanticKind {
  if (isProjectKnowledgeRelativePath(relativePath)) return 'knowledge';
  const firstSegment = relativePath.split(/[/\\]/).find(Boolean);
  if (!firstSegment) return 'other';
  return DIR_KIND[firstSegment.toLowerCase()] ?? DIR_KIND[firstSegment] ?? 'other';
}

export function isProjectKnowledgeRelativePath(relativePath: string): boolean {
  return SAFE_STORYFORGE_KNOWLEDGE_FILES.has(relativePath.replace(/\\/g, '/'));
}

export function emptyCounts(): Record<SemanticKind, number> {
  return {
    outline: 0,
    character: 0,
    setting: 0,
    timeline: 0,
    foreshadowing: 0,
    knowledge: 0,
    draft: 0,
    quality: 0,
    export: 0,
    other: 0,
  };
}
