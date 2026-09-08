import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { EditorTabs } from '../../src/components/shell/EditorTabs';
import { useEditorWorkspaceTabs } from '../../src/components/app/useEditorWorkspaceTabs';
import { AppDialogHost, useAppDialog } from '../../src/components/app/AppDialog';
import { ConversationHeader } from '../../src/components/chat-window/panels';

function Fixture() {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [action, setAction] = useState('未执行');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dialogs = useAppDialog();
  const tabs = useEditorWorkspaceTabs({
    activeProject: 'fixture',
    currentFile,
    selectFile: setCurrentFile,
    closeFile: () => setCurrentFile(null),
    selectProject: () => {},
    removeProject: () => {},
    dialogs,
    onShowEditor: () => {},
  });
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3 text-xs">
        <strong>交互回归夹具：仅内存状态，无文件写入或模型请求</strong>
        {['第一章', '第二章', '第三章'].map((name) => (
          <button key={name} onClick={() => void tabs.openFile(`fixture/${name}.md`)}>
            打开{name}
          </button>
        ))}
        <button onClick={() => void tabs.previewFileOpen('fixture/预览.md')}>预览文件</button>
        <label>
          主题{' '}
          <select
            aria-label="夹具主题"
            className="bg-panel text-foreground"
            onChange={(event) =>
              document.documentElement.setAttribute('data-theme', event.target.value)
            }
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </header>
      <main className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <EditorTabs
            openFiles={tabs.openFiles}
            activeFile={currentFile}
            previewFile={tabs.previewFile}
            dirtyFiles={tabs.dirtyFiles}
            activeTab={
              tabs.displayedFile
                ? tabs.displayedFile === tabs.previewFile
                  ? 'preview'
                  : 'file'
                : null
            }
            onFocusFile={tabs.focusFile}
            onFocusPreview={tabs.focusPreview}
            onPinPreview={tabs.pinPreview}
            onCloseFile={tabs.handleFileClose}
            onClosePreview={tabs.closePreview}
            onCloseOthers={tabs.handleCloseOthers}
            onCloseAll={tabs.handleCloseAll}
            onSaveActive={() => setAction('保存菜单回调；未写入文件')}
            onToggleHistory={() => setAction('历史菜单回调')}
            onExportActive={() => {
              setAction('导出菜单回调');
              editorRef.current?.focus();
            }}
            onPolishActive={(main) =>
              setAction(main ? '主模型回调；未发送' : '润色模型回调；未发送')
            }
          />
          {tabs.displayedFile ? (
            <textarea
              ref={editorRef}
              aria-label="内存稿件"
              className="min-h-0 flex-1 resize-none bg-background p-4 text-sm outline-none"
              value={drafts[tabs.displayedFile] ?? ''}
              placeholder={tabs.displayedFile}
              onChange={(event) => {
                setDrafts((current) => ({ ...current, [tabs.displayedFile!]: event.target.value }));
                tabs.handleEditorDirtyChange(tabs.displayedFile, true);
              }}
            />
          ) : (
            <p className="p-5 text-sm">未打开文件</p>
          )}
        </section>
        <aside className="flex w-80 shrink-0 flex-col border-l border-border">
          <ConversationHeader
            title="夹具会话"
            sessions={[]}
            onNewSession={() => setAction('新建会话回调；未调用服务')}
          />
          <textarea
            aria-label="内存对话草稿"
            className="min-h-0 flex-1 resize-none bg-panel p-4 text-sm"
          />
        </aside>
      </main>
      <output className="border-t border-border p-2 text-xs" aria-label="最近动作">
        {action}
      </output>
      <AppDialogHost
        dialog={dialogs.dialog}
        onClose={dialogs.closeDialog}
        onPromptValueChange={dialogs.updatePromptValue}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
