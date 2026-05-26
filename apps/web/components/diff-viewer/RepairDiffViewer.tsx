import { diffLines, summarizeDiff, type DiffSegment } from '../../lib/text-diff';

export type RepairDiffViewerProps = {
  originalText: string;
  revisedText: string;
};

function getSegmentClassName(type: DiffSegment['type']): string {
  if (type === 'add') {
    return 'block whitespace-pre-wrap bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100';
  }
  if (type === 'del') {
    return 'block whitespace-pre-wrap bg-rose-100 text-rose-950 line-through dark:bg-rose-900/40 dark:text-rose-100';
  }
  return 'block whitespace-pre-wrap text-stone-800 dark:text-stone-200';
}

function getSegmentPrefix(type: DiffSegment['type']): string {
  if (type === 'add') return '+ ';
  if (type === 'del') return '- ';
  return '  ';
}

export function RepairDiffViewer({ originalText, revisedText }: RepairDiffViewerProps) {
  const segments = diffLines(originalText, revisedText);
  const stats = summarizeDiff(segments);
  return (
    <section aria-labelledby="repair-diff-title" data-testid="repair-diff">
      <h2 id="repair-diff-title">修订差异</h2>
      <p>
        <span data-testid="repair-diff-additions">新增 {stats.additions} 行</span>
        {' / '}
        <span data-testid="repair-diff-deletions">删除 {stats.deletions} 行</span>
        {' / '}
        <span>保持 {stats.unchanged} 行</span>
      </p>
      <pre
        className="overflow-x-auto rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm leading-6 dark:border-stone-800 dark:bg-stone-900"
        aria-label="行级差异对比"
      >
        {segments.length === 0 ? (
          <span className="block text-stone-500 dark:text-stone-400">两段文本完全一致。</span>
        ) : (
          segments.map((segment, index) => (
            <span
              key={`${segment.type}-${index}`}
              className={getSegmentClassName(segment.type)}
              data-segment-type={segment.type}
            >
              {getSegmentPrefix(segment.type)}
              {segment.text.endsWith('\n') ? segment.text : `${segment.text}`}
            </span>
          ))
        )}
      </pre>
      <details>
        <summary>查看原文与修订全文</summary>
        <div>
          <h3>原文</h3>
          <p className="whitespace-pre-wrap">{originalText}</p>
        </div>
        <div>
          <h3>修订文本</h3>
          <p className="whitespace-pre-wrap">{revisedText}</p>
        </div>
      </details>
    </section>
  );
}
