import type { AgentResultMessage } from '../../lib/api-client';
import type { ChapterBrief, ChapterBriefAdjustment } from './types';

/** 只有旧版停在章纲等作者确认的 run 才带这张卡；现在写章拟完章纲直接起草，不再要确认。 */
export function chapterBriefFromAgentResult(message: AgentResultMessage): ChapterBrief | null {
  if (message.agent_result.confirmation_kind !== 'chapter_brief') return null;
  const raw = message.agent_result.chapter_brief;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const briefId = typeof value.brief_id === 'string' ? value.brief_id : '';
  const revision = typeof value.revision === 'number' ? value.revision : 0;
  const targetPath = typeof value.target_path === 'string' ? value.target_path : '';
  const goal = typeof value.goal === 'string' ? value.goal : '';
  const min = typeof value.target_chars_min === 'number' ? value.target_chars_min : 0;
  const max = typeof value.target_chars_max === 'number' ? value.target_chars_max : 0;
  if (!briefId || revision <= 0 || !targetPath || !goal || min <= 0 || max < min) return null;
  return {
    briefId,
    revision,
    targetPath,
    chapterOrdinal: typeof value.chapter_ordinal === 'number' ? value.chapter_ordinal : null,
    chapterTitle: typeof value.chapter_title === 'string' ? value.chapter_title : null,
    goal,
    pov: typeof value.pov === 'string' ? value.pov : null,
    setting: typeof value.setting === 'string' ? value.setting : null,
    requiredBeats: stringList(value.required_beats),
    forbiddenItems: stringList(value.forbidden_items),
    continuityConstraints: stringList(value.continuity_constraints),
    targetCharsMin: min,
    targetCharsMax: max,
    ...adjustmentsOf(value.fact_adjustments),
    ...skillsOf(value.writing_skills),
  };
}

function skillsOf(value: unknown): { writingSkills?: string[] } {
  const writingSkills = stringList(value);
  return writingSkills.length ? { writingSkills } : {};
}

function adjustmentsOf(value: unknown): { factAdjustments?: ChapterBriefAdjustment[] } {
  const factAdjustments = adjustmentList(value);
  return factAdjustments.length ? { factAdjustments } : {};
}

function adjustmentList(value: unknown): ChapterBriefAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const { plan_quote: planQuote, fact_quote: factQuote, adjustment } = entry;
    if (typeof planQuote !== 'string' || typeof factQuote !== 'string') return [];
    if (typeof adjustment !== 'string' || !adjustment.trim()) return [];
    return [
      {
        planQuote,
        factQuote,
        adjustment,
        source: entry.source === 'program' ? ('program' as const) : ('model' as const),
      },
    ];
  });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
