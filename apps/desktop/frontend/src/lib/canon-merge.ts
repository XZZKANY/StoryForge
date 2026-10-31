/**
 * 把观测镜里的一条 canon 提案并入作者的 canon.json。
 *
 * 为什么在前端：后端红线是绝不写作者项目文件——`canon_store` 只写
 * `.storyforge/canon/derived/`，`canon.json` 视为作者所有、只读。于是 agent 能读自己的
 * 记忆、不能写自己的记忆，提案区一直只读，作者只能手改 JSON。这一层只补「作者点一下」
 * 这一步，写盘仍由作者的动作触发。
 *
 * 自愈：并入后不必回改 derived/proposals.json——后端 `read_pending_proposals` 是拿草稿
 * 与作者 canon 做差集，已并入的条目下一次扫描自然从提案里消失。
 *
 * 已知边界：读的是磁盘当前内容。作者若正在编辑器里手改 canon.json 且未保存，其后续
 * 保存仍会以缓冲覆盖——与既有补丁写回对已打开文件的行为一致，不在此另建闸。
 * 写盘本身走 `canon-write.ts`（确认 → 快照 → 写 → 可撤销），这里只放纯改动与读取。
 */

import { TauriFileSystem } from './tauri-fs';

const CANON_RELATIVE = ['.storyforge', 'canon', 'canon.json'];

type CanonShape = {
  version?: unknown;
  entities?: unknown;
  invariants?: unknown;
  [key: string]: unknown;
};

/** 并入目标：新实体，或某个不变量下的一条声明。 */
export type CanonMergeTarget =
  | { kind: 'entity'; entity: Record<string, unknown> }
  | { kind: 'claim'; invariant: string; entry: Record<string, unknown> };

export function canonDeclarationPathFor(projectPath: string): string {
  const s = projectPath.includes('\\') ? '\\' : '/';
  return [projectPath.replace(/[/\\]+$/, ''), ...CANON_RELATIVE].join(s);
}

// 与 promise_scan._promise_id 的 Python str.strip 保持一致；不改写声明原值。
function promiseId(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(
        // eslint-disable-next-line no-control-regex -- Python str.strip 也剥离这些控制空白。
        /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
        '',
      )
    : '';
}

// 字段在、但类型不对（作者手改过）：拒绝，不当成空的去替换——那样会把作者原来写在里面的内容整个丢掉。
function wrongShape(field: string, expected: string): Error {
  return new Error(
    `canon.json 里的 ${field} 不是${expected}，先在编辑器里修好再来；这次没有写入。`,
  );
}

function invariantsOf(canon: CanonShape): Record<string, unknown> {
  if (canon.invariants == null) return {};
  if (typeof canon.invariants !== 'object' || Array.isArray(canon.invariants))
    throw wrongShape('invariants', '对象');
  return canon.invariants as Record<string, unknown>;
}

function claimsOf(invariants: Record<string, unknown>, name: string): unknown[] {
  const value = invariants[name];
  if (value == null) return [];
  if (!Array.isArray(value)) throw wrongShape(`invariants.${name}`, '数组');
  return value;
}

/** 纯函数：把一条提案并入 canon 对象。已存在则原样返回（作者已有的声明优先）。 */
export function applyCanonMerge(canon: CanonShape, target: CanonMergeTarget): CanonShape {
  if (target.kind === 'entity') {
    if (canon.entities != null && !Array.isArray(canon.entities))
      throw wrongShape('entities', '数组');
    const entities = Array.isArray(canon.entities) ? [...canon.entities] : [];
    const id = target.entity.id;
    const exists = entities.some(
      (item) => item && typeof item === 'object' && (item as { id?: unknown }).id === id,
    );
    if (exists) return canon;
    return { ...canon, entities: [...entities, target.entity] };
  }
  const invariants = { ...invariantsOf(canon) };
  const existing = claimsOf(invariants, target.invariant);
  const serialized = JSON.stringify(target.entry);
  if (existing.some((item) => JSON.stringify(item) === serialized)) return canon;
  if (target.invariant === 'promises') {
    const id = promiseId(target.entry.id);
    if (
      id &&
      existing.some(
        (item) =>
          item && typeof item === 'object' && promiseId((item as { id?: unknown }).id) === id,
      )
    ) {
      throw new Error(
        `伏笔承诺「${id}」已有不同声明，不能追加相同 ID。请先在 canon.json 中核对并手动处理该声明，再重扫提案；本次未写入。`,
      );
    }
  }
  invariants[target.invariant] = [...existing, target.entry];
  return { ...canon, invariants };
}

/** canon.json 在、但解析不出来：多半是作者手改到一半。绝不拿空骨架覆盖它。 */
export class CanonUnreadableError extends Error {}

export type CanonDeclaration = {
  path: string;
  /** 磁盘原文；文件还不存在时为 null。撤销与写前快照都基于它。 */
  raw: string | null;
  canon: CanonShape;
};

/** 读作者的 canon.json：不存在就从空骨架起头；存在但不是合法 JSON 对象就拒绝。 */
export async function readCanonDeclaration(projectPath: string): Promise<CanonDeclaration> {
  const path = canonDeclarationPathFor(projectPath);
  if (!(await TauriFileSystem.pathExists(path))) {
    return { path, raw: null, canon: { version: 1, entities: [], invariants: {} } };
  }
  const raw = await TauriFileSystem.readProjectFile(projectPath, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CanonUnreadableError(
      'canon.json 现在不是合法的 JSON（可能手改到一半），先在编辑器里修好再来；这次没有写入。',
    );
  }
  return { path, raw, canon: parsed as CanonShape };
}

export function serializeCanon(canon: CanonShape): string {
  return `${JSON.stringify(canon, null, 2)}\n`;
}

/** 纯函数：把某条伏笔承诺标为在第 chapter 章回收。找不到这条就报错，不凭空新建。 */
export function applyPromiseResolved(canon: CanonShape, id: string, chapter: number): CanonShape {
  const invariants = invariantsOf(canon);
  const promises = claimsOf(invariants, 'promises');
  const index = promises.findIndex(
    (item) => item && typeof item === 'object' && promiseId((item as { id?: unknown }).id) === id,
  );
  if (index < 0)
    throw new Error(`canon.json 里找不到伏笔「${id}」，可能已被改名或删掉；这次没有写入。`);
  const next = [...promises];
  next[index] = {
    ...(promises[index] as Record<string, unknown>),
    status: 'resolved',
    resolved_chapter: chapter,
  };
  return { ...canon, invariants: { ...invariants, promises: next } };
}
