// 独立可视回归入口，不打包进产品；测试控件不是业务数据或真实 Agent 会话。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import '../../src/index.css';
import { ensureMonacoThemes } from '../../src/lib/theme';
import { ACTIVITY_BAR_WIDTH, WORKSPACE_PRIMARY_MIN_WIDTH } from '../../src/lib/workspace-layout';
import { useWorkspaceSidePanelLimit } from '../../src/components/shell/useWorkspaceSidePanelLimit';
import { SidePanel } from '../../src/components/shell/SidePanel';
import { AssistantPanelFrame } from '../../src/components/shell/AssistantPanelFrame';
import { PatchReviewPanel } from '../../src/components/PatchReviewPanel';
import type { LayoutMode } from '../../src/components/shell/useShellState';

ensureMonacoThemes(monaco);

function Fixture() {
  const [mode, setMode] = useState<LayoutMode>('balanced');
  const [widths, setWidths] = useState<Record<string, number>>({ book: 420 });
  const [sidebar, setSidebar] = useState(true);
  const [action, setAction] = useState('未操作');
  const maxWidth = useWorkspaceSidePanelLimit(true, mode);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-2 text-xs">
        <strong>布局回归夹具：无后端、无文件读写、无真实 Agent</strong>
        {(['editor', 'balanced', 'chat'] as const).map((value) => (
          <button key={value} onClick={() => setMode(value)}>
            {value}
          </button>
        ))}
        <button onClick={() => setSidebar((value) => !value)}>切换侧栏</button>
        <output aria-label="保存的作品栏宽度">{widths.book}</output>
        <output aria-label="测试回调">{action}</output>
      </header>
      <div className="relative flex min-h-0 flex-1" data-testid="fixture-workspace">
        <div className="flex flex-shrink-0">
          <nav style={{ width: ACTIVITY_BAR_WIDTH }} aria-label="活动栏占位" />
          {sidebar && (
            <SidePanel
              view="book"
              widths={widths}
              maxWidth={maxWidth}
              onWidthChange={(view, width) => setWidths((prev) => ({ ...prev, [view]: width }))}
              projects={[]}
              activeProject={null}
              currentFile={null}
              previewFile={null}
              projectRefreshVersion={0}
              onSelectProject={() => {}}
              onRemoveProject={() => {}}
              onOpenProject={() => {}}
              onNewFile={() => {}}
              onFileSelect={() => {}}
              onFilePreview={() => {}}
              book={
                <textarea
                  className="w-full bg-panel p-3"
                  aria-label="侧栏挂载状态控件"
                  placeholder="侧栏测试输入，不会写入项目"
                />
              }
            />
          )}
        </div>
        <main
          className={`${mode === 'chat' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col bg-background`}
          style={{ minWidth: WORKSPACE_PRIMARY_MIN_WIDTH }}
          data-testid="fixture-center"
        >
          <textarea
            className="min-h-0 w-full flex-1 bg-background p-3"
            aria-label="编辑区挂载状态控件"
            placeholder="编辑区测试输入，不是 Monaco/真实手稿验收"
          />
          <PatchReviewPanel
            suggestion={{
              id: 'layout-test',
              filePath: '布局回归夹具/包含较长文件名的第一章.md',
              title: '布局回归补丁（仅测试）',
              summary: '检查窄栏下操作按钮、文件路径和说明是否完整可达。',
              before: '回归夹具原文。',
              after: '回归夹具修订文本。',
              note: '',
              createdAt: 1,
            }}
            editorFontSize={14}
            editorFontFamily="sans-serif"
            onAccept={() => setAction('接受回调；没有写回')}
            onAcceptHunk={() => setAction('局部接受回调；没有写回')}
            onReject={(direction) => setAction(`拒绝回调：${direction}`)}
            onSaveNote={() => setAction('旁注回调；没有写回')}
            onRetryWithoutKnowledge={() => {}}
          />
        </main>
        <AssistantPanelFrame visible={mode !== 'editor'} wide={mode === 'chat'}>
          <p className="p-3 text-xs">Agent 栏挂载状态控件；不会发送消息。</p>
          <textarea
            className="min-h-0 w-full flex-1 bg-panel p-3"
            aria-label="Agent 挂载状态控件"
            placeholder="切换布局后检查草稿保留"
          />
        </AssistantPanelFrame>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(<Fixture />);
