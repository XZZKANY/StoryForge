/**
 * 历史面板
 * 显示最近打开的文件历史
 */

import { memo, useCallback } from 'react';

type HistoryPanelProps = {
  recentFiles: string[];
  onFileSelect: (filePath: string) => void;
  currentFile: string | null;
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

const HistoryItem = memo(function HistoryItem({
  file,
  isActive,
  onSelect,
}: {
  file: string;
  isActive: boolean;
  onSelect: (filePath: string) => void;
}) {
  const name = basename(file);
  const handleClick = useCallback(() => {
    onSelect(file);
  }, [file, onSelect]);

  return (
    <button
      onClick={handleClick}
      className={`
        w-full px-3 py-1.5 text-left text-xs transition-colors
        flex items-center gap-2
        ${isActive ? 'bg-elevated text-foreground' : 'text-muted hover:bg-elevated'}
      `}
      title={file}
    >
      <svg
        className={`w-3 h-3 flex-shrink-0 ${isActive ? 'text-accent' : 'opacity-50'}`}
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M2 2h7l2 2h3v10H2V2zm1 1v10h10V5h-3l-2-2H3z" />
      </svg>
      <span className="truncate flex-1">{name}</span>
    </button>
  );
});

export function HistoryPanel({ recentFiles, onFileSelect, currentFile }: HistoryPanelProps) {
  return (
    <div className="h-full flex flex-col bg-panel">
      {/* 标题栏 */}
      <div className="h-[36px] px-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-muted">历史</span>
      </div>

      {/* 历史列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {recentFiles.length === 0 ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-subtle">暂无历史记录</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {recentFiles.map((file, idx) => (
              <HistoryItem
                key={`${file}-${idx}`}
                file={file}
                isActive={file === currentFile}
                onSelect={onFileSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
