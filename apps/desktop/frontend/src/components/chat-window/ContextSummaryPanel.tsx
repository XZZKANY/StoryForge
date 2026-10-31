import { useState } from 'react';

import { basename } from '../app/helpers';
import { Button } from '../ui';
import {
  semanticKindLabel,
  type ContextBundle,
  type SemanticFile,
} from '../../lib/project-context';
import {
  contextBudgetText,
  contextCoverageWarnings,
  type ContextCoverageWarning,
} from './display-utils';

type Surface = 'dock' | 'rail';

/** 小条底色就是输入框外的浅灰，侧栏底色是输入框的深色：小块各用对方的颜色才看得出来。 */
const CHIP_CLASS: Record<Surface, string> = {
  dock: 'rounded-sm bg-background px-1.5 leading-5 text-muted',
  rail: 'rounded-sm bg-elevated px-1.5 leading-5 text-muted',
};

function BundleDetails({
  bundle,
  warnings,
  surface,
}: {
  bundle: ContextBundle;
  warnings: ContextCoverageWarning[];
  surface: Surface;
}) {
  return (
    <div className="space-y-1.5">
      <div>{contextBudgetText(bundle)}</div>
      {bundle.files.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="这一轮带上的参考资料">
          {bundle.files.map((file) => (
            <li
              key={file.path}
              className={`max-w-full truncate ${CHIP_CLASS[surface]}`}
              title={file.relativePath}
            >
              {basename(file.relativePath).replace(/\.md$/i, '')}
            </li>
          ))}
        </ul>
      )}
      {warnings.map((warning) => (
        <div key={warning.text} className={warning.tone === 'warning' ? 'text-warning' : undefined}>
          {warning.detail}
        </div>
      ))}
      {surface === 'dock' && bundle.files.length > 0 && (
        <div className="text-3xs">发送前选好的才算在这里，AI 回答时自己翻的文件不算。</div>
      )}
    </div>
  );
}

function PinnedList({
  paths,
  surface,
  onToggle,
}: {
  paths: string[];
  surface: Surface;
  onToggle: (path: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="pinned-context-list">
      <span>固定的：</span>
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          className={`inline-flex max-w-full items-center gap-1 transition-colors hover:text-foreground ${CHIP_CLASS[surface]}`}
          title={`${path} · 点击取消固定`}
          aria-label={`取消固定参考：${path}`}
          onClick={() => onToggle(path)}
        >
          <span className="truncate">{path}</span>
          <span aria-hidden="true" className="text-subtle">
            ✕
          </span>
        </button>
      ))}
    </div>
  );
}

function IndexErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 text-xs text-warning"
      data-testid="context-candidates-error"
    >
      <span className="min-w-0 flex-1 break-words">作品上下文索引失败：{error}</span>
      <Button
        size="compact"
        variant="ghost"
        onClick={onRetry}
        data-testid="context-candidates-retry"
      >
        重试
      </Button>
      <Button
        size="compact"
        variant="ghost"
        onClick={onDismiss}
        data-testid="context-candidates-error-dismiss"
      >
        关闭
      </Button>
    </div>
  );
}

