/**
 * 对话窗口（带标签导航）
 * 显示完整的消息历史流，支持多个上下文标签
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  emitFileSuggestionRequest,
  REVIEW_CURRENT_EVENT,
  SUGGESTION_RESULT_EVENT,
  type SuggestionResult,
} from '../lib/assistant-events';

type ChatWindowProps = {
  projectPath: string | null;
  currentFile: string | null;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
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

export function ChatWindow({ projectPath, currentFile }: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'context' | 'project' | 'unopened'>('context');

  const projectName = projectPath ? basename(projectPath) : null;
  const contextRef = currentFile ? relativePath(projectPath, currentFile) : null;

  const contextRefRef = useRef<string | null>(contextRef);
  const currentFileRef = useRef<string | null>(currentFile);
  const projectPathRef = useRef<string | null>(projectPath);
  contextRefRef.current = contextRef;
  currentFileRef.current = currentFile;
  projectPathRef.current = projectPath;

  const requestSuggestionForCurrentFile = useCallback((userIntent: string) => {
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
  }, []);

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

  // 右侧 Editor 回传真实修订结果
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

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !projectPath) return;

    const userMessage: Message = { role: 'user', content: input };
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
        content: '当前项目里还没有打开具体文件，请在资源管理器选择一个文件，我就能针对它给出真实 AI 修订。',
      },
    ]);
  }, [input, projectPath, contextRef, requestSuggestionForCurrentFile]);

  return (
    <div className="h-full flex flex-col bg-[#1E1E1E]">
      {/* 标签导航栏 */}
      <div className="h-[36px] border-b border-[#2D2D30] flex items-center px-2 gap-1 flex-shrink-0">
        <button
          onClick={() => setActiveTab('context')}
          className={`
            px-3 h-[28px] rounded text-xs font-medium transition-colors
            ${activeTab === 'context' ? 'bg-[#37373D] text-white' : 'text-[#CCCCCC] hover:bg-[#2D2D30]'}
          `}
        >
          上下文
        </button>
        {projectName && (
          <button
            onClick={() => setActiveTab('project')}
            className={`
              px-3 h-[28px] rounded text-xs font-medium transition-colors
              ${activeTab === 'project' ? 'bg-[#37373D] text-white' : 'text-[#CCCCCC] hover:bg-[#2D2D30]'}
            `}
          >
            {projectName}
          </button>
        )}
        <button
          onClick={() => setActiveTab('unopened')}
          className={`
            px-3 h-[28px] rounded text-xs font-medium transition-colors
            ${activeTab === 'unopened' ? 'bg-[#37373D] text-white' : 'text-[#CCCCCC] hover:bg-[#2D2D30]'}
          `}
        >
          未打开文件
        </button>
        <button
          className="ml-auto w-6 h-6 rounded hover:bg-[#2D2D30] flex items-center justify-center text-[#CCCCCC]"
          title="关闭"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-[#858585] mt-12">
            {projectPath ? (
              <>
                <p className="mb-4">💬 围绕当前项目，你可以问我：</p>
                <ul className="space-y-2 text-left inline-block text-[#CCCCCC]">
                  <li>• 审查右侧打开的文件</li>
                  <li>• 分析人物一致性</li>
                  <li>• 检查与大纲、设定的连贯性</li>
                  <li>• 建议如何修改并同步正文</li>
                </ul>
              </>
            ) : (
              <p>先在左侧选择一个项目</p>
            )}
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`
                flex gap-3 animate-slide-up-fade
                ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}
              `}
            >
              {/* 头像 */}
              <div
                className={`
                  w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-xs font-medium
                  ${msg.role === 'user' ? 'bg-[#0E639C] text-white' : 'bg-[#37373D] text-[#CCCCCC]'}
                `}
              >
                {msg.role === 'user' ? '你' : 'AI'}
              </div>
              {/* 消息内容 */}
              <div className="flex-1 min-w-0">
                <div
                  className={`
                    p-3 rounded-lg text-sm leading-relaxed
                    ${msg.role === 'user' ? 'bg-[#0E639C] text-white' : 'bg-[#2D2D30] text-[#CCCCCC]'}
                  `}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 输入框 */}
      <div className="p-3 border-t border-[#2D2D30] flex-shrink-0">
        <form onSubmit={handleSubmit} className="bg-[#2D2D30] rounded-lg">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              projectPath
                ? `和 StoryForge 讨论当前项目或右侧文件...`
                : '打开项目后即可使用 AI 助手'
            }
            disabled={!projectPath}
            rows={3}
            className="w-full bg-transparent resize-none text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-[#858585] text-[#CCCCCC] p-3"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <div className="flex justify-between items-center px-3 pb-2">
            <span className="text-xs text-[#858585]">
              {projectPath ? 'Ctrl+Enter 发送' : '请先打开项目'}
            </span>
            <button
              type="submit"
              disabled={!input.trim() || !projectPath}
              className="px-4 py-1.5 rounded text-xs font-medium bg-[#0E639C] text-white hover:bg-[#1177BB] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
