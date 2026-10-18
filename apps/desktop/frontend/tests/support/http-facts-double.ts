/**
 * 测试替身：事实台账要读真项目文件（Tauri 原生读口），浏览器回归没有；补录候选一律为空，
 * 观测镜就不出补录入口。经 `scripts/http-doubles-plugin.mjs` 换进去，其余导出照用原模块。
 */
import type { UnrecordedChapter } from '../../src/lib/api/facts';

export async function listUnrecordedChapters(_projectRoot: string): Promise<UnrecordedChapter[]> {
  return [];
}
