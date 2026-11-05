/** 人物按本章提到的名字选整节，通用约束始终保留；无法可靠识别人名时保留全文。 */
export type CharacterSource = { readonly path: string; readonly text: string };

type Section = { text: string; shared: boolean; name: string | null };
const SHARED = /统一|共同|通用|全局|写作边界|写作原则|人物关系|关系网|说明|备注/u;
const GENERIC = /^(?:主要人物|人物|角色|人物卡|角色卡|人物设定|角色设定|characters|cast)$/iu;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;

function nameOf(title: string): string | null {
  const name = title
    .replace(/^(?:[一二三四五六七八九十百零\d]+[、.．)）][ \t]*)/u, '')
    .replace(/^[\d]+[-_]/u, '')
    .split(/[（(：:〔【]/u)[0]
    .trim();
  if (GENERIC.test(name) || SHARED.test(name)) return null;
  return /^(?:[\p{Script=Han}·]{2,12}|[A-Za-z][A-Za-z .'-]{1,40})$/u.test(name) ? name : null;
}

function sectionsOf(text: string): { prefix: string; sections: Section[] } | null {
  const lines = text.split('\n');
  const headings: { line: number; level: number; title: string }[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(\x60{3,}|~{3,})/u.exec(line);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      return;
    }
    const match = fence === null ? HEADING.exec(line) : null;
    if (match) headings.push({ line: index, level: match[1].length, title: match[2] });
  });
  if (!headings.length) return null;
  let level = Math.min(...headings.map((heading) => heading.level));
  // 单独的文件标题不当作人物；同级的多个人物各自保留完整子标题树。
  if (headings.filter((heading) => heading.level === level).length === 1) {
    const children = headings.filter((heading) => heading.level > level);
    if (!children.length) return null;
    level = Math.min(...children.map((heading) => heading.level));
  }
  const roots = headings.filter((heading) => heading.level === level);
  const sections = roots.map(
    (heading, index): Section => ({
      text: lines
        .slice(heading.line, roots[index + 1]?.line ?? lines.length)
        .join('\n')
        .trim(),
      shared: SHARED.test(heading.title),
      name: nameOf(heading.title),
    }),
  );
  if (sections.filter((section) => section.name !== null && !section.shared).length < 2)
    return null;
  return { prefix: lines.slice(0, roots[0].line).join('\n').trim(), sections };
}

export function selectCharacterSources(
  sources: readonly CharacterSource[],
  mentionText: string,
): { path: string; body: string; focused: boolean }[] {
  const candidates = sources.map((source) => {
    const filename = source.path
      .split('/')
      .slice(-1)[0]
      .replace(/\.[^.]+$/u, '');
    const name = nameOf(filename);
    const sections = GENERIC.test(filename) || name === null ? sectionsOf(source.text) : null;
    const explicit = mentionText.includes(source.path);
    const matched =
      explicit ||
      (sections
        ? sections.sections.some(
            (section) => section.name !== null && mentionText.includes(section.name),
          )
        : name !== null && mentionText.includes(name));
    return { ...source, name, sections, explicit, matched };
  });
  if (!mentionText.trim() || !candidates.some((source) => source.matched))
    return sources.map((source) => ({ path: source.path, body: source.text, focused: false }));
  return candidates.flatMap((source) => {
    if (source.explicit || source.sections === null) {
      return source.explicit || source.matched || source.name === null
        ? [{ path: source.path, body: source.text, focused: false }]
        : [];
    }
    const selected = source.sections.sections.filter(
      (section) => section.shared || section.name === null || mentionText.includes(section.name),
    );
    if (!selected.length) return [];
    const focused = selected.length < source.sections.sections.length;
    const body = [source.sections.prefix, ...selected.map((section) => section.text)]
      .filter(Boolean)
      .join('\n\n');
    return [{ path: source.path, body, focused }];
  });
}
