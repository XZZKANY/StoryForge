import type { AgentResultMessage } from '../../lib/api-client';
import type { ChapterBrief } from './types';

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
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
