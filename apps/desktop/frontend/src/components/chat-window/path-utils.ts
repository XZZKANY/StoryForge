import { isKnownAgentRoleMention } from '../../lib/agent-roles';
import { projectBasename, relativePathInsideProject } from '../../lib/project-context';

export function basename(path: string): string {
  return projectBasename(path);
}

export function relativePath(projectPath: string | null, filePath: string): string {
  return projectPath
    ? (relativePathInsideProject(projectPath, filePath) ?? basename(filePath))
    : basename(filePath);
}

export function extractContextReferences(text: string): string[] {
  const matches = Array.from(text.matchAll(/@([^\s，。！？!?；;：:,、]+)/g));
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isKnownAgentRoleMention(`@${value}`));
}
