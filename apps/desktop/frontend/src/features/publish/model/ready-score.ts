import type { PublishSettings, ReadyBreakdown, ReadySignals } from './types';

export function computeReadyScore(
  signals: ReadySignals,
  settings: Pick<PublishSettings, 'minChaptersForReady' | 'minCharsForReady'>,
): ReadyBreakdown {
  const blockReasons: string[] = [];
  if (!signals.hasTitle) blockReasons.push('无标题');
  if (signals.chapterCount <= 0 && signals.charCount <= 0) {
    blockReasons.push('无任何正文');
  }

  let volume = 0;
  const chapterOk = signals.chapterCount >= settings.minChaptersForReady;
  const charsOk = signals.charCount >= settings.minCharsForReady;
  if (chapterOk || charsOk) volume = 40;
  else if (signals.chapterCount > 0 || signals.charCount > 0) volume = 15;

  const checklist = signals.checklistComplete ? 30 : 0;
  const meta = signals.hasBlurbAndTags ? 15 : 0;
  const activity = signals.editedInLast7Days || signals.readyConfirmed ? 15 : 0;

  let score = volume + checklist + meta + activity;
  if (signals.readyConfirmed && score < 70) {
    score = Math.max(score, 70);
  }
  score = Math.min(100, score);

  return {
    score: blockReasons.length > 0 ? Math.min(score, 20) : score,
    blocked: blockReasons.length > 0,
    blockReasons,
    parts: { volume, checklist, meta, activity },
  };
}

export function isReadyEnough(
  breakdown: ReadyBreakdown,
  settings: Pick<PublishSettings, 'readyScoreThreshold'>,
  forceReady: boolean,
): boolean {
  if (breakdown.blocked && !forceReady) return false;
  if (forceReady) return true;
  return breakdown.score >= settings.readyScoreThreshold;
}
