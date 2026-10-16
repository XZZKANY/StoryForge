const FENCE = /^ {0,3}(`{3,}|~{3,})/gm;

/**
 * 输出中的正文常停在半截标记上：`**加粗` 还没等到收尾、行内代码或代码块还没关。
 * 渲染前临时补上收尾，免得先露出星号和反引号、下一帧又突然变成粗体。
 * 只在输出中用；结算后照原文渲染，作者看到的最终回复不受影响。
 */
export function closeStreamingMarkdown(text: string): string {
  const fences = [...text.matchAll(FENCE)];
  if (fences.length % 2 === 1) {
    const fence = fences[fences.length - 1][1];
    return `${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
  }
  // 前面的段落已经完整，只看最后一段。
  const start = text.lastIndexOf('\n\n') + 1;
  const head = text.slice(0, start);
  let tail = text.slice(start);
  // 末尾刚吐出的一两颗星（开头那对还没等到字，或收尾那对被分块切开）先拿掉，下面按配对补齐。
  const dangling = /(?:^|[^*])(\*{1,2})$/.exec(tail);
  if (dangling) tail = tail.slice(0, tail.length - dangling[1].length);
  if ((tail.match(/`/g)?.length ?? 0) % 2 === 1) tail += '`';
  const strong = tail.replace(/`[^`]*`/g, '').match(/\*\*/g)?.length ?? 0;
  if (strong % 2 === 1) tail += '**';
  return head + tail;
}
