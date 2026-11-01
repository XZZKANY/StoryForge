import { projectBasename, relativePathInsideProject } from '../../lib/project-context';

// 命令面板条目的显示与匹配：相对作品的路径、模糊子序列匹配与评分、按匹配位置高亮。
function basename(path: string): string {
  return projectBasename(path);
}

export function relativeToProject(projectPath: string | null, filePath: string): string {
  return projectPath
    ? (relativePathInsideProject(projectPath, filePath) ?? basename(filePath))
    : basename(filePath);
}

/** fuzzy 子序列匹配：query 的每个字符按顺序出现在 target 中即可，返回匹配位置用于高亮。 */
export function fuzzyMatch(target: string, query: string): number[] | null {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  const positions: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    positions.push(found);
    ti = found + 1;
  }
  return positions;
}

/** fuzzy 评分：匹配越紧凑（首尾跨度小）、越靠前，分越高。 */
export function fuzzyScore(target: string, positions: number[]): number {
  if (positions.length === 0) return 0;
  const span = positions[positions.length - 1] - positions[0] + 1;
  const density = positions.length / span;
  const startBonus = positions[0] === 0 ? 2 : positions[0] < 3 ? 1 : 0;
  const lengthPenalty = 1 / (1 + target.length * 0.01);
  return density * 10 + startBonus + lengthPenalty;
}

/** 将 label 按匹配位置拆分为高亮片段。 */
export function HighlightedLabel({
  label,
  positions,
}: {
  label: string;
  positions: number[] | null;
}) {
  if (!positions || positions.length === 0) return <span className="truncate">{label}</span>;
  const posSet = new Set(positions);
  const parts: { text: string; match: boolean }[] = [];
  let current = { text: '', match: posSet.has(0) };
  for (let i = 0; i < label.length; i++) {
    const isMatch = posSet.has(i);
    if (isMatch !== current.match) {
      parts.push(current);
      current = { text: '', match: isMatch };
    }
    current.text += label[i];
  }
  parts.push(current);
  return (
    <span className="truncate">
      {parts.map((part, i) =>
        part.match ? (
          <span key={i} className="font-semibold text-foreground underline underline-offset-2">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
