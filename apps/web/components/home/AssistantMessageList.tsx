import { AssistantToolTree } from './AssistantToolTree';
import type { AssistantMessage } from './assistant-types';

export function AssistantMessageList({
  messages,
}: {
  readonly messages: readonly AssistantMessage[];
}) {
  return (
    <div className="grid gap-3" aria-label="Assistant 消息流">
      {messages.map((message) => {
        const toolNodes = message.toolNodes ?? [];
        return (
          <article
            key={message.id}
            className={`max-w-[min(100%,780px)] rounded-xl border p-3 ${
              message.role === 'user'
                ? 'ml-auto border-border bg-panel text-foreground'
                : 'border-border bg-panel text-foreground'
            }`}
          >
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">
              {message.role === 'user' ? '你' : 'StoryForge Assistant'}
            </p>
            <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
            {toolNodes.length > 0 ? (
              <div className="mt-3">
                <AssistantToolTree toolNodes={toolNodes} />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
