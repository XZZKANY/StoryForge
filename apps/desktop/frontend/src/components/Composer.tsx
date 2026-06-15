/**
 * AI Composer 面板
 * 后续会替换为从 Web 复用的完整组件
 */

import { useState } from 'react';

type ComposerProps = {
  currentFile: string | null;
  onToggleCollapse?: () => void;
};

export function Composer({ currentFile, onToggleCollapse }: ComposerProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // 添加用户消息
    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // TODO: 调用后端 API
    // 临时模拟响应
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '这是 AI 助手的回复。后续会接入真实的 Assistant API。'
      }]);
    }, 500);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 顶部工具栏 */}
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
        {/* 标题 */}
        <div className="flex items-center gap-2 flex-1">
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <h2 className="text-sm font-semibold text-foreground">AI 助手</h2>
        </div>

        {/* 折叠按钮 */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-7 h-7 rounded-md hover:bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors group"
            title="折叠助手面板"
          >
            <svg className="w-4 h-4 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 当前文件提示 */}
      {currentFile && (
        <div className="px-3 py-2 bg-muted/20 border-b border-border/50">
          <p className="text-xs text-muted-foreground truncate flex items-center gap-2" title={currentFile}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {currentFile.split(/[/\\]/).pop()}
          </p>
        </div>
      )}

      {/* 快捷操作 */}
      {currentFile && (
        <div className="p-3 border-b border-border flex flex-wrap gap-2">
          <button
            onClick={() => setInput('请审阅这章，指出所有问题')}
            className="text-xs px-3 py-1.5 rounded bg-panel border border-border hover:bg-accent hover:border-accent"
          >
            🔍 审阅这章
          </button>
          <button
            onClick={() => setInput('分析人物一致性')}
            className="text-xs px-3 py-1.5 rounded bg-panel border border-border hover:bg-accent hover:border-accent"
          >
            👤 人物一致性
          </button>
          <button
            onClick={() => setInput('检查剧情连贯性')}
            className="text-xs px-3 py-1.5 rounded bg-panel border border-border hover:bg-accent hover:border-accent"
          >
            📖 剧情连贯
          </button>
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-muted mt-8">
            <p className="mb-4">💬 你可以问我：</p>
            <ul className="space-y-2 text-left inline-block">
              <li>• 帮我审阅这章</li>
              <li>• 分析人物一致性</li>
              <li>• 检查剧情连贯性</li>
              <li>• 给这章打分</li>
              <li>• 润色选中的文本</li>
            </ul>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`
                p-3 rounded-lg text-sm
                ${msg.role === 'user'
                  ? 'bg-accent text-accent-foreground ml-8'
                  : 'bg-panel border border-border mr-8'
                }
              `}
            >
              <p className="text-xs font-semibold mb-1 uppercase tracking-wide opacity-70">
                {msg.role === 'user' ? '你' : 'StoryForge AI'}
              </p>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      {/* 输入框 */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border">
        <div className="bg-panel rounded-lg border border-border p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={currentFile ? "问我任何关于这章的问题..." : "打开文件后即可使用 AI 助手"}
            disabled={!currentFile}
            rows={3}
            className="w-full bg-transparent resize-none text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-muted">
              {currentFile ? 'Ctrl+Enter 发送' : '请先打开文件'}
            </span>
            <button
              type="submit"
              disabled={!input.trim() || !currentFile}
              className="
                px-3 py-1.5 rounded-full text-xs font-medium
                bg-foreground text-background
                hover:opacity-90
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              发送 ↑
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
