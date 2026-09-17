import type { ProjectIndex, SemanticFile } from './types';
import { relativePathInsideProject } from './path';

/** A deterministic, read-only chapter projection derived from the local project index. */
export type ProjectChapter = {
  path: string;
  relativePath: string;
  name: string;
  ordinal: number;
  modified: number;
  size: number;
  /** Chapter character counts are intentionally unknown; no body files are read here. */
  estimatedChars: null;
};

function chapterOrdinal(file: SemanticFile, index: number): number {
  const match = file.name.match(/^(?:第)?(\d{1,6})/u);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : index + 1;
}

export function buildProjectChapterIndex(index: ProjectIndex): ProjectChapter[] {
  return index.files
    .filter(
      (file) =>
        file.kind === 'draft' && relativePathInsideProject(index.projectPath, file.path) !== null,
    )
    .map((file, position) => ({
      path: file.path,
      relativePath: file.relativePath,
      name: file.name,
      ordinal: chapterOrdinal(file, position),
      modified: file.modified,
      size: file.size,
      estimatedChars: null,
    }));
}
