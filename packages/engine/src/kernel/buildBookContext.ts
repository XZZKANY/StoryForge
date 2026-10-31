import { compareManuscriptPaths } from '@storyforge/project-core';
import { decodeUtf8, normalizeNewlines, ProjectReadError, type ProjectReader } from '../readPort';
import type { BookContext } from './bookContext';
import { readBookRoster } from './canonStore';
import { isManuscriptPath, orderManuscriptFiles } from './manuscript';
import { projectKnowledgeCandidates } from './projectKnowledge';
import { MAX_READ_BYTES, ProjectTreeError, scanProjectFiles } from './projectTree';
import { pythonStrip } from './pythonText';

const AUTHOR_INSTRUCTIONS = '.storyforge/agent-instructions.md';
const SKIPPED = new Set(['.git', '.storyforge', '.codex', 'node_modules', '__pycache__']);
const generalVisible = (path: string) =>
  path === AUTHOR_INSTRUCTIONS ||
  !path.split('/').some((part) => part.startsWith('.') || SKIPPED.has(part));
const manuscriptVisible = (path: string) =>
  !path.split('/').some((part) => part.startsWith('.')) && isManuscriptPath(path);

async function chapterOrdinals(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<Map<string, number>> {
  // Canon ordinals traverse general sources; previous-tail discovery prunes non-manuscript dirs.
  const paths = await scanProjectFiles(reader, root, {
    visible: generalVisible,
    explicitFiles: [AUTHOR_INSTRUCTIONS],
  });
  const ordered = orderManuscriptFiles(
    paths.map((relative_path) => ({ relative_path, is_directory: false })),
    platform,
  );
  const ordinals = new Map<string, number>();
  for (const path of ordered) {
    const resolved = (await reader.resolveProjectPath(root, path)).resolvedRelativePath;
    if (!resolved.startsWith('.') && isManuscriptPath(resolved))
      ordinals.set(path, ordinals.size + 1);
  }
  return ordinals;
}

async function previousTail(
  reader: ProjectReader,
  root: string,
  current: string | null,
  platform: 'windows' | 'posix',
): Promise<readonly [string, string] | null> {
  if (!current) return null;
  try {
    const relative = (await reader.resolveProjectPath(root, current.replace(/\\/g, '/')))
      .resolvedRelativePath;
    if (!isManuscriptPath(relative)) return null;
    const paths = await scanProjectFiles(reader, root, { visible: manuscriptVisible });
    const ordered = orderManuscriptFiles(
      paths.map((relative_path) => ({ relative_path, is_directory: false })),
      platform,
    );
    const caseKey = (path: string) => (platform === 'windows' ? path.toLowerCase() : path);
    let index = ordered.findIndex((path) => caseKey(path) === caseKey(relative));
    if (index === -1) {
      index = ordered.findIndex((path) => compareManuscriptPaths(path, relative) >= 0);
      if (index === -1) index = ordered.length;
    }
    if (index === 0) return null;
    const previous = ordered[index - 1];
    const target = await reader.resolveProjectPath(root, previous);
    const raw = await reader.readProjectBytes(root, target.resolvedRelativePath, MAX_READ_BYTES);
    if (raw.exceeded || raw.bytes.subarray(0, 1024).includes(0)) return null;
    const text = normalizeNewlines(decodeUtf8(raw.bytes)).replace(/^\n+|\n+$/g, '');
    const points = Array.from(text);
    let tail = text;
    if (points.length > 600) {
      const window = points.slice(-600);
      const boundary = window.findIndex((char, i) => char === '\n' && window[i + 1] === '\n');
      tail = window.slice(boundary !== -1 && boundary < 300 ? boundary + 2 : 0).join('');
    }
    tail = pythonStrip(tail);
    return tail ? [previous, tail] : null;
  } catch (error) {
    if (!(error instanceof ProjectReadError || error instanceof ProjectTreeError)) throw error;
    return null;
  }
}

/** `current` 可以是绝对路径，也可以是相对项目根的路径（迁移计划 §4.3.1）。 */
export async function buildBookContext(
  reader: ProjectReader,
  root: string,
  current: string | null,
  platform: 'windows' | 'posix',
): Promise<BookContext | null> {
  let ordinals: Map<string, number>;
  try {
    await reader.resolveProjectPath(root, '.');
    if ((await reader.inspectProjectPath(root, '.')).targetKind !== 'directory') return null;
    ordinals = await chapterOrdinals(reader, root, platform);
  } catch (error) {
    if (!(error instanceof ProjectReadError || error instanceof ProjectTreeError)) throw error;
    return null;
  }
  let currentRelative: string | null = null;
  if (current) {
    try {
      currentRelative = (await reader.resolveProjectPath(root, current)).resolvedRelativePath;
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
    }
  }
  const chapters: BookContext['chapters'][number][] = [];
  for (const [relative_path, ordinal] of ordinals) {
    let size_bytes = 0;
    try {
      size_bytes = (await reader.inspectProjectPath(root, relative_path)).sizeBytes;
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
    }
    chapters.push({ ordinal, relative_path, size_bytes });
  }
  let skeleton: BookContext['skeleton'] = [];
  let skeletonTotal = 0;
  try {
    const candidates = await projectKnowledgeCandidates(reader, root, 10_000);
    skeletonTotal = candidates.length;
    skeleton = candidates.slice(0, 12).map((entry) => ({
      relative_path: entry.path,
      estimated_chars: Math.floor(entry.size_bytes / 3),
      source_type: entry.source_type,
    }));
  } catch (error) {
    // Python only swallows OSError here, not the FsToolError wrapping failed traversal.
    if (!(error instanceof ProjectReadError)) throw error;
  }
  const { roster, total } = await readBookRoster(reader, root);
  return {
    chapters,
    current_relative_path: currentRelative,
    current_ordinal: currentRelative ? (ordinals.get(currentRelative) ?? null) : null,
    skeleton,
    skeleton_total: skeletonTotal,
    roster,
    roster_declared_total: total,
    dossier_relative_path: null,
    previous_chapter: await previousTail(reader, root, current, platform),
  };
}
