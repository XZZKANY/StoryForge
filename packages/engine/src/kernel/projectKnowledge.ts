import { compareChapterPaths } from '@storyforge/project-core';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { scanProjectFiles } from './projectTree';
import { pythonStrip } from './pythonText';

const DIRECTORIES: Readonly<Record<string, string>> = {
  大纲: 'outline',
  outline: 'outline',
  outlines: 'outline',
  人物: 'character',
  角色: 'character',
  character: 'character',
  characters: 'character',
  设定: 'setting',
  世界观: 'setting',
  setting: 'setting',
  settings: 'setting',
  world: 'setting',
  worldbuilding: 'setting',
  时间线: 'timeline',
  timeline: 'timeline',
  timelines: 'timeline',
  chronology: 'timeline',
  伏笔: 'foreshadowing',
  foreshadowing: 'foreshadowing',
  foreshadows: 'foreshadowing',
  seeds: 'foreshadowing',
  '.资料': 'materials',
  资料: 'materials',
  materials: 'materials',
  knowledge: 'materials',
};
const EXPLICIT: Readonly<Record<string, string>> = {
  '.storyforge/book.json': 'book_profile',
  '.storyforge/agent-instructions.md': 'author_instructions',
  '.storyforge/serial-plan.json': 'serial_plan',
  '.storyforge/canon/canon.json': 'canon',
  '.storyforge/canon/hooks.json': 'canon',
};
export const BLOCKED = new Set([
  'derived',
  'version',
  'versions',
  'cache',
  'caches',
  'log',
  'logs',
  'database',
  'databases',
  'db',
  'config',
  'configs',
]);
export const EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml']);
export const SENSITIVE =
  /(?:^|[._-])(credentials?|secrets?|tokens?|password|passwd|api[-_]?key|private[-_]?key)(?:[._-]|$)/i;

function normalize(path: string): string | null {
  const raw = pythonStrip(path).replace(/\\/g, '/');
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (!parts.length || raw.startsWith('/') || parts[0].includes(':') || parts.includes('..'))
    return null;
  return parts.join('/');
}
export function projectKnowledgeSourceType(path: string): string | null {
  const normalized = normalize(path);
  if (normalized === null) return null;
  if (Object.prototype.hasOwnProperty.call(EXPLICIT, normalized)) return EXPLICIT[normalized];
  const parts = normalized.split('/');
  const source = Object.prototype.hasOwnProperty.call(DIRECTORIES, parts[0].toLowerCase())
    ? DIRECTORIES[parts[0].toLowerCase()]
    : null;
  if (
    source === null ||
    parts.slice(1).some((part) => part.startsWith('.')) ||
    parts.slice(1, -1).some((part) => BLOCKED.has(part.toLowerCase()))
  )
    return null;
  return source;
}
function eligible(path: string): boolean {
  const name = path.split('/').slice(-1)[0];
  const dot = name.lastIndexOf('.');
  return (
    projectKnowledgeSourceType(path) !== null &&
    dot > 0 &&
    EXTENSIONS.has(name.slice(dot).toLowerCase()) &&
    !path.split('/').some((part) => SENSITIVE.test(part) || part.toLowerCase() === '.env')
  );
}

export async function projectKnowledgeCandidates(
  reader: ProjectReader,
  root: string,
  maxEntries = 200,
) {
  const paths = await scanProjectFiles(reader, root, {
    visible: (path) => projectKnowledgeSourceType(path) !== null,
    explicitFiles: Object.keys(EXPLICIT),
  });
  const candidates: { path: string; title: string; source_type: string; size_bytes: number }[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if ((await reader.inspectProjectPath(root, path)).targetKind !== 'file') continue;
    const normalized = normalize(path);
    if (normalized === null || !eligible(normalized)) continue;
    let resolved: string;
    try {
      resolved = (await reader.resolveProjectPath(root, normalized)).resolvedRelativePath;
      if (resolved !== normalized && !eligible(resolved)) continue;
      const info = await reader.inspectProjectPath(root, resolved);
      if (info.targetKind !== 'file' || info.sizeBytes > 512 * 1024) continue;
    } catch (error) {
      if (!(error instanceof ProjectReadError)) throw error;
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const name = resolved.split('/').slice(-1)[0];
    const finalInfo = await reader.inspectProjectPath(root, resolved);
    if (finalInfo.targetKind === 'missing')
      throw new ProjectReadError('Knowledge source disappeared after validation');
    candidates.push({
      path: normalized,
      title: name.slice(0, name.lastIndexOf('.')),
      source_type: projectKnowledgeSourceType(normalized)!,
      size_bytes: finalInfo.sizeBytes,
    });
  }
  candidates.sort((a, b) => compareChapterPaths(a.path, b.path));
  return candidates.slice(0, Math.max(maxEntries, 0));
}
