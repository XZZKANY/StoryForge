import { AUTHOR_INSTRUCTIONS_PATH } from '../../kernel/fsTools';
import { syntheticContextSelectedValues } from '../../kernel/llmPromptContext';
import { pythonStrip } from '../../kernel/pythonText';
import type { SecretContext } from '../../kernel/redaction';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;

/** 只投影已准入的作者自定义指令文件，不认模型给的风格元数据（patches/polish_context）。 */
export function polishAuthorRequirementsFromContextSnapshot(snapshot: unknown): string[] {
  if (!isObj(snapshot) || snapshot.kind !== 'llm_context_snapshot') return [];
  const files = snapshot.context_files;
  if (!Array.isArray(files)) return [];
  const requirements = files
    .filter(
      (item): item is Obj =>
        isObj(item) &&
        item.kind === 'author_instructions' &&
        item.relative_path === AUTHOR_INSTRUCTIONS_PATH &&
        typeof item.excerpt === 'string' &&
        Boolean(pythonStrip(item.excerpt)),
    )
    .map((item) => item.excerpt as string);
  return [...new Set(requirements)];
}

export type PolishContextConstraints = {
  protected_entities: string[];
  character_constraints: Obj[];
  continuity_facts: Obj[];
  required_facts: string[];
};

const ENTITY_FILE_KINDS = new Set(['character', 'setting']);
const CONTINUITY_FILE_KINDS = new Set(['setting', 'timeline', 'foreshadowing']);
const REQUIRED_CHAPTER_KEYS = [
  'goal',
  'setting',
  'beat',
  'beats',
  'outline',
  'chapter_outline',
  'current_scene',
];
const MAX_ENTITIES = 24;
const MAX_CHARACTER_CONSTRAINTS = 8;
const MAX_FACTS = 24;

function appendUnique(target: string[], value: string, limit: number) {
  if (target.length < limit && !target.includes(value)) target.push(value);
}

function contextFileEntity(item: Obj): string | null {
  const title = text(item.title) ?? text(item.relative_path);
  if (!title) return null;
  let name = title.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  const dot = name.lastIndexOf('.');
  const suffix = dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : '';
  if (['.md', '.markdown', '.txt'].includes(suffix)) name = name.slice(0, -suffix.length);
  return pythonStrip(name) || null;
}

function factStrings(value: unknown): string[] {
  if (typeof value === 'string') return pythonStrip(value) ? [pythonStrip(value)] : [];
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
      .map(pythonStrip);
  return [];
}

/** 只取作者明确交来的、已脱敏的上下文；绝不从正文推断事实。 */
export function polishConstraintsFromContextSnapshot(
  snapshot: unknown,
  secrets: SecretContext,
): PolishContextConstraints {
  const result: PolishContextConstraints = {
    protected_entities: [],
    character_constraints: [],
    continuity_facts: [],
    required_facts: [],
  };
  if (!isObj(snapshot) || snapshot.kind !== 'llm_context_snapshot') return result;
  const files = snapshot.context_files;
  if (Array.isArray(files))
    for (const item of files) {
      if (!isObj(item)) continue;
      const kind = text(item.kind);
      const relativePath = text(item.relative_path);
      const excerpt = text(item.excerpt);
      const entity = kind !== null && ENTITY_FILE_KINDS.has(kind) ? contextFileEntity(item) : null;
      if (entity !== null) appendUnique(result.protected_entities, entity, MAX_ENTITIES);
      if (
        kind === 'character' &&
        excerpt &&
        result.character_constraints.length < MAX_CHARACTER_CONSTRAINTS
      ) {
        const constraint: Obj = { notes: excerpt };
        if (entity !== null) constraint.name = entity;
        if (relativePath) constraint.path = relativePath;
        result.character_constraints.push(constraint);
      }
      if (
        kind !== null &&
        CONTINUITY_FILE_KINDS.has(kind) &&
        excerpt &&
        result.continuity_facts.length < MAX_FACTS
      ) {
        const fact: Obj = { statement: excerpt };
        if (relativePath) fact.source_path = relativePath;
        result.continuity_facts.push(fact);
      }
    }
  const [memoryItems, chapterContext] = syntheticContextSelectedValues(
    snapshot as Parameters<typeof syntheticContextSelectedValues>[0],
    secrets,
  );
  for (const item of memoryItems) {
    if (!isObj(item)) continue;
    const entity = text(item.entity);
    const fact = text(item.text);
    if (entity) appendUnique(result.protected_entities, entity, MAX_ENTITIES);
    if (fact) appendUnique(result.required_facts, fact, MAX_FACTS);
  }
  for (const key of REQUIRED_CHAPTER_KEYS)
    for (const fact of factStrings(chapterContext[key]))
      appendUnique(result.required_facts, fact, MAX_FACTS);
  return result;
}
