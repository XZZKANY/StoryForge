import type { ChapterWriteRequest } from '../../lib/assistant-events';
import {
  discussNextChapterPrompt,
  pickUpPromisePrompt,
  stalePromiseDetail,
  type ChapterHandoff,
} from '../../lib/chapter-handoff';
import { Sparkles } from '../icons/shell-icons';

/**
 * 新会话的开场：伙伴先开口，每一句都来自这本书的确定性事实（上一章结尾、伏笔台账、章序），
 * 不调模型、不花钱。作者点一个下一步就进入正常对话；点之前它只是一张卡，不进会话记录。
 */
export function PartnerOpening({
  handoff,
  onDraft,
  onAsk,
}: {
  handoff: ChapterHandoff;
  onDraft: (request: ChapterWriteRequest) => void;
  onAsk: (prompt: string) => void;
}) {
  const next = handoff.next.chapterOrdinal;
  const last = handoff.lastChapter;
  const promise = handoff.stalePromises[0] ?? null;
  const sources = [
    handoff.excerptSource ? `${handoff.excerptSource} 结尾` : null,
    handoff.stalePromises.length > 0 ? '观测镜伏笔账' : null,
  ].filter((source): source is string => source !== null);
  const chip =
    'interactive-press inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-agent/40 px-3 text-xs text-agent transition-colors hover:bg-agent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent';

  return (
    <article
      className="max-w-[760px] animate-slide-up-fade text-sm leading-7 text-foreground"
      data-testid="partner-opening"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-agent text-2xs font-semibold text-agent-foreground shadow-sm">
          AI
        </span>
        <span className="text-2xs text-subtle">StoryForge</span>
      </div>
      <div className="space-y-3 py-1">
        {last === null ? (
          <p>这本书还没有正文。第 1 章想从哪儿开始？</p>
        ) : (
          <>
            {handoff.excerpt ? (
              <div>
                <p>第 {last.ordinal} 章停在这里：</p>
                <blockquote className="mt-1.5 space-y-1 border-l-2 border-border-strong pl-3 leading-6 text-muted">
                  {handoff.excerpt.map((paragraph, index) => (
                    <p key={index}>
                      {index === 0 && handoff.excerptClipped ? '……' : ''}
                      {paragraph}
                    </p>
                  ))}
                </blockquote>
              </div>
            ) : (
              <p>上一章是第 {last.ordinal} 章。</p>
            )}
            {handoff.stalePromises.length > 0 ? (
              <p data-testid="partner-opening-promises">
                {handoff.stalePromises.length === 1 ? '还有一条线没收：' : '还有几条线没收：'}
                {handoff.stalePromises
                  .map((entry) => `「${entry.title}」${stalePromiseDetail(entry)}`)
                  .join('；')}
                。
              </p>
            ) : null}
            <p>第 {next} 章从哪儿接？</p>
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className={chip}
            onClick={() => onDraft(handoff.next)}
            data-testid="partner-opening-draft"
          >
            <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
            起草第 {next} 章
          </button>
          <button
            type="button"
            className={chip}
            onClick={() => onAsk(discussNextChapterPrompt(handoff))}
            data-testid="partner-opening-discuss"
          >
            {last === null ? '先聊聊开篇' : `先聊聊第 ${next} 章怎么走`}
          </button>
          {promise ? (
            <button
              type="button"
              className={chip}
              onClick={() => onAsk(pickUpPromisePrompt(handoff, promise))}
              data-testid="partner-opening-promise"
              title={`「${promise.title}」${stalePromiseDetail(promise)}`}
            >
              <span className="truncate">接上「{promise.title}」</span>
            </button>
          ) : null}
        </div>
        {sources.length > 0 ? (
          <p className="text-2xs leading-5 text-subtle">依据：{sources.join(' · ')}</p>
        ) : null}
      </div>
    </article>
  );
}
