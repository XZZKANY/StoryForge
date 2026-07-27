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

/** 纯函数：把一条提案并入 canon 对象。已存在则原样返回（作者已有的声明优先）。 */
export function applyCanonMerge(canon: CanonShape, target: CanonMergeTarget): CanonShape {
  if (target.kind === 'entity') {
    const entities = Array.isArray(canon.entities) ? [...canon.entities] : [];
    const id = target.entity.id;
    const exists = entities.some(
      (item) => item && typeof item === 'object' && (item as { id?: unknown }).id === id,
    );
    if (exists) return canon;
    return { ...canon, entities: [...entities, target.entity] };
  }
  const invariants =
    canon.invariants && typeof canon.invariants === 'object' && !Array.isArray(canon.invariants)
      ? { ...(canon.invariants as Record<string, unknown>) }
      : {};
  const existing = Array.isArray(invariants[target.invariant])
    ? (invariants[target.invariant] as unknown[])
    : [];
  const serialized = JSON.stringify(target.entry);
  if (existing.some((item) => JSON.stringify(item) === serialized)) return canon;
  invariants[target.invariant] = [...existing, target.entry];
  return { ...canon, invariants };
}

/** 读盘 → 并入 → 原子写回（Rust 侧 write_file 是临时文件 + rename）。 */
export async function mergeProposalIntoCanon(
  projectPath: string,
  target: CanonMergeTarget,
): Promise<void> {
  const path = canonDeclarationPathFor(projectPath);
  let canon: CanonShape = { version: 1, entities: [], invariants: {} };
  try {
    const parsed = JSON.parse(await TauriFileSystem.readFile(path)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      canon = parsed as CanonShape;
    }
  } catch {
    // 缺失或损坏：按空骨架起头，这次并入会写出一份格式正确的文件。
  }
  const merged = applyCanonMerge(canon, target);
  await TauriFileSystem.writeFile(projectPath, path, `${JSON.stringify(merged, null, 2)}\n`);
}
