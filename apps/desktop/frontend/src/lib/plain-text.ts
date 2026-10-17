/**
 * 把模型回复里的 Markdown 压成一行纯文本：用在只放得下一行说明的地方（版本记录、改稿审阅栏），
 * 不让星号、标题井号、分隔线、列表符号原样露出来。
 */
export function markdownToPlainLine(markdown: string | undefined): string | null {
  if (!markdown) return null;
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, '')
        .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, ''),
    )
    .join(' ')
    .replace(/(^|\s)(?:-{3,}|#{1,6})(?=\s|$)/g, ' ')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}
