import type { PatchRejection } from '../../lib/assistant-events';
import type { ChatWindowAgentResult, Message } from './types';

/**
 * 把「否掉这版 + 该怎么改」拼成一句作者会说的话。
 *
 * 刻意不把被否的 before/after 塞进来：正文动辄数千字，塞进去会把历史窗口挤爆，而模型
 * 上一轮刚生成过它。这里只给锚点（哪个文件）+ 作者的方向，剩下的靠会话历史。
 */
export function buildRejectionPrompt(rejection: PatchRejection): string {
  const name = rejection.filePath.split(/[\\/]/).filter(Boolean).pop() ?? rejection.filePath;
  const direction = rejection.direction.trim();
  const anchor = name ? `刚才那版对《${name}》的修订我没要。` : '刚才那版修订我没要。';
  return direction ? `${anchor}${direction}` : anchor;
}

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

/**
 * 把没写进消息表的失败轮按时间插回会话：作者的原话 + 当时那句「这轮没跑通」。
 * 只用于显示；同一时间的已落库消息排在前面。
 */
export function mergeFailedTurns(
  messages: Array<{ role: string; content: string; created_at: string }>,
  failedTurns: Array<{ user_message: string; failure: string; created_at: string }>,
): Message[] {
  const turns = [...failedTurns].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
  const merged: Message[] = [];
  let next = 0;
  const flushUntil = (at: string | null) => {
    while (next < turns.length && (at === null || turns[next].created_at < at)) {
      const turn = turns[next++];
      merged.push({ role: 'user', content: turn.user_message });
      merged.push({ role: 'assistant', content: `这轮没跑通：${turn.failure}` });
    }
  };
  for (const record of messages) {
    flushUntil(record.created_at);
    const message = toConversationMessage(record.role, record.content);
    if (message) merged.push(message);
  }
  flushUntil(null);
  return merged;
}

export function titleFromSystemJobs(message: ChatWindowAgentResult): string | null {
  const title = message.system_jobs?.title?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}
