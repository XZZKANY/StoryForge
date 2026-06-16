/**
 * 中间 AI 交互区
 * 围绕当前项目与右侧打开的文件展开协作：把指令转成对当前文件的真实 LLM 修订请求，
 * 由右侧 Editor 调 /api/assistant/revise 产出 diff；本组件负责发起与回显结果。
 */

import { useEffect, useRef, useState } from 'react';
import {
  emitFileSuggestionRequest,
  REVIEW_CURRENT_EVENT,
  SUGGESTION_RESULT_EVENT,
  type SuggestionResult,
} from '../lib/assistant-events';

type ComposerProps = {
  projectPath: string | null;
  currentFile: string | null;
  onToggleCollapse?: () => void;
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function relativePath(projectPath: string | null, filePath: string): string {
  if (!projectPath) return basename(filePath);
  const root = projectPath.replace(/[/\\]+$/, '');
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length).replace(/^[/\\]+/, '');
  }
  return basename(filePath);
}

export function Composer({ projectPath, currentFile, onToggleCollapse }: ComposerProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const projectName = projectPath ? basename(projectPath) : null;
  const contextRef = currentFile ? relativePath(projectPath, currentFile) : null;
  const canChat = Boolean(projectPath);

  const contextRefRef = useRef<string | null>(contextRef);
  const currentFileRef = useRef<string | null>(currentFile);
  const projectPathRef = useRef<string | null>(projectPath);
  contextRefRef.current = contextRef;
  currentFileRef.current = currentFile;
  projectPathRef.current = projectPath;

  const requestSuggestionForCurrentFile = (userIntent: string) => {
    const filePath = currentFileRef.current;
    const ref = contextRefRef.current;
    if (!filePath || !ref) {
      return false;
    }
    emitFileSuggestionRequest({ filePath, userIntent });
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `正在为 \`${ref}\` 请求 AI 修订，请稍候。完成后会在右侧文件工作区显示 diff。`,
      },
    ]);
    return true;
  };

  // 命令面板触发"审查当前文件"
  useEffect(() => {
    const onReview = () => {
      const ref = contextRefRef.current;
      if (!ref) return;
      const ask = `审查 ${ref} 的结构与节奏`;
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: ask },
        {
          role: 'assistant',
          content: `收到。我会围绕 \`${ref}\` 的结构与节奏给出问题清单，必要时引用项目内的人物与设定文件。`,
        },
      ]);
      requestSuggestionForCurrentFile(ask);
    };
    window.addEventListener(REVIEW_CURRENT_EVENT, onReview);
    return () => window.removeEventListener(REVIEW_CURRENT_EVENT, onReview);
  }, []);

  // 右侧 Editor 回传真实修订结果：成功提示查看 diff，失败原样显示错误（不静默、不伪造）。
  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      if (!result) return;
      const ref = result.filePath ? relativePath(projectPathRef.current, result.filePath) : null;
      const content =
        result.status === 'ready'
          ? `已生成对 \`${ref ?? result.filePath}\` 的 AI 修订，请在右侧查看 diff，可接受、拒绝或保存旁注。`
          : `AI 修订失败：${result.message}`;
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onResult);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !canChat) return;

    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    const instruction = input;
    setInput('');

    if (contextRef) {
      requestSuggestionForCurrentFile(instruction);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          '当前项目里还没有打开具体文件，请在右侧文件工作区选择一个文件，我就能针对它给出真实 AI 修订。',
      },
    ]);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 顶部：项目会话标题 */}
      <div className="h-10 px-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <h2 className="text-sm font-semibold text-foreground truncate">
            {projectName ? `《${projectName}》项目会话` : 'AI 交互'}
          </h2>
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            data-testid="collapse-assistant"
            className="w-7 h-7 rounded-md hover:bg-foreground/10 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            title="折叠 AI 交互区"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 上下文条 */}
      <div className="px-3 py-2 bg-panel border-b border-border flex flex-wrap items-center gap-2 text-xs flex-shrink-0">
        <span className="text-muted">上下文</span>
        {projectName && (
          <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-foreground">
            {projectName}
          </span>
        )}
        {contextRef ? (
          <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-foreground">
            {contextRef}
          </span>
        ) : (
          <span className="text-muted">未打开文件</span>
        )}
      </div>

      {/* 快捷操作 */}
      {currentFile && (
        <div className="p-3 border-b border-border flex flex-wrap gap-2 flex-shrink-0">
          <button
            onClick={() => setInput(`审查 ${contextRef} 的结构与节奏`)}
            className="text-xs px-3 py-1.5 rounded-md bg-surface border border-border hover:border-accent hover:bg-accent/10 transition-colors"
          >
            🔍 审查当前文件
          </button>
          <button
            onClick={() => setInput('分析人物一致性')}
            className="text-xs px-3 py-1.5 rounded-md bg-surface border border-border hover:border-accent hover:bg-accent/10 transition-colors"
          >
            👤 人物一致性
          </button>
          <button
            onClick={() => setInput('检查与大纲、设定的连贯性')}
            className="text-xs px-3 py-1.5 rounded-md bg-surface border border-border hover:border-accent hover:bg-accent/10 transition-colors"
          >
            📖 连贯性
          </button>
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-muted mt-8">
            {canChat ? (
              <>
                <p className="mb-4">💬 围绕当前项目，你可以问我：</p>
                <ul className="space-y-2 text-left inline-block">
                  <li>• 审查右侧打开的文件</li>
                  <li>• 分析人物一致性</li>
                  <li>• 检查与大纲、设定的连贯性</li>
                  <li>• 建议如何修改并同步正文</li>
                </ul>
              </>
            ) : (
              <p className="mt-8">先在左侧选择或打开一个项目</p>
            )}
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`
                p-3 rounded-lg text-sm animate-slide-up-fade
                ${msg.role === 'user' ? 'bg-accent text-accent-foreground ml-8' : 'bg-surface border border-border mr-8'}
              `}
            >
              <p className="text-xs font-semibold mb-1 uppercase tracking-wide opacity-70">
                {msg.role === 'user' ? '你' : 'StoryForge AI'}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      {/* 输入框 */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border flex-shrink-0">
        <div className="bg-panel rounded-lg border border-border p-2 transition-colors focus-within:border-accent/60">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              canChat
                ? '和 StoryForge 讨论当前项目或右侧文件...'
                : '打开项目后即可使用 AI 助手'
            }
            disabled={!canChat}
            rows={3}
            className="w-full bg-transparent resize-none text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-muted">
              {canChat ? 'Ctrl+Enter 发送' : '请先打开项目'}
            </span>
            <button
              type="submit"
              disabled={!input.trim() || !canChat}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              发送 ↑
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
