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
        ${isActive ? 'bg-[#37373D] text-white' : 'text-[#CCCCCC] hover:bg-[#2A2D2E]'}
      `}
      title={file}
    >
      <svg className={`w-3 h-3 flex-shrink-0 ${isActive ? 'text-[#4A9EFF]' : 'opacity-50'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate flex-1">{name}</span>
    </button>
  );
});

export function HistoryPanel({ recentFiles, onFileSelect, currentFile }: HistoryPanelProps) {
  return (
    <div className="h-full flex flex-col bg-[#252526]">
      {/* 标题栏 */}
      <div className="h-[36px] px-3 border-b border-[#2D2D30] flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-[#CCCCCC]">历史</span>
      </div>

      {/* 历史列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {recentFiles.length === 0 ? (
          <div className="mt-8 mx-4 text-center">
            <p className="text-sm text-[#858585]">暂无历史记录</p>
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
