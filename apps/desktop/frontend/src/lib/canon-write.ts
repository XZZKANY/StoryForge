/**
 * 作者从观测镜改 canon.json（并入提案、标伏笔已回收）的唯一写入口。
 *
 * canon.json 是作者手里的设定账本，坏一次要整份重来，所以每次写都走同一套：
 * 先算出改动，没有改动就不打扰；作者点过确认才写；写前给整本书拍一版快照；
 * 写完把「撤销」交回给调用方。确认期间文件被改过、或撤销时文件已被别处改过，一律停手。
 */

import { readCanonDeclaration, serializeCanon, type CanonDeclaration } from './canon-merge';
import { TauriFileSystem } from './tauri-fs';
import { snapshotBeforeWrite } from './versions';

type Canon = CanonDeclaration['canon'];

export type CanonWriteResult =
  | { status: 'written'; undo: () => Promise<void> }
  | { status: 'unchanged' }
  | { status: 'cancelled' };

export async function writeCanonGuarded({
  projectPath,
  edit,
  confirm,
  summary,
}: {
  projectPath: string;
  edit: (canon: Canon) => Canon;
  /** 作者的确认；返回 false 就什么都不写。 */
  confirm: () => Promise<boolean>;
  /** 写进版本记录的一句话。 */
  summary: string;
}): Promise<CanonWriteResult> {
  const before = await readCanonDeclaration(projectPath);
  const next = edit(before.canon);
  if (next === before.canon) return { status: 'unchanged' };
  if (!(await confirm())) return { status: 'cancelled' };
  const latest = await readCanonDeclaration(projectPath);
  if (latest.raw !== before.raw) {
    throw new Error('canon.json 在你确认期间被改过了，这次没有写入；看过最新内容再来。');
  }
  await snapshotBeforeWrite(projectPath, before.path, before.raw ?? '', {
    source: 'Editor',
    summary,
    checkpoint: true,
  });
  const written = serializeCanon(next);
  await TauriFileSystem.writeFile(projectPath, before.path, written);
  return { status: 'written', undo: () => undoCanonWrite(projectPath, before, written) };
}

async function undoCanonWrite(
  projectPath: string,
  before: CanonDeclaration,
  written: string,
): Promise<void> {
  const current = (await TauriFileSystem.pathExists(before.path))
    ? await TauriFileSystem.readFile(before.path)
    : null;
  if (current !== written) {
    throw new Error('canon.json 之后又改过，不能直接撤销；写入前的那一份在版本记录里。');
  }
  if (before.raw === null) await TauriFileSystem.deletePath(projectPath, before.path);
  else await TauriFileSystem.writeFile(projectPath, before.path, before.raw);
}
