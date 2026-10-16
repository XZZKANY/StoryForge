/**
 * 写作工作台中栏没开文件时的去处（作者 10-16 ①：进写作台中间是空的、第 5 章要自己去
 * 文件树最底下找）。有章节就给「接着写第 N 章」；空书先引去和 AI 聊——先聊后写，
 * 不在这里推「写第 1 章」。章节还没读出来时只说正在读，不先下「空书」的结论。
 */
import { ChevronRight } from '../icons/shell-icons';
import { Button } from '../ui';

export function WritingDeskEmptyState({
  resumeOrdinal,
  bookEmpty,
  loading,
  onResume,
  onDiscussBook,
}: {
  /** 停下的那一章（当前章，否则阅读序最新一章）的序号；没有可接着写的章节时为 null。 */
  resumeOrdinal: number | null;
  /** 章节索引已读完且一章都没有。 */
  bookEmpty: boolean;
  loading: boolean;
  onResume?: () => void;
  onDiscussBook?: () => void;
}) {
  if (resumeOrdinal !== null && onResume) {
    return (
      <div className="max-w-sm text-center" data-testid="writing-desk-resume">
        <p className="mb-1 text-base text-foreground">还没打开章节</p>
        <p className="mb-4 text-sm text-muted">从停下的地方接着写，或者在左边挑一章。</p>
        <Button
          size="md"
          variant="primary"
          trailingIcon={<ChevronRight size={14} strokeWidth={1.7} />}
          onClick={onResume}
          data-testid="writing-desk-resume-chapter"
        >
          接着写第 {resumeOrdinal} 章
        </Button>
      </div>
    );
  }
  if (bookEmpty && onDiscussBook) {
    return (
      <div className="max-w-sm text-center" data-testid="writing-desk-empty-book">
        <p className="mb-1 text-base text-foreground">这本书还没有正文</p>
        <p className="mb-4 text-sm text-muted">先和 AI 聊聊想写个什么样的故事，想清楚了再动笔。</p>
        <Button
          size="md"
          variant="primary"
          trailingIcon={<ChevronRight size={14} strokeWidth={1.7} />}
          onClick={onDiscussBook}
          data-testid="writing-desk-discuss-book"
        >
          和 AI 聊聊这本书
        </Button>
      </div>
    );
  }
  return (
    <div className="text-center" data-testid="writing-desk-pending">
      <p className="mb-1 text-base text-foreground">未选择文件</p>
      <p className="text-sm text-muted">
        {loading ? '正在读取章节…' : '在左边的手稿或文件里打开一章开始写'}
      </p>
    </div>
  );
}
