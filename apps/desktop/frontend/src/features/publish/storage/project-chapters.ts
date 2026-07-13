import { TauriFileSystem } from '../../../lib/tauri-fs';

const TEXT_EXT = new Set(['md', 'txt', 'markdown']);
const SKIP_DIR = new Set(['.git', 'node_modules', '.storyforge', 'dist', 'build', '.trellis']);

export type ProjectChapter = { path: string; name: string };

/** 列当前项目的章节文本文件（md/txt/markdown），按路径自然序，封顶 300。 */
export async function listProjectChapters(projectPath: string): Promise<ProjectChapter[]> {
  const entries = await TauriFileSystem.listDir(projectPath, true);
  const files = entries.filter((e) => {
    if (e.isDir) return false;
    const parts = e.path.replace(/\\/g, '/').split('/');
    if (parts.some((p) => SKIP_DIR.has(p))) return false;
    const ext = (e.extension || e.name.split('.').pop() || '').toLowerCase();
    return TEXT_EXT.has(ext);
  });
  return files
    .map((f) => ({ path: f.path, name: f.name }))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh'))
    .slice(0, 300);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 读章节文件 -> 发布用 {title, contentHtml}。
 * 首个非空行作标题（去 markdown # 前缀，截 30 字），其余非空行各作一个 <p> 段落。
 */
export async function readChapterForPublish(
  path: string,
  fallbackTitle: string,
): Promise<{ title: string; contentHtml: string; charCount: number }> {
  const raw = await TauriFileSystem.readFile(path);
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let title = '';
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].replace(/^#+\s*/, '').trim();
    if (t) {
      title = t.slice(0, 30);
      bodyStart = i + 1;
      break;
    }
  }
  if (!title) title = fallbackTitle.slice(0, 30);
  const paras = lines
    .slice(bodyStart)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const contentHtml = paras.length
    ? paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
    : '<p></p>';
  const charCount = paras.join('').replace(/\s+/g, '').length;
  return { title, contentHtml, charCount };
}