function CandidatePicker({
  candidates,
  loading,
  error,
  showError,
  pinnedPaths,
  onToggle,
  onRetry,
}: {
  candidates: SemanticFile[];
  loading: boolean;
  error: string | null;
  /** 错误条已经在别处亮着就不在列表里再说一遍。 */
  showError: boolean;
  pinnedPaths: string[];
  onToggle: (path: string) => void;
  onRetry: () => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-0.5 border-t border-border/60 px-1.5 py-1.5"
      data-testid="context-picker"
    >
      {loading ? (
        <div className="px-2 py-1 text-xs text-subtle" data-testid="context-candidates-loading">
          正在读取作品上下文…
        </div>
      ) : error ? (
        showError ? (
          <div
            className="flex items-center gap-2 px-2 py-1 text-xs text-warning"
            data-testid="context-candidates-picker-error"
          >
            <span className="min-w-0 flex-1 break-words">作品上下文索引失败：{error}</span>
            <Button
              size="compact"
              variant="ghost"
              onClick={onRetry}
              data-testid="context-candidates-picker-retry"
            >
              重试
            </Button>
          </div>
        ) : null
      ) : candidates.length === 0 ? (
        <div className="px-2 py-1 text-xs text-subtle">当前作品还没有可选的 Markdown 上下文。</div>
      ) : (
        candidates.map((file) => {
          const pinned = pinnedPaths.includes(file.relativePath) || pinnedPaths.includes(file.path);
          return (
            <button
              key={file.path}
              type="button"
              className={`flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs ${pinned ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-background'}`}
              onClick={() => onToggle(file.relativePath)}
              data-testid="context-candidate"
              data-context-path={file.relativePath}
              title={file.relativePath}
            >
              <span className="w-14 flex-shrink-0 whitespace-nowrap text-subtle">
                {semanticKindLabel(file.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
              <span className="flex-shrink-0 text-subtle">{pinned ? '已固定' : '固定'}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

/**
 * 本轮参考资料，三种摆法：
 * - dock：输入框顶边小条里的一行，收起只一行字；有警告或在选资料时才出来。
 * - rail：对话侧栏里的一块，有过一轮参考资料就一直列着；不含选择列表。
 * - picker：有侧栏时输入框顶边只放选择列表（点「+」的地方就在旁边），说明都在侧栏里。
 */
export function ContextSummaryPanel({
  variant = 'dock',
  compact = false,
  currentFileLabel,
  explicitContextPaths,
  contextCandidates,
  contextCandidatesLoading,
  contextCandidatesError,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onRetryContextCandidates,
}: {
  variant?: 'dock' | 'rail' | 'picker';
  compact?: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextCandidatesLoading: boolean;
  contextCandidatesError: string | null;
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  onRetryContextCandidates: () => void;
}) {
  const [expanded, setExpanded] = useState(!compact);
  // 上下文索引错误条可关闭：按错误串记忆已关内容，新错误会重新出现；打开选择器时
  // 无论是否已关都在列表区保留重试入口，避免关掉后找不到恢复路径。
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const errorBannerVisible =
    Boolean(contextCandidatesError) && contextCandidatesError !== dismissedError;
  const handleRetryCandidates = () => {
    setDismissedError(null);
    onRetryContextCandidates();
  };
  const coverageWarnings = lastContextBundle
    ? contextCoverageWarnings(lastContextBundle.budget)
    : [];
  const visibleCandidates = contextCandidates
    .filter((file) => file.relativePath !== currentFileLabel)
    .slice(0, 24);
  const picker = (showError: boolean) => (
    <CandidatePicker
      candidates={visibleCandidates}
      loading={contextCandidatesLoading}
      error={contextCandidatesError}
      showError={showError}
      pinnedPaths={explicitContextPaths}
      onToggle={onTogglePinnedContext}
      onRetry={handleRetryCandidates}
    />
  );
  const warnings = (
    <>
      {missingContextPaths.length > 0 && (
        <div className="break-words text-xs text-warning" data-testid="missing-context-warning">
          未读到：{missingContextPaths.join('、')}
        </div>
      )}
      {errorBannerVisible && contextCandidatesError && (
        <IndexErrorBanner
          error={contextCandidatesError}
          onRetry={handleRetryCandidates}
          onDismiss={() => setDismissedError(contextCandidatesError)}
        />
      )}
    </>
  );

  if (variant === 'picker') {
    if (!contextPickerOpen) return null;
    return (
      <section
        className="flex max-h-[40vh] min-h-0 flex-col"
        data-testid="context-summary"
        data-variant="picker"
      >
        <div className="flex min-h-8 flex-shrink-0 items-center gap-2 px-3 py-0.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            选参考资料 · 固定的每轮都带上
          </span>
          <Button
            size="compact"
            variant="ghost"
            onClick={onAddContext}
            data-testid="context-picker-toggle"
          >
            完成
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto">{picker(true)}</div>
      </section>
    );
  }

  if (variant === 'rail') {
    const shown =
      lastContextBundle ||
      explicitContextPaths.length > 0 ||
      missingContextPaths.length > 0 ||
      errorBannerVisible;
    if (!shown) return null;
    return (
      <section
        aria-label="参考资料"
        className="space-y-2 px-3 py-2.5 text-xs text-subtle"
        data-testid="side-rail-references"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-foreground">参考资料</h3>
            <p className="text-2xs text-subtle">发送前选好的；AI 自己翻的见「这一轮读了」</p>
          </div>
          <Button
            size="compact"
            variant="ghost"
            onClick={onAddContext}
            aria-expanded={contextPickerOpen}
            data-testid="side-rail-references-add"
          >
            {contextPickerOpen ? '完成' : '添加'}
          </Button>
        </div>
        {lastContextBundle && (
          <BundleDetails bundle={lastContextBundle} warnings={coverageWarnings} surface="rail" />
        )}
        {explicitContextPaths.length > 0 && (
          <PinnedList
            paths={explicitContextPaths}
            surface="rail"
            onToggle={onTogglePinnedContext}
          />
        )}
        {warnings}
      </section>
    );
  }

  const hasWarning = Boolean(
    missingContextPaths.length || contextCandidatesError || coverageWarnings.length,
  );
  // 空会话不展示上下文占位；只有作者主动打开或真实警告才占用空间。
  if (!contextPickerOpen && !hasWarning) return null;
  const detailsOpen = expanded || contextPickerOpen;

  // 贴在输入框顶边的一行（ComposerBox 的 dock）：收起时只一行字；展开或选资料时标题行不动，下面整块一起滚。
  return (
    <section
      className="flex max-h-[40vh] min-h-0 flex-col"
      data-testid="context-summary"
      data-compact={compact ? 'true' : 'false'}
      data-expanded={detailsOpen ? 'true' : 'false'}
    >
      <div className="flex min-h-8 flex-shrink-0 items-center gap-2 px-3 py-0.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-muted transition-colors hover:text-foreground"
          onClick={() => {
            if (contextPickerOpen) onAddContext();
            else setExpanded((value) => !value);
          }}
          data-testid="context-summary-toggle"
          aria-expanded={detailsOpen}
        >
          <span
            aria-hidden="true"
            className={`flex-shrink-0 text-3xs text-subtle transition-transform ${detailsOpen ? '' : '-rotate-90'}`}
          >
            ▾
          </span>
          <span className="min-w-0 truncate">
            参考资料
            {lastContextBundle ? ` · ${lastContextBundle.budget.fileCount} 份` : ''}
            {explicitContextPaths.length > 0 ? ` · 固定 ${explicitContextPaths.length}` : ''}
          </span>
          {coverageWarnings.map((warning) =>
            warning.tone === 'warning' ? (
              <span
                key={warning.text}
                className="flex-shrink-0 rounded-sm bg-warning/15 px-1.5 py-px text-3xs leading-4 text-warning"
                data-testid="context-truncated-badge"
              >
                {warning.text}
              </span>
            ) : (
              <span
                key={warning.text}
                className="flex-shrink-0 text-subtle before:mr-1.5 before:content-['·']"
                data-testid="context-truncated-badge"
              >
                {warning.text}
              </span>
            ),
          )}
        </button>
        <Button
          size="compact"
          variant="ghost"
          onClick={onAddContext}
          data-testid="context-picker-toggle"
        >
          {contextPickerOpen ? '完成' : '添加'}
        </Button>
      </div>

      <div className="min-h-0 overflow-y-auto">
        {detailsOpen && (lastContextBundle || explicitContextPaths.length > 0) && (
          <div className="space-y-2 px-3 pb-2 text-xs text-subtle">
            {lastContextBundle && (
              <BundleDetails
                bundle={lastContextBundle}
                warnings={coverageWarnings}
                surface="dock"
              />
            )}
            {explicitContextPaths.length > 0 && (
              <PinnedList
                paths={explicitContextPaths}
                surface="dock"
                onToggle={onTogglePinnedContext}
              />
            )}
          </div>
        )}
        {(missingContextPaths.length > 0 || errorBannerVisible) && (
          <div className="space-y-2 px-3 pb-2">{warnings}</div>
        )}
        {contextPickerOpen && picker(!errorBannerVisible)}
      </div>
    </section>
  );
}
