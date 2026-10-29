/**
 * 对话输入框空着时的「下一句可以说什么」：确定性规则、不调模型（作者 2026-10-29 批准的规则）。
 *
 * 事实全部照抄现成来源：章序来自 `book.context`（与「接着写」同一份，经 `chapter-handoff`），
 * 立项缺什么来自引擎立项检查，正文 / 立项文件的归类用引擎同一套判断。这里只按优先级挑一句，
 * 读不到的事实就不出那一条，不猜。
 */

import { countsAsChapter } from './api/manuscript-paths';
import {
  SETUP_KINDS,
  setupKindOfPath,
  type ProjectSetupFacts,
  type SetupKind,
} from './api/project-setup';
import { resolveHandoffChapters, type HandoffChapter } from './chapter-handoff';
import { normalizePathForMatch } from './project/path';

/** 灰字里跟在提示句后面的按键说明；Tab 只填提示句本身。 */
export const COMPOSER_HINT_TAB_SUFFIX = '　· Tab 填入';

export type ComposerHintInput = {
  running: boolean;
  /** 还没有任何消息的新会话。 */
  newSession: boolean;
  /** 对话里最后一条是 AI 的完整回复时的原文；最后一条是作者的、或 AI 还没说完，就是 null。 */
  lastAssistantText: string | null;
  /** 本会话刚接受的补丁目标（作品内相对路径）；作者再发一句或切会话后为 null。 */
  justAcceptedPath: string | null;
  setup: ProjectSetupFacts | null;
  /** 后端阅读序章节；还没读到是 null。 */
  chapters: ReadonlyArray<HandoffChapter> | null;
};

// 立项顺序跟引擎 SETUP_KINDS 走；只缺世界规则不出这一类。
const NEXT_SETUP_HINT: Partial<Record<SetupKind, string>> = {
  outline: '接着写总纲',
  character: '接着建主角人物',
};

const TRAILING_DECORATION = /[\s*_`~#"'”’」』》〉）)\]】}〕]+$/u;

export function endsWithQuestion(text: string | null): boolean {
  if (!text) return false;
  return /[？?]$/u.test(text.replace(TRAILING_DECORATION, ''));
}

function chapterOrdinalOf(
  relativePath: string,
  chapters: ReadonlyArray<HandoffChapter> | null,
): number | null {
  const target = normalizePathForMatch(relativePath);
  const found = chapters?.find((chapter) => normalizePathForMatch(chapter.relativePath) === target);
  return found?.ordinal ?? null;
}

function acceptedHint(
  relativePath: string,
  setup: ProjectSetupFacts | null,
  chapters: ReadonlyArray<HandoffChapter> | null,
): string | null {
  if (countsAsChapter(relativePath)) {
    const ordinal = chapterOrdinalOf(relativePath, chapters);
    return ordinal === null ? null : `接着写第 ${ordinal + 1} 章`;
  }
  // 立项检查只管开写第一章之前；已经有正文就不再催立项。
  if (setupKindOfPath(relativePath) === null || !setup || setup.hasManuscript) return null;
  const next = setup.missing[0];
  return next ? (NEXT_SETUP_HINT[next] ?? null) : null;
}

export function composerHint(input: ComposerHintInput): string | null {
  if (input.running) return null;
  const { setup, chapters } = input;
  const readyForFirstChapter = setup !== null && !setup.hasManuscript && !setup.missing.length;
  if (input.justAcceptedPath !== null) {
    const accepted = acceptedHint(input.justAcceptedPath, setup, chapters);
    if (accepted) return accepted;
    if (readyForFirstChapter) return '开写第一章';
  }
  if (endsWithQuestion(input.lastAssistantText)) return '按你的建议来';
  if (readyForFirstChapter) return '开写第一章';
  if (!input.newSession) return null;
  if (
    setup !== null &&
    !setup.hasManuscript &&
    SETUP_KINDS.every((kind) => setup.missing.includes(kind))
  )
    return '先聊聊这本书想写什么';
  if (!chapters?.length) return null;
  const { lastChapter, next } = resolveHandoffChapters(chapters);
  return lastChapter ? `先聊聊第 ${next.chapterOrdinal} 章怎么写` : null;
}
