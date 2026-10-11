import { pythonFixed } from './math';

export type StaticProseIssue = {
  dimension: string;
  severity: string;
  snippet: string;
  message: string;
  suggestion: string;
  revision_strategy: string;
};

const TRANSITION_STARTERS = [
  '与此同时',
  '另一边',
  '时间来到',
  '话分两头',
  '镜头一转',
  '画面回到',
  '故事回到',
  '视线转向',
  '同一时刻',
  '再看此处',
];
const QUESTION_PATTERNS = [
  /(?:难道|莫非|究竟|到底|谁能|怎么会)[^。！？!?\n]{0,32}[？?][”」]?$/u,
  /[^。！？!?\n]{1,32}(?:吗|么|呢)[？?][”」]?$/u,
  /[^。！？!?\n]{1,32}[？?](?:不|没错|答案是)[，,:：]?[^。！？!?\n]{0,32}[。！!]?$/u,
];
const SUSPENSE_MARKERS = ['谁也没想到', '没人料到', '真正的答案尚未揭晓'];
const CONTRAST_PATTERNS = [
  /不是[^。！？!?\n]{1,36}而是[^。！？!?\n]{1,36}/u,
  /与其说[^。！？!?\n]{1,36}不如说[^。！？!?\n]{1,36}/u,
  /表面上[^。！？!?\n]{1,36}(?:实际上|其实)[^。！？!?\n]{1,36}/u,
  /看似[^。！？!?\n]{1,36}(?:实则|却是)[^。！？!?\n]{1,36}/u,
  /并非[^。！？!?\n]{1,36}(?:反倒|而在于)[^。！？!?\n]{1,36}/u,
];
const SUMMARY_ENDINGS = [
  '一切才刚刚开始',
  '命运的齿轮',
  '命运的齿轮已经转动',
  '命运的齿轮开始转动',
  '真正的考验还在后面',
  '故事远未结束',
  '这不过是序幕',
  '新的篇章即将展开',
];
const SUMMARY_PATTERNS = [
  /(?:这一切|所有这些)(?:都|不过|只是)?[^。！？!?\n]{0,18}(?:命运|未来|人生|时代|意义|开始|序幕)[。！？!?]?$/u,
  /(?:命运|宿命|未来|真相|时代|传奇|意义|答案)[^。！？!?\n]{0,12}(?:刚刚开始|仍在继续|尚未揭晓|无法预知|即将展开)[。！？!?]?$/u,
];
// Python str.strip/re \s include U+001C..001F but exclude U+FEFF.
const WHITESPACE =
  '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]';
const TRIM_WHITESPACE = new RegExp(`^${WHITESPACE}+|${WHITESPACE}+$`, 'gu');
const ALL_WHITESPACE = new RegExp(`${WHITESPACE}+`, 'gu');

function dialogueOnly(paragraph: string): boolean {
  return [
    ['“', '”'],
    ['「', '」'],
    ['"', '"'],
  ].some(([left, right]) => paragraph.startsWith(left) && paragraph.endsWith(right));
}

function questionHit(paragraph: string): string | null {
  const marker = SUSPENSE_MARKERS.find((item) => paragraph.includes(item));
  if (marker !== undefined) return marker;
  for (const pattern of QUESTION_PATTERNS) {
    const match = pattern.exec(paragraph);
    if (match) return Array.from(match[0]).slice(0, 48).join('');
  }
  return null;
}

export function checkParagraphPatterns(prose: string): StaticProseIssue[] {
  const paragraphs = prose
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((paragraph) => paragraph.replace(TRIM_WHITESPACE, ''))
    .filter(Boolean);
  const issues: StaticProseIssue[] = [];
  const transitions = paragraphs
    .map((paragraph) => TRANSITION_STARTERS.find((item) => paragraph.startsWith(item)))
    .filter((item) => item !== undefined);
  const density = transitions.length / Math.max(paragraphs.length, 1);
  if (transitions.length >= 3 && density > 0.25) {
    issues.push({
      dimension: 'mechanical_transition',
      severity: '低',
      snippet: transitions.slice(0, 4).join('、'),
      message: `段首转场套语命中 ${transitions.length} 段，占非空段落 ${pythonFixed(density * 100, 0)}%，转场节奏可能机械。`,
      suggestion: '删去可由场景内容自行交代的转场词，用人物动作、地点细节或时间变化直接开段。',
      revision_strategy: 'scene_patch',
    });
  }
  const questions = paragraphs
    .filter((paragraph) => !dialogueOnly(paragraph))
    .map(questionHit)
    .filter((item) => item !== null);
  const visibleChars = Array.from(prose.replace(ALL_WHITESPACE, '')).length;
  const frequency = (questions.length * 1000) / Math.max(visibleChars, 1);
  if (questions.length >= 3 && frequency > 2) {
    issues.push({
      dimension: 'formulaic_question',
      severity: '低',
      snippet: questions.slice(0, 3).join(' / '),
      message: `叙述性设问命中 ${questions.length} 段，约每千字 ${pythonFixed(frequency, 1)} 次，悬念表达可能公式化。`,
      suggestion: '把部分设问改成可见的异常、选择代价或信息缺口，让悬念由事件产生。',
      revision_strategy: 'line_edit',
    });
  }
  const contrasts: string[] = [];
  for (const paragraph of paragraphs) {
    for (const pattern of CONTRAST_PATTERNS) {
      const match = pattern.exec(paragraph);
      if (match) {
        contrasts.push(Array.from(match[0]).slice(0, 48).join(''));
        break;
      }
    }
  }
  if (contrasts.length >= 3) {
    issues.push({
      dimension: 'binary_contrast',
      severity: '低',
      snippet: contrasts.slice(0, 3).join(' / '),
      message: `二元对比句式命中 ${contrasts.length} 段，反复对偶可能让叙述显得预制。`,
      suggestion: '保留真正改变理解的一处对比，其余改成具体行动、证据或人物判断。',
      revision_strategy: 'line_edit',
    });
  }
  const summaries = paragraphs
    .filter((paragraph) => {
      if (dialogueOnly(paragraph)) return false;
      const ending = paragraph.replace(/[。！？!?]+$/u, '');
      return (
        SUMMARY_ENDINGS.some((item) => ending.endsWith(item)) ||
        SUMMARY_PATTERNS.some((pattern) => pattern.test(paragraph))
      );
    })
    .map((paragraph) => Array.from(paragraph).slice(-48).join(''));
  if (summaries.length) {
    issues.push({
      dimension: 'hollow_summary',
      severity: '低',
      snippet: summaries.slice(0, 3).join(' / '),
      message: `发现 ${summaries.length} 处段尾空泛总结，抽象收束可能替代了实际变化。`,
      suggestion: '让段尾落在新事实、人物决定或可追踪后果上，少用泛化命运/未来总结。',
      revision_strategy: 'scene_patch',
    });
  }
  return issues;
}
