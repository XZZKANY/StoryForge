/**
 * 桌面 IDE 主应用
 * 默认显示：文件树 + Assistant
 * 点击文件时自动展开编辑器
 */

import { useState, useEffect } from 'react';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { Composer } from './components/Composer';
import { ResizablePanel } from './components/ResizablePanel';
import { isTauriRuntime } from './lib/tauri-env';

type PanelState = {
  fileTree: boolean;
  editor: boolean;
  assistant: boolean;
};

const DEFAULT_WIDTHS = {
  fileTree: 250,
  assistant: 400,
};

export function App() {
  // 面板显示状态
  const [panels, setPanels] = useState<PanelState>({
    fileTree: true,
    editor: false, // 默认不显示编辑器
    assistant: true,
  });

  // 面板宽度
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);

  // 当前打开的文件
  const [currentFile, setCurrentFile] = useState<string | null>(null);

  // 从 localStorage 恢复状态
  useEffect(() => {
    const savedPanels = localStorage.getItem('panel-state');
    const savedWidths = localStorage.getItem('panel-widths');

    if (savedPanels) {
      setPanels(JSON.parse(savedPanels));
    }
    if (savedWidths) {
      setWidths(JSON.parse(savedWidths));
    }
  }, []);

  // 保存状态到 localStorage
  useEffect(() => {
    localStorage.setItem('panel-state', JSON.stringify(panels));
    localStorage.setItem('panel-widths', JSON.stringify(widths));
  }, [panels, widths]);

  // 监听菜单事件
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isCancelled = false;
    const unlistenFns: Array<() => void> = [];

    const registerMenuListeners = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (isCancelled) {
        return;
      }

      unlistenFns.push(await listen('menu:open-project', () => {
        console.log('App: 收到菜单事件 menu:open-project');
        const btn = document.getElementById('open-project-btn');
        console.log('App: 找到按钮', btn);
        if (btn) {
          btn.click();
          console.log('App: 已触发按钮点击');
        } else {
          console.error('App: 未找到 open-project-btn 按钮');
        }
      }));

      unlistenFns.push(await listen('menu:new-file', () => {
        console.log('菜单：新建文件');
        alert('新建文件功能待实现');
      }));

      unlistenFns.push(await listen('menu:save', () => {
        console.log('菜单：保存');
        // 触发编辑器的保存
        document.getElementById('editor-save-btn')?.click();
      }));

      unlistenFns.push(await listen('menu:toggle-sidebar', () => {
        console.log('菜单：切换侧边栏');
        toggleFileTree();
      }));
    };

    void registerMenuListeners();

    // 清理
    return () => {
      isCancelled = true;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  // 切换面板显示
  const toggleFileTree = () => {
    setPanels(p => ({ ...p, fileTree: !p.fileTree }));
  };

  const toggleAssistant = () => {
    setPanels(p => ({ ...p, assistant: !p.assistant }));
  };

  // 打开文件时自动展开编辑器
  const handleFileSelect = (filePath: string) => {
    setCurrentFile(filePath);
    setPanels(p => ({ ...p, editor: true }));
  };

  // 关闭文件时可以选择隐藏编辑器
  const handleFileClose = () => {
    setCurrentFile(null);
    // 可选：自动隐藏编辑器
    // setPanels(p => ({ ...p, editor: false }));
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* 文件树面板 */}
      {panels.fileTree ? (
        <ResizablePanel
          defaultWidth={widths.fileTree}
          minWidth={200}
          maxWidth={400}
          onWidthChange={(w) => setWidths(prev => ({ ...prev, fileTree: w }))}
          position="left"
        >
          <div className="h-full flex flex-col border-r border-border">
            <FileTree
              currentFile={currentFile}
              onFileSelect={handleFileSelect}
              onToggleCollapse={toggleFileTree}
            />
          </div>
        </ResizablePanel>
      ) : (
        <ExpandButton direction="left" onClick={toggleFileTree} />
      )}

      {/* 编辑器面板 */}
      {panels.editor ? (
        <div className="flex-1 flex flex-col border-r border-border">
          <Editor
            filePath={currentFile}
            onClose={handleFileClose}
          />
        </div>
      ) : null}

      {/* Assistant 面板 */}
      {panels.assistant ? (
        <ResizablePanel
          defaultWidth={widths.assistant}
          minWidth={300}
          maxWidth={600}
          onWidthChange={(w) => setWidths(prev => ({ ...prev, assistant: w }))}
          position="right"
        >
          <div className="h-full flex flex-col border-l border-border">
            <Composer
              currentFile={currentFile}
              onToggleCollapse={toggleAssistant}
            />
          </div>
        </ResizablePanel>
      ) : (
        <ExpandButton direction="right" onClick={toggleAssistant} />
      )}
    </div>
  );
}

// 展开按钮（面板折叠时显示）
function ExpandButton({
  direction,
  onClick,
}: {
  direction: 'left' | 'right';
  onClick: () => void;
}) {
  return (
    <div className="w-8 border-r border-border bg-background flex items-center justify-center">
      <button
        onClick={onClick}
        className="
          w-6 h-12 rounded-md
          bg-muted/10 hover:bg-accent
          border border-transparent hover:border-accent-foreground/20
          flex items-center justify-center
          text-muted-foreground hover:text-accent-foreground
          transition-all duration-200
          shadow-sm hover:shadow-md
          group
        "
        aria-label={direction === 'left' ? '展开文件树' : '展开助手面板'}
      >
        <svg
          className="w-3 h-3 transition-transform duration-200 group-hover:scale-110"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d={direction === 'left' ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'}
          />
        </svg>
      </button>
    </div>
  );
}
