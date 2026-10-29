import type { Message } from './types';

type FailureOrigin = { filePath: string; text: string; repeats: number };

// 只按消息对象本身记「这条失败是哪个文件、哪句原话」：不改消息形状，也不随会话存盘。
const failureOrigins = new WeakMap<Message, FailureOrigin>();

/**
 * 追加一条「没能写进稿子」；与上一条同文件、同文案时原地改成「…（已重试 N 次，结果相同）」，
 * 作者连点接受不再刷出一串一模一样的失败。tail 是跟在失败原话后面的附注。
 */
export function appendWritebackFailure(
  prev: Message[],
  filePath: string,
  text: string,
  tail = '',
): Message[] {
  const last = prev[prev.length - 1];
  const origin = last ? failureOrigins.get(last) : undefined;
  const same = origin?.filePath === filePath && origin.text === text + tail;
  const repeats = same ? origin.repeats + 1 : 0;
  const message: Message = {
    ...(same ? last : {}),
    role: 'assistant',
    content: same ? `${text}（已重试 ${repeats} 次，结果相同）${tail}` : text + tail,
  };
  failureOrigins.set(message, { filePath, text: text + tail, repeats });
  return same ? [...prev.slice(0, -1), message] : [...prev, message];
}
