/**
 * 文件树组件
 * 显示项目中的所有 Markdown 文件
 */

import { useState } from 'react';
import { TauriFileSystem, FileEntry } from '../lib/tauri-fs';

type FileTreeProps = {
  currentFile: string | null;
  onFileSelect: (filePath: string) => void;
  onToggleCollapse?: () => void;
};

export function FileTree({ currentFile, onFileSelect, onToggleCollapse }: FileTreeProps) {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开项目
  const handleOpenProject = async () => {
    console.log('FileTree: 开始打开项目对话框');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      console.log('FileTree: dialog 插件已加载');

      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择项目目录',
      });

      console.log('FileTree: 用户选择:', selected);

      if (!selected || typeof selected !== 'string') {
        console.log('FileTree: 用户取消或选择无效');
        return;
      }

      setProjectPath(selected);
      await loadFiles(selected);
    } catch (err) {
      console.error('FileTree: 打开项目失败', err);
      setError(err instanceof Error ? err.message : '打开项目失败');
    }
  };

  // 加载文件列表
  const loadFiles = async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const entries = await TauriFileSystem.listDir(path, true);

      // 只显示 Markdown 文件
      const markdownFiles = entries
        .filter(e => !e.isDir && (e.extension === 'md' || e.extension === 'markdown'))
        .sort((a, b) => a.path.localeCompare(b.path));

      setFiles(markdownFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 顶部工具栏 */}
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
        {/* 折叠按钮 */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-7 h-7 rounded-md hover:bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors group"
            title="折叠侧边栏"
          >
            <svg className="w-4 h-4 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {/* 标题 */}
        <div className="flex items-center gap-2 flex-1">
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <h2 className="text-sm font-semibold text-foreground">文件</h2>
        </div>

        {/* 打开项目按钮 */}
        <button
          id="open-project-btn"
          onClick={handleOpenProject}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/90 text-accent-foreground hover:bg-accent transition-colors font-medium shadow-sm"
        >
          打开
        </button>
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!projectPath ? (
          <div className="p-8 text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-sm text-muted-foreground">
              点击"打开项目"开始
            </p>
          </div>
        ) : loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-4"></div>
            <p className="text-sm text-muted-foreground">
              加载中...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 mx-2 mt-4 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="p-8 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-muted-foreground">
              此目录下没有 Markdown 文件
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {files.map((file) => (
              <FileItem
                key={file.path}
                file={file}
                isActive={file.path === currentFile}
                onClick={() => onFileSelect(file.path)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      {projectPath && (
        <div className="px-4 py-2 border-t border-border/50 bg-background/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>{files.length} 个文件</span>
          </div>
        </div>
      )}
    </div>
  );
}

// 文件项组件
function FileItem({
  file,
  isActive,
  onClick,
}: {
  file: FileEntry;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-3 py-2 rounded-md text-sm
        flex items-center gap-2.5
        transition-all duration-150
        group relative
        ${
          isActive
            ? 'bg-accent text-accent-foreground shadow-sm'
            : 'hover:bg-muted/40 text-foreground hover:text-foreground'
        }
      `}
      title={file.path}
    >
      {/* 文件图标 */}
      <svg
        className={`w-4 h-4 flex-shrink-0 transition-colors ${
          isActive ? 'text-accent-foreground' : 'text-muted-foreground group-hover:text-foreground'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>

      {/* 文件名 */}
      <span className="flex-1 truncate font-medium">
        {file.name}
      </span>

      {/* 激活指示器 */}
      {isActive && (
        <div className="w-1.5 h-1.5 rounded-full bg-accent-foreground/60 flex-shrink-0" />
      )}
    </button>
  );
}
