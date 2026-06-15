/**
 * Monaco Editor 编辑器组件
 */

import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { TauriFileSystem } from '../lib/tauri-fs';

type EditorProps = {
  filePath: string | null;
  onClose: () => void;
};

export function Editor({ filePath, onClose }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [originalContent, setOriginalContent] = useState('');

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'markdown',
      theme: 'vs-dark',
      fontSize: 14,
      lineNumbers: 'on',
      minimap: { enabled: true },
      wordWrap: 'on',
      automaticLayout: true,
      scrollBeyondLastLine: false,
    });

    editorRef.current = editor;

    // 监听内容变化
    editor.onDidChangeModelContent(() => {
      if (filePath) {
        const current = editor.getValue();
        setIsDirty(current !== originalContent);
      }
    });

    // 注册保存快捷键
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        if (filePath && isDirty) {
          handleSave();
        }
      }
    );

    return () => {
      editor.dispose();
    };
  }, []);

  // 加载文件内容
  useEffect(() => {
    if (!filePath || !editorRef.current) return;

    const loadFile = async () => {
      try {
        const content = await TauriFileSystem.readFile(filePath);
        setOriginalContent(content);
        editorRef.current?.setValue(content);
        setIsDirty(false);
      } catch (err) {
        console.error('读取文件失败:', err);
        alert(`读取文件失败: ${err}`);
      }
    };

    loadFile();
  }, [filePath]);

  // 保存文件
  const handleSave = async () => {
    if (!filePath || !editorRef.current) return;

    try {
      const content = editorRef.current.getValue();
      await TauriFileSystem.writeFile(filePath, content);
      setOriginalContent(content);
      setIsDirty(false);
      console.log('文件已保存:', filePath);
    } catch (err) {
      console.error('保存文件失败:', err);
      alert(`保存文件失败: ${err}`);
    }
  };

  // 关闭文件
  const handleClose = () => {
    if (isDirty) {
      const confirmed = confirm('文件有未保存的修改，确定关闭吗？');
      if (!confirmed) return;
    }
    onClose();
  };

  if (!filePath) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted">
        <div className="text-center">
          <p className="text-lg mb-2">未打开文件</p>
          <p className="text-sm">从左侧文件树选择一个文件</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 顶部工具栏 */}
      <div className="h-10 px-3 border-b border-border flex items-center justify-between bg-panel">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate max-w-md" title={filePath}>
            {filePath.split(/[/\\]/).pop()}
          </span>
          {isDirty && (
            <span className="text-xs text-warning">●</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            id="editor-save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            className="text-xs px-2 py-1 rounded bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存 (Ctrl+S)
          </button>
          <button
            onClick={handleClose}
            className="text-xs px-2 py-1 rounded hover:bg-muted/20"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
