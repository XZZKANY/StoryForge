import { MAX_CONTEXT_FILES } from '@storyforge/project-core';
import {
  classifyRelativePath,
  excerptForContext,
  relativePathInsideProject,
  resolveProjectRelativePath,
  type ContextBundle,
  type ContextBundleFile,
} from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/host/tauri-fs';
import { basename } from './path-utils';
import type { ContextAppendResult } from './types';

const EXPLICIT_EXCERPT_CHARS = 1200;

const normalizeRelative = (path: string) => path.replace(/\\/g, '/').toLowerCase();

export async function appendExplicitContextFiles(
  bundle: ContextBundle,
  projectPath: string,
  explicitPaths: string[],
): Promise<ContextAppendResult> {
  const seen = new Set(bundle.files.map((file) => file.path));
  const seenRelative = new Set(bundle.files.map((file) => normalizeRelative(file.relativePath)));
  const readRelative = new Set<string>();
  const added: ContextBundleFile[] = [];
  const missingPaths: string[] = [];
  let unreadable = 0;
  for (const rawPath of explicitPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const path = resolveProjectRelativePath(projectPath, trimmed);
    const relativeCandidate = path ? relativePathInsideProject(projectPath, path) : null;
    if (!path || relativeCandidate === null) {
      missingPaths.push(trimmed);
      continue;
    }
    const normalized = normalizeRelative(relativeCandidate);
    if (seen.has(path) || seenRelative.has(normalized) || readRelative.has(normalized)) continue;
    try {
      const content = await TauriFileSystem.readProjectFile(projectPath, path);
      readRelative.add(normalized);
      const kind = classifyRelativePath(relativeCandidate);
      const excerpt = excerptForContext(content, kind, EXPLICIT_EXCERPT_CHARS);
      if (!excerpt) {
        unreadable += 1;
        continue;
      }
      added.push({ path, relativePath: relativeCandidate, kind, title: basename(path), excerpt });
      seen.add(path);
      seenRelative.add(normalized);
    } catch {
      unreadable += 1;
      missingPaths.push(trimmed);
    }
  }
  const stillMissing = bundle.budget.missingPinnedFiles.filter((raw) => {
    const resolved = resolveProjectRelativePath(projectPath, raw.trim());
    const relative = resolved ? relativePathInsideProject(projectPath, resolved) : null;
    if (relative === null) return true;
    const normalized = normalizeRelative(relative);
    return !seenRelative.has(normalized) && !readRelative.has(normalized);
  });
  const missing = Array.from(new Set([...stillMissing, ...missingPaths]));
  const combined = [...added, ...bundle.files];
  const files = combined.slice(0, MAX_CONTEXT_FILES);
  const overflow = combined.length - files.length;
  return {
    bundle: {
      ...bundle,
      files,
      budget: {
        ...bundle.budget,
        fileCount: files.length,
        charCount: files.reduce((total, file) => total + file.excerpt.length, 0),
        maxFiles: MAX_CONTEXT_FILES,
        truncated: bundle.budget.truncated || overflow > 0 || unreadable > 0,
        overflowCount: (bundle.budget.overflowCount ?? 0) + overflow,
        unreadableCount: (bundle.budget.unreadableCount ?? 0) + unreadable,
        pinnedFileCount: Math.min(files.length, bundle.budget.pinnedFileCount + added.length),
        missingPinnedFiles: missing,
      },
    },
    missingPaths: missing,
  };
}
