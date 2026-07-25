/** 网文计字口径：非空白字符数（含标点），与发行平台的字数统计口径接近。 */
export function countProseChars(text: string): number {
  if (!text) return 0;
  // .length 数 UTF-16 码元会把增补面字符算成 2，按码点数。
  return Array.from(text.replace(/\s+/g, '')).length;
}

/**
 * 严格汉字数（只数 CJK 统一表意文字，不含标点与拉丁）。
 * 与 countProseChars 是**两套口径**：这条只用于作者闭环记录里的「修改前/后字数」，
 * 状态栏与日更进度一律走 countProseChars。别混用，也别以为两者该相等。
 */
export function countCjkChars(text: string): number {
  if (!text) return 0;
  return Array.from(text).filter((char) => /[\u4e00-\u9fff]/u.test(char)).length;
}

/** 段落数：空行分隔，忽略纯空白段。 */
export function countParagraphs(text: string): number {
  if (!text) return 0;
  return text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}
