/** 网文计字口径：非空白字符数（含标点），与发行平台的字数统计口径接近。 */
export function countProseChars(text: string): number {
  if (!text) return 0;
  // .length 数 UTF-16 码元会把增补面字符算成 2，按码点数。
  return Array.from(text.replace(/\s+/g, '')).length;
}
