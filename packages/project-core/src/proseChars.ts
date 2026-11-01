/**
 * 正文字数（网文计字口径，与发行平台接近）：空白以外的每个字，标点算，按码点数（增补面汉字算 1）。
 * 空白取 JS 正则 `\s` 的 25 个码点——Unicode 空白（全角空格、em space、行分隔符 U+2028 等）加 BOM。
 * 换行要排除：算进去短段落的稿子会被虚抬一成以上（10-16 真书第 6 章：2826 个汉字算成 3547）。
 * 界面的状态栏、日更进度、全书字数与引擎的章节检查、章长区间、修订字数提示、批量写章结果卡共用这一份。
 */
export function countProseChars(text: string): number {
  if (!text) return 0;
  return Array.from(text.replace(/\s+/g, '')).length;
}
