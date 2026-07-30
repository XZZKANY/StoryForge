/**
 * 书封：项目内 `.storyforge/cover.<ext>`，由作者从本机选一张图导入。
 *
 * 走 base64 data URI 而不是 asset 协议：后者要改 CSP 与 assetProtocol scope，为一张封面
 * 打开一条通用的本地文件读取通道不划算。封面只在「作品」视图激活时读一次。
 *
 * 导入是复制而不是引用外部路径——作者把书目录挪到别处、拷到另一台机器，封面得跟着走。
 */
import { invoke } from '@tauri-apps/api/core';

import { TauriFileSystem } from './tauri-fs';

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export const COVER_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

export function coverExtension(fileName: string): string {
  return (fileName.split('.').pop() ?? '').toLowerCase();
}

export function coverMimeType(fileName: string): string | null {
  return MIME_BY_EXTENSION[coverExtension(fileName)] ?? null;
}

/** `.storyforge/` 下的封面绝对路径；fileName 是 book.json 里记的那个名字。 */
export function coverAbsolutePath(projectPath: string, fileName: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath.replace(/[\\/]+$/, '')}${separator}.storyforge${separator}${fileName}`;
}

/** 导入后的规范文件名：一律 `cover.<原扩展名>`，不沿用来源文件名。 */
export function coverFileNameFor(sourcePath: string): string | null {
  const extension = coverExtension(sourcePath.replace(/[\\/]+$/, ''));
  return MIME_BY_EXTENSION[extension] ? `cover.${extension}` : null;
}

export async function readCoverDataUrl(
  projectPath: string,
  fileName: string,
): Promise<string | null> {
  const mime = coverMimeType(fileName);
  if (!mime) return null;
  try {
    const base64 = await invoke<string>('read_project_file_base64', {
      projectRoot: projectPath,
      path: coverAbsolutePath(projectPath, fileName),
    });
    return `data:${mime};base64,${base64}`;
  } catch {
    // 封面被作者手工删了是常态：当作没有封面，不打断视图。
    return null;
  }
}

/**
 * 选一张本机图片导入为封面，返回新的封面文件名；作者取消选择返回 null。
 * 换了扩展名就顺手删掉旧封面，`.storyforge/` 里不留看不见的残图。
 */
export async function importCoverImage(
  projectPath: string,
  previousFileName: string | null,
): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
    title: '选择封面图片',
    filters: [{ name: '图片', extensions: COVER_EXTENSIONS }],
  });
  if (typeof selected !== 'string' || !selected) return null;

  const fileName = coverFileNameFor(selected);
  if (!fileName) throw new Error('只支持 JPG / PNG / WebP / GIF 图片');

  await invoke('copy_into_project', {
    projectRoot: projectPath,
    source: selected,
    dest: coverAbsolutePath(projectPath, fileName),
  });

  if (previousFileName && previousFileName !== fileName) {
    await TauriFileSystem.deletePath(
      projectPath,
      coverAbsolutePath(projectPath, previousFileName),
    ).catch(() => undefined);
  }
  return fileName;
}
