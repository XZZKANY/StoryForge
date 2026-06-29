import type { SemanticKind } from './types';

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
  const firstSegment = relativePath.split(/[/\\]/).find(Boolean);
  if (!firstSegment) return 'other';
  return DIR_KIND[firstSegment.toLowerCase()] ?? DIR_KIND[firstSegment] ?? 'other';
}

export function emptyCounts(): Record<SemanticKind, number> {
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
