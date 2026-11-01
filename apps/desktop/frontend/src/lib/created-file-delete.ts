/**
 * 撤销一次「新建」的删除那一步：删文件、清掉上下文缓存、连载计划里那章退回未写。
 * 编辑器通知里的「撤销（删除该文件）」和批量写章清单上的「撤销这章及之后」都走这一条；
 * 删之前核对磁盘内容还是写进去时那一份，由调用方各自做（它们手里的凭据不一样）。
 */
import { invalidateContextBundleCache } from './project-context';
import { unmarkChapterWrittenInPlan } from './serial-plan';
import { TauriFileSystem } from './host/tauri-fs';

export async function deleteCreatedFile(projectRoot: string, filePath: string): Promise<void> {
  // 原生 delete_path 尚非 compare-delete：读取核对到原生删除之间的跨进程竞态仍需原生原子守卫。
  await TauriFileSystem.deletePath(projectRoot, filePath);
  invalidateContextBundleCache(projectRoot);
  // 正文没了，这章就不再是「写完的」——把接受时标上的 done 退回 pending。
  // 只在删文件这一支做：修订的撤销走反向写回，文件还在，那章依然是写完的。
  await unmarkChapterWrittenInPlan(projectRoot, filePath);
}
