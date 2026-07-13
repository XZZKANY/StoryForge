import {
  classifyRelativePath,
  relativePathInsideProject,
  resolveProjectRelativePath,
  type ContextBundle,
  type ContextBundleFile,
} from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { basename } from './path-utils';
import type { ContextAppendResult } from './types';

export async function appendExplicitContextFiles(
  bundle: ContextBundle,
  projectPath: string,
  explicitPaths: string[],
): Promise<ContextAppendResult> {
  const seen = new Set(bundle.files.map((file) => file.path));
  const seenRelative = new Set(
    bundle.files.map((file) => file.relativePath.replace(/\\/g, '/').toLowerCase()),
  );
  const added: ContextBundleFile[] = [];
  const missingPaths: string[] = [];
  for (const rawPath of explicitPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const path = resolveProjectRelativePath(projectPath, trimmed);
    const relativeCandidate = path ? relativePathInsideProject(projectPath, path) : null;
    if (!path || relativeCandidate === null) {
      missingPaths.push(trimmed);
      continue;
    }
    if (seen.has(path) || seenRelative.has(relativeCandidate.replace(/\\/g, '/').toLowerCase()))
      continue;
    try {
      const content = await TauriFileSystem.readProjectFile(projectPath, path);
      added.push({
        path,
        relativePath: relativeCandidate,
        kind: classifyRelativePath(relativeCandidate),
        title: basename(path),
        excerpt: content.trim().slice(0, 1200),
      });
      seen.add(path);
      seenRelative.add(relativeCandidate.replace(/\\/g, '/').toLowerCase());
    } catch {
      missingPaths.push(trimmed);
    }
  }
  if (added.length === 0) {
    return {
      bundle: {
        ...bundle,
        budget: {
          ...bundle.budget,
          missingPinnedFiles: Array.from(
            new Set([...bundle.budget.missingPinnedFiles, ...missingPaths]),
          ),
        },
      },
      missingPaths,
    };
  }
  const files = [...added, ...bundle.files].slice(0, 12);
  const missing = Array.from(new Set([...bundle.budget.missingPinnedFiles, ...missingPaths]));
  return {
    bundle: {
      ...bundle,
      files,
      budget: {
        ...bundle.budget,
        fileCount: files.length,
        charCount: files.reduce((total, file) => total + file.excerpt.length, 0),
        maxFiles: Math.max(bundle.budget.maxFiles, 12),
        truncated: bundle.budget.truncated || added.length + bundle.files.length > files.length,
        pinnedFileCount: Math.min(files.length, bundle.budget.pinnedFileCount + added.length),
        missingPinnedFiles: missing,
      },
    },
    missingPaths: missing,
  };
}
