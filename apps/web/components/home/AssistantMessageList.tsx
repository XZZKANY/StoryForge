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
                ? 'ml-auto border-[#514d46] bg-[#302f2b] text-[#f6ead9]'
                : 'border-[#34332f] bg-[#20201e] text-[#ded4c6]'
            }`}
          >
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[#8f877d]">
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
