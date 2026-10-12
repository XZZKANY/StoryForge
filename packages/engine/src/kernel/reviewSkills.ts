import { CLICHE_PHRASES } from './craft';
import { compareCodePoints } from './json';
import { compactText, pythonStrip } from './pythonText';

/** 「缺席即问题」的探测词表剔掉软禁用套话：否则一段全是套话的文字能靠「忽然」骗过冲突检查。 */
const absenceMarkers = (...markers: string[]) =>
  markers.filter((marker) => !(CLICHE_PHRASES as readonly string[]).includes(marker));

export const CONFLICT_MARKERS = absenceMarkers(
  '但',
  '却',
  '然而',
  '忽然',
  '突然',
  '逼',
  '拦',
  '威胁',
  '冲突',
  '质问',
);
export const ENDING_HOOK_MARKERS = absenceMarkers(
  '？',
  '?',
  '却',
  '忽然',
  '门外',
  '电话',
  '消息',
  '血',
  '真相',
  '秘密',
);
export const MOTIVATION_MARKERS = absenceMarkers(
  '因为',
  '为了',
  '想',
  '决定',
  '害怕',
  '不敢',
  '必须',
  '答应',
  '拒绝',
);

export type ReviewIssue = {
  agent: string;
  severity: string;
  code: string;
  message: string;
  evidence: string;
};

export const REVIEW_SKILLS: Readonly<Record<string, { agent: string; focus: string }>> = {
  plot: { agent: 'plot-agent', focus: '剧情结构、冲突推进、章尾钩子' },
  character: { agent: 'character-agent', focus: '人物动机、称谓、关系一致性' },
  prose: { agent: 'prose-agent', focus: '文风、节奏、信息密度' },
};

type Bundle = { [key: string]: unknown } | null | undefined;
type ContextFile = { [key: string]: unknown };

export function contextFiles(bundle: Bundle): ContextFile[] {
  const files = bundle && typeof bundle === 'object' ? bundle.files : undefined;
  return Array.isArray(files)
    ? files.filter(
        (item): item is ContextFile =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

const first = (...values: unknown[]) => values.find((value) => Boolean(value)) ?? null;

export function reviewContextSummary(bundle: Bundle) {
  const files = contextFiles(bundle);
  const kinds = [
    ...new Set(
      files
        .map((item) => item.kind)
        .filter((kind): kind is string => typeof kind === 'string' && Boolean(pythonStrip(kind))),
    ),
  ].sort(compareCodePoints);
  return {
    file_count: files.length,
    kinds,
    files: files.slice(0, 8).map((item) => ({
      relative_path: first(item.relative_path, item.relativePath, item.path) ?? item.path ?? null,
      kind: item.kind ?? null,
      title: item.title ?? null,
    })),
  };
}

const issue = (
  key: string,
  severity: string,
  code: string,
  message: string,
  evidence: string,
): ReviewIssue => ({
  agent: REVIEW_SKILLS[key].agent,
  severity,
  code,
  message,
  evidence,
});
const length = (text: string) => Array.from(text).length;

export function plotAgentIssues(content: string, paragraphs: readonly string[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (length(pythonStrip(content)) < 240)
    issues.push(
      issue(
        'plot',
        'medium',
        'plot.too_short_for_scene',
        '启发式信号：篇幅较短；尚未评估作者目标，不能据此认定场景不完整。',
        '正文少于 240 字。',
      ),
    );
  if (!CONFLICT_MARKERS.some((marker) => content.includes(marker)))
    issues.push(
      issue(
        'plot',
        'high',
        'plot.conflict_signal_missing',
        '启发式信号：未见冲突关键词；尚未评估作者目标，静场不因此被判为问题。',
        '未检测到转折、阻碍或对抗类关键词。',
      ),
    );
  const ending = paragraphs.length
    ? paragraphs[paragraphs.length - 1]
    : Array.from(content).slice(-120).join('');
  if (ending && !ENDING_HOOK_MARKERS.some((marker) => ending.includes(marker)))
    issues.push(
      issue(
        'plot',
        'medium',
        'plot.ending_hook_weak',
        '启发式信号：未见结尾钩子关键词；尚未评估作者目标，不代表必须补钩子。',
        compactText(ending, 120),
      ),
    );
  return issues;
}

export function characterAgentIssues(content: string, bundle: Bundle): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const context = reviewContextSummary(bundle);
  if (
    !context.kinds.includes('character') &&
    ['他', '她', '我', '你'].some((word) => content.includes(word))
  )
    issues.push(
      issue(
        'character',
        'medium',
        'character.context_missing',
        '本轮上下文未包含人物资料，人物动机和关系一致性只能做弱检查。',
        'context_bundle 中没有 character 类型文件。',
      ),
    );
  if (
    length(pythonStrip(content)) >= 240 &&
    !MOTIVATION_MARKERS.some((marker) => content.includes(marker))
  )
    issues.push(
      issue(
        'character',
        'medium',
        'character.motivation_underexplained',
        '启发式信号：未见动机关键词；尚未评估作者目标，刻意隐藏动机不因此被判为问题。',
        '未检测到明显动机或选择类表达。',
      ),
    );
  return issues;
}

export function proseAgentIssues(content: string, paragraphs: readonly string[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const telling = ['说明', '显然', '其实', '事实上', '这意味着', '让人觉得'].filter((marker) =>
    content.includes(marker),
  );
  if (telling.length)
    issues.push(
      issue(
        'prose',
        'medium',
        'prose.telling_over_showing',
        '启发式信号：出现解释性表达；尚未评估作者目标，不能据此否定作者保留的说明。',
        `检测到：${telling.join(', ')}`,
      ),
    );
  const long = paragraphs.filter((paragraph) => length(paragraph) > 280);
  if (long.length)
    issues.push(
      issue(
        'prose',
        'low',
        'prose.paragraph_too_dense',
        '启发式信号：存在长段落；尚未评估作者目标，需结合刻意节奏核查阅读负担。',
        compactText(long[0], 120),
      ),
    );
  return issues;
}

export function suggestedActionsForReview(issues: {
  plotIssues: readonly unknown[];
  characterIssues: readonly unknown[];
  proseIssues: readonly unknown[];
}): string[] {
  const actions: string[] = [];
  if (issues.plotIssues.length)
    actions.push('先按作者目标核查剧情问题；静场、留白或过渡不因缺少转折与钩子而必须改写。');
  if (issues.characterIssues.length)
    actions.push('按作者目标核对人物与关系，仅处理有依据的矛盾，保留刻意隐藏的动机。');
  if (issues.proseIssues.length)
    actions.push(
      '按作者目标核查语言问题，逐字保留明确要求保留的说明与情绪命名，不统一改成画面化表达。',
    );
  if (!actions.length)
    actions.push('本轮未报告问题，不代表已证明文学质量或已核实所有作者要求；是否继续由作者决定。');
  return actions;
}
