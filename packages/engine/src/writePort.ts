/**
 * 引擎唯一的写口：只写 `.storyforge/` 下的应用文件（派生缓存、空模板、计划），永不写手稿。
 * 宿主负责原子落盘（同目录临时文件 + 刷盘 + 替换）与路径边界；内核只交出最终字节。
 */
export interface ProjectWriter {
  writeProjectFile(root: string, relativePath: string, bytes: Uint8Array): Promise<void>;
}

/** Python 以文本模式写文件：Windows 上 `\n` 落盘为 `\r\n`。 */
export function platformTextBytes(text: string, platform: 'windows' | 'posix'): Uint8Array {
  return new TextEncoder().encode(platform === 'windows' ? text.replace(/\n/g, '\r\n') : text);
}
