import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-md" data-testid="assistant-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
