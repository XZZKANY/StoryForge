import type { Element, Root, Text } from 'hast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const CARET_STOP = new Set(['br', 'hr', 'img', 'input']);

function lastMeaningfulChild(node: Root | Element): Element | Text | undefined {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child.type === 'element') return child;
    if (child.type === 'text' && child.value.trim()) return child;
  }
  return undefined;
}

/**
 * 输出中的回答在最后一个字后面挂一个小圆点：沿着最后一个块一路走到最深处
 * （列表最后一项、引用最后一段、表格最后一格），挂在那里，而不是另起一行写「正在输出…」。
 */
function rehypeStreamCaret() {
  return (tree: Root) => {
    let parent: Root | Element = tree;
    for (;;) {
      const last = lastMeaningfulChild(parent);
      if (!last || last.type !== 'element' || CARET_STOP.has(last.tagName)) break;
      parent = last;
    }
    parent.children.push({
      type: 'element',
      tagName: 'span',
      properties: {
        className: ['sf-stream-caret', 'motion-safe:animate-pulse'],
        dataTestid: 'stream-indicator',
        dataPhase: 'streaming',
        ariaHidden: 'true',
      },
      children: [],
    });
  };
}

const STREAMING_REHYPE = [rehypeStreamCaret];

export function AssistantMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="assistant-md" data-testid="assistant-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? STREAMING_REHYPE : undefined}
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
