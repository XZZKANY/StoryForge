export type SemanticKind =
  | 'outline'
  | 'character'
  | 'setting'
  | 'timeline'
  | 'foreshadowing'
  | 'knowledge'
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
  currentFile: string | null;
  files: ContextBundleFile[];
  summary: ProjectSemanticSummary;
  budget: ContextBundleBudget;
  /** 当前重试轮明确排除的结构化知识条目；不持久化为项目 pin 偏好。 */
  excludedKnowledgeIds?: string[];
};

export type StoryProjectInitializationPlan = {
  directories: string[];
  readmePath: string;
  readmeContent: string;
};
