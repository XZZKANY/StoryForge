import type { AssistantTaskType } from './assistant-types';

export type AssistantIntent = {
  readonly taskType: AssistantTaskType;
  readonly title?: string;
  readonly premise: string;
  readonly tone: string;
  readonly targetWordCount?: number;
  readonly targetChapterCount: number;
  readonly targetChapterOrdinal?: number;
  readonly volumeCount?: number;
  readonly batchChapterCount?: number;
  readonly continuationMode?: 'new_book' | 'continue_book' | 'continue_volume';
  readonly requestedArtifacts: readonly (
    | 'blueprint'
    | 'chapters'
    | 'review'
    | 'repair'
    | 'markdown'
    | 'epub'
    | 'audit'
  )[];
};

const chineseDigits = new Map([
  ['零', 0],
  ['一', 1],
  ['二', 2],
  ['两', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
]);

export function parseAssistantIntent(input: string): AssistantIntent {
  const premise = input.trim();
  if (!premise) {
    throw new Error('创作目标不能为空。');
  }

  const taskType = detectTaskType(premise);
  return {
    taskType,
    premise,
    tone: detectTone(premise),
    targetWordCount: parseTargetWordCount(premise),
    targetChapterCount: taskType === 'trial_generation' ? parseTargetChapterCount(premise) : 1,
    targetChapterOrdinal:
      taskType === 'chapter_review' ? parseTargetChapterOrdinal(premise) : undefined,
    volumeCount: parseCountBeforeUnit(premise, '卷'),
    batchChapterCount: parseBatchChapterCount(premise),
    continuationMode: detectContinuationMode(premise),
    requestedArtifacts: requestedArtifactsFor(taskType),
  };
}

function detectTaskType(input: string): AssistantTaskType {
  if (/导出|审计报告|EPUB|Markdown/i.test(input)) return 'artifact_export';
  if (/审阅|修订|修复|角色有点崩|问题/.test(input)) return 'chapter_review';
  if (/继续|调整|更冷|加反转|改成/.test(input)) return 'goal_update';
  return 'trial_generation';
}

function detectTone(input: string): string {
  for (const tone of ['玄幻', '悬疑', '言情', '科幻', '都市', '历史', '奇幻']) {
    if (input.includes(tone)) return tone;
  }
  if (input.includes('短篇')) return '短篇';
  if (input.includes('中篇')) return '中篇';
  if (input.includes('长篇')) return '长篇';
  return 'StoryForge 创作';
}

function parseTargetChapterCount(input: string): number {
  return parseCountBeforeUnit(input, '章') ?? (input.includes('试读') ? 3 : 3);
}

function parseTargetChapterOrdinal(input: string): number | undefined {
  const explicit = input.match(/第\s*([0-9一二两三四五六七八九十]+)\s*章/);
  if (explicit) return parseCountToken(explicit[1]);
  return parseCountBeforeUnit(input, '章');
}

function parseBatchChapterCount(input: string): number | undefined {
  if (/先生成前?三章|前三章/.test(input)) return 3;
  const match = input.match(/先生成前?([0-9一二两三四五六七八九十]+)章/);
  return match ? parseCountToken(match[1]) : undefined;
}

function parseCountBeforeUnit(input: string, unit: string): number | undefined {
  const match = input.match(new RegExp(`([0-9一二两三四五六七八九十]+)\\s*${unit}`));
  return match ? parseCountToken(match[1]) : undefined;
}

function parseCountToken(token: string): number {
  const numeric = Number.parseInt(token, 10);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  if (token === '十') return 10;
  if (token.startsWith('十')) return 10 + (chineseDigits.get(token.at(1) ?? '') ?? 0);
  if (token.endsWith('十')) return (chineseDigits.get(token.at(0) ?? '') ?? 1) * 10;
  if (token.includes('十')) {
    const [left, right] = token.split('十');
    return (chineseDigits.get(left) ?? 1) * 10 + (chineseDigits.get(right) ?? 0);
  }
  return chineseDigits.get(token) ?? 3;
}

function parseTargetWordCount(input: string): number | undefined {
  const rangeMatch = input.match(
    /([0-9一二两三四五六七八九十]+)\s*-\s*([0-9一二两三四五六七八九十]+)\s*万字/,
  );
  if (rangeMatch) return parseCountToken(rangeMatch[2]) * 10000;
  const match = input.match(/([0-9一二两三四五六七八九十]+)\s*万字/);
  return match ? parseCountToken(match[1]) * 10000 : undefined;
}

function detectContinuationMode(input: string): AssistantIntent['continuationMode'] {
  if (/继续上一卷|继续上卷/.test(input)) return 'continue_volume';
  if (/继续/.test(input)) return 'continue_book';
  return 'new_book';
}

function requestedArtifactsFor(taskType: AssistantTaskType): AssistantIntent['requestedArtifacts'] {
  if (taskType === 'artifact_export') return ['markdown', 'epub', 'audit'];
  if (taskType === 'chapter_review') return ['review', 'repair'];
  return ['blueprint', 'chapters', 'review', 'repair'];
}
