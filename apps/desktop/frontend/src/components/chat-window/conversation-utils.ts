import type { ChatWindowAgentResult, Message } from './types';

export function deriveConversationTitle(text: string): string {
  const compact = text
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;：:,.、]/g, '')
    .trim();
  if (!compact) return '新的创作会话';

  const title = compact
    .replace(/^请?帮我?/, '')
    .replace(/^我想/, '')
    .slice(0, 12);
  return title || '新的创作会话';
}

function toConversationMessage(role: string, content: string): Message | null {
  if (role !== 'user' && role !== 'assistant') return null;
  return { role, content };
}

export function compactConversationMessages(
  messages: Array<{ role: string; content: string }>,
): Message[] {
  return messages
    .map((message) => toConversationMessage(message.role, message.content))
    .filter((message): message is Message => message !== null);
}

export function titleFromSystemJobs(message: ChatWindowAgentResult): string | null {
  const title = message.system_jobs?.title?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}
