import { normalizeRoot } from './path';
import type { SemanticFile } from './types';

const PROJECT_KNOWLEDGE_STORAGE_PREFIX = 'storyforge:project-knowledge:';
export const PROJECT_KNOWLEDGE_SELECTION_LIMIT = 12;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function normalizeProjectKnowledgePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

export function parseProjectKnowledgeSelection(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const path = normalizeProjectKnowledgePath(item);
    const key = path?.toLocaleLowerCase();
    if (!path || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(path);
    if (result.length >= PROJECT_KNOWLEDGE_SELECTION_LIMIT) break;
  }
  return result;
}

export function projectKnowledgeStorageKey(projectPath: string): string {
  return `${PROJECT_KNOWLEDGE_STORAGE_PREFIX}${normalizeRoot(projectPath)}`;
}

export function readProjectKnowledgeSelection(
  projectPath: string,
  storage: StorageLike | null = browserStorage(),
): string[] {
  if (!projectPath || !storage) return [];
  try {
    return parseProjectKnowledgeSelection(storage.getItem(projectKnowledgeStorageKey(projectPath)));
  } catch {
    return [];
  }
}

export function writeProjectKnowledgeSelection(
  projectPath: string,
  paths: string[],
  storage: StorageLike | null = browserStorage(),
): string[] {
  const normalized = parseProjectKnowledgeSelection(JSON.stringify(paths));
  if (!projectPath || !storage) return normalized;
  try {
    storage.setItem(projectKnowledgeStorageKey(projectPath), JSON.stringify(normalized));
  } catch {
    // Local preference persistence is best-effort; the current session still keeps its pins.
  }
  return normalized;
}

export function reconcileProjectKnowledgeSelection(
  storedPaths: string[],
  candidates: SemanticFile[],
): { selected: string[]; missing: string[] } {
  const byPath = new Map(
    candidates
      .filter((file) => file.kind === 'knowledge')
      .map((file) => [
        file.relativePath.replace(/\\/g, '/').toLocaleLowerCase(),
        file.relativePath,
      ]),
  );
  const selected: string[] = [];
  const missing: string[] = [];
  for (const path of parseProjectKnowledgeSelection(JSON.stringify(storedPaths))) {
    const candidate = byPath.get(path.toLocaleLowerCase());
    if (candidate) selected.push(candidate);
    else missing.push(path);
  }
  return { selected, missing };
}
