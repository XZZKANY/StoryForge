import { Button, Textarea } from '../ui';
import type { ChapterCheckEntry } from '../../lib/api/chapter-checks';
import type { ChapterCheckHistoryState } from './useChapterCheckHistory';

const executionLabel = {
  completed: '检查已执行',
  failed: '检查执行失败',
  incomplete: '检查未完整执行',
};
const manuscriptLabel = { pass: '自动检查通过', fail: '发现稿件问题', unknown: '稿件判断未知' };

function CheckEntry({ entry }: { entry: ChapterCheckEntry }) {
  const check = entry.check;
  return (
    <details className="rounded-md border border-default p-2" data-testid="chapter-check-entry">
      <summary className="cursor-pointer text-xs text-foreground">
        <span className="break-words">{entry.targetPath ?? '目标来源未核实'}</span>
        <span className="ml-2 text-muted">
          {check ? executionLabel[check.executionStatus] : '检查状态未核实'}
        </span>
        {check && (
          <span className="ml-2 text-muted">{manuscriptLabel[check.manuscriptStatus]}</span>
        )}
      </summary>
      <div className="mt-2 space-y-2 text-xs text-muted">
        <p>
          运行 {entry.runId} · 检查记录 #{entry.artifactId} ·{' '}
          <time dateTime={entry.createdAt}>{entry.createdAt}</time>
        </p>
        {entry.checkError && <p className="text-warning">{entry.checkError}</p>}
        {check && (
          <>
            <p>
              稿件硬问题 {check.manuscriptHardCount} · 建议 {check.advisoryCount}
            </p>
            <p>
              提供正文 {check.coverage.suppliedChars} 字 · 来源回显
              {check.coverage.sourceVerified ? '已核实' : '未核实'} · 收到{' '}
              {check.coverage.received ?? '未知'} 条 / 准入 {check.coverage.validated} 条 / 上限{' '}
              {check.coverage.limit} 条 · 协议结果{check.coverage.complete ? '完整' : '不完整'}
            </p>
            <p>
              覆盖数字仅证明送达和协议校验，不证明模型找全问题。引文定位也不代表判断正确；是否采纳由作者决定。
            </p>
            <details>
              <summary className="cursor-pointer">查看原始检查源摘要</summary>
              <p className="break-all">正文 SHA-256：{check.contentSha256}</p>
              <p className="break-all">Brief SHA-256：{check.briefSha256}</p>
            </details>
            {check.findings.map((finding, index) => (
              <div key={index} className="rounded-md bg-elevated p-2">
                <p>
                  {finding.rule === 'checker_failure'
                    ? '检查器诊断'
                    : finding.severity === 'hard'
                      ? '稿件问题'
                      : '建议'}
                  ：{finding.message}
                </p>
                {finding.evidence !== null && (
                  <>
                    <p>
                      {finding.evidenceVerified
                        ? `原始检查已定位引文（第 ${finding.line} 行）`
                        : '引用未核实'}
                    </p>
                    <blockquote className="whitespace-pre-wrap break-words text-foreground">
                      {finding.evidence}
                    </blockquote>
                  </>
                )}
              </div>
            ))}
          </>
        )}
        {entry.candidateError && <p className="text-warning">{entry.candidateError}</p>}
        {entry.candidateContent !== null && (
          <details>
            <summary className="cursor-pointer text-foreground">查看只读候选稿</summary>
            <p className="my-2">这份候选稿未生成补丁；查看或复制不会写回项目文件。</p>
            <Textarea
              readOnly
              value={entry.candidateContent}
              rows={8}
              className="max-h-64 text-xs"
              aria-label={`${entry.targetPath ?? '章节'}的只读候选稿`}
            />
          </details>
        )}
      </div>
    </details>
  );
}

export function ChapterCheckHistoryPanel({ history }: { history: ChapterCheckHistoryState }) {
  if (!history.enabled || (!history.loading && !history.error && !history.entries.length))
    return null;
  return (
    <section
      className="max-h-[35vh] flex-shrink-0 space-y-2 overflow-auto border-t border-default px-4 py-2"
      aria-label="章节检查记录"
      data-testid="chapter-check-history"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">章节检查记录</h3>
        <Button size="compact" variant="ghost" onClick={history.reload} disabled={history.loading}>
          重新读取记录
        </Button>
      </div>
      {history.loading && (
        <p className="text-xs text-muted" role="status">
          正在核对检查记录；已有内容是上次读取的历史。
        </p>
      )}
      {history.error && (
        <p className="text-xs text-warning" role="alert">
          检查记录读取失败：{history.error}。不会重新执行写作或检查。
        </p>
      )}
      {history.truncated && (
        <p className="text-xs text-muted">仅展示最近 20 条检查记录，不代表完整历史。</p>
      )}
      {history.entries.map((entry) => (
        <CheckEntry key={entry.artifactId} entry={entry} />
      ))}
    </section>
  );
}
