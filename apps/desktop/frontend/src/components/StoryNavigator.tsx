/**
 * 小说项目导航。
 * 文件视角保持真实目录树，故事视角按 StoryForge 语义目录重组同一批 Markdown 文件。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  buildProjectIndex,
  semanticKindLabel,
  type ProjectIndex,
  type SemanticFile,
  type SemanticKind,
} from '../lib/project-context';
import { ResourceExplorer } from './ResourceExplorer';
import { MarkdownFileIcon } from './StoryIcons';

type StoryNavigatorProps = {
  projectPath: string | null;
  currentFile: string | null;
  previewFile?: string | null;
  refreshVersion?: number;
  onFileSelect: (filePath: string) => void;
  onFilePreview?: (filePath: string) => void;
};

type NavigatorTab = 'files' | 'story';

const STORY_GROUPS: Array<{ kind: SemanticKind; description: string }> = [
  { kind: 'outline', description: '总纲、章节节点、场景计划' },
  { kind: 'character', description: '角色小传、关系、成长线' },
  { kind: 'setting', description: '世界观、地点、规则、术语' },
  { kind: 'timeline', description: '事件顺序、回忆、因果链' },
  { kind: 'foreshadowing', description: '埋线、回收、读者预期' },
  { kind: 'draft', description: '章节正文、片段草稿' },
  { kind: 'quality', description: '审稿、修订、验收记录' },
  { kind: 'export', description: '导出稿与发布制品' },
  { kind: 'other', description: '未归类 Markdown' },
];

function groupFiles(files: SemanticFile[]): Record<SemanticKind, SemanticFile[]> {
  const groups = Object.fromEntries(
    STORY_GROUPS.map((group) => [group.kind, [] as SemanticFile[]]),
  ) as Record<SemanticKind, SemanticFile[]>;

  for (const file of files) {
    groups[file.kind].push(file);
  }

  return groups;
}

export function buildStoryNavigationGroups(files: SemanticFile[]) {
  const groupedFiles = groupFiles(files);
  return STORY_GROUPS.map((group) => ({
    ...group,
    files: groupedFiles[group.kind],
  })).filter((group) => group.files.length > 0);
}

export function StoryNavigator({
  projectPath,
  currentFile,
  previewFile = null,
  refreshVersion = 0,
  onFileSelect,
  onFilePreview,
}: StoryNavigatorProps) {
  const [activeTab, setActiveTab] = useState<NavigatorTab>('files');
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath || activeTab !== 'story') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 项目或视图失效时同步清空派生索引
      setIndex(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextIndex = await buildProjectIndex(projectPath);
        if (!cancelled) setIndex(nextIndex);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载故事索引失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, projectPath, refreshVersion]);

  const storyGroups = useMemo(() => buildStoryNavigationGroups(index?.files ?? []), [index]);

  return (
    <div className="flex h-full flex-col bg-background" data-testid="story-navigator">
      <div className="sf-panel-header border-border bg-background">
        <div
          className="flex h-7 rounded-md border border-border bg-background p-0.5"
          role="tablist"
          aria-label="项目导航视图"
        >
          <NavigatorTabButton
            label="文件"
            active={activeTab === 'files'}
            onClick={() => setActiveTab('files')}
          />
          <NavigatorTabButton
            label="故事"
            active={activeTab === 'story'}
            onClick={() => setActiveTab('story')}
          />
        </div>
        {index && activeTab === 'story' && (
          <span className="text-[11px] text-subtle" data-testid="story-file-count">
            {index.files.length} 个文件
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'files' ? (
          <ResourceExplorer
            projectPath={projectPath}
            currentFile={currentFile}
            previewFile={previewFile}
            refreshVersion={refreshVersion}
            showHeader={false}
            onFileSelect={onFileSelect}
            onFilePreview={onFilePreview}
          />
        ) : (
          <StoryIndexView
            projectPath={projectPath}
            currentFile={currentFile}
            previewFile={previewFile}
            loading={loading}
            error={error}
            storyGroups={storyGroups}
            onFileSelect={onFileSelect}
            onFilePreview={onFilePreview}
          />
        )}
      </div>
    </div>
  );
}

function NavigatorTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`h-5 rounded px-2 text-[11px] font-medium transition-colors ${
        active ? 'bg-elevated text-foreground' : 'text-muted hover:bg-surface hover:text-foreground'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StoryIndexView({
  projectPath,
  currentFile,
  previewFile,
  loading,
  error,
  storyGroups,
  onFileSelect,
  onFilePreview,
}: {
  projectPath: string | null;
  currentFile: string | null;
  previewFile: string | null;
  loading: boolean;
  error: string | null;
  storyGroups: ReturnType<typeof buildStoryNavigationGroups>;
  onFileSelect: (filePath: string) => void;
  onFilePreview?: (filePath: string) => void;
}) {
  if (!projectPath) {
    return (
      <div className="mt-8 mx-4 text-center" data-testid="story-index-empty">
        <p className="text-sm text-subtle">尚未打开项目</p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-subtle">加载故事索引…</div>;
  }

  if (error) {
    return <div className="mx-2 mt-2 rounded bg-error/10 p-2 text-xs text-error">{error}</div>;
  }

  if (storyGroups.length === 0) {
    return (
      <div className="mx-4 mt-8 text-center" data-testid="story-index-empty">
        <p className="text-sm text-subtle">还没有故事资料</p>
        <p className="mt-2 text-xs leading-5 text-subtle">
          初始化项目结构后，可以在大纲、人物、设定、时间线和正文里放 Markdown。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-2" data-testid="story-index">
      {storyGroups.map((group) => (
        <StoryGroup
          key={group.kind}
          kind={group.kind}
          description={group.description}
          files={group.files}
          currentFile={currentFile}
          previewFile={previewFile}
          onFileSelect={onFileSelect}
          onFilePreview={onFilePreview}
        />
      ))}
    </div>
  );
}

function StoryGroup({
  kind,
  description,
  files,
  currentFile,
  previewFile,
  onFileSelect,
  onFilePreview,
}: {
  kind: SemanticKind;
  description: string;
  files: SemanticFile[];
  currentFile: string | null;
  previewFile: string | null;
  onFileSelect: (filePath: string) => void;
  onFilePreview?: (filePath: string) => void;
}) {
  return (
    <section className="px-2 pb-3" data-testid="story-group" data-story-kind={kind}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-foreground">
            {semanticKindLabel(kind)}
          </h3>
          <p className="truncate text-[11px] text-subtle">{description}</p>
        </div>
        <span className="flex-shrink-0 text-[11px] text-subtle">{files.length}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {files.map((file) => {
          const active = file.path === currentFile;
          const preview = !active && file.path === previewFile;
          return (
            <button
              key={file.path}
              type="button"
              title={file.relativePath}
              className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition-colors ${
                active
                  ? 'bg-elevated text-foreground'
                  : preview
                    ? 'bg-elevated/60 italic text-foreground outline-dashed outline-1 -outline-offset-1 outline-border-strong'
                    : 'text-muted hover:bg-elevated hover:text-foreground'
              }`}
              data-testid="story-file"
              data-story-kind={kind}
              onClick={() => (onFilePreview ? onFilePreview(file.path) : onFileSelect(file.path))}
              onDoubleClick={() => onFileSelect(file.path)}
            >
              <span className={active ? 'text-accent-foreground' : 'text-muted'}>
                <MarkdownFileIcon />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
