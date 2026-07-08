import { isKnownAgentRoleMention } from '../../lib/agent-roles';
import {
  joinProjectPath,
  looksAbsolutePath,
  projectBasename,
  relativePathInsideProject,
} from '../../lib/project/path';

export function basename(path: string): string {
  return projectBasename(path);
}

export function relativePath(projectPath: string | null, filePath: string): string {
  if (!projectPath) return projectBasename(filePath);
  return relativePathInsideProject(projectPath, filePath) ?? projectBasename(filePath);
}

export { joinProjectPath, looksAbsolutePath };

export function extractContextReferences(text: string): string[] {
  const matches = Array.from(text.matchAll(/@([^\s，。！？!?；;：:,、]+)/g));
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isKnownAgentRoleMention(`@${value}`));
}
