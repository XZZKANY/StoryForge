import type { AgentSocketMessage } from './types';

// 解码 SSE 的 data JSON；帧的领域字段由消费者继续校验。
export function parseAgentSseFrame(frame: string): AgentSocketMessage | null {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  try {
    const value: unknown = JSON.parse(dataLines.join('\n'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as AgentSocketMessage)
      : null;
  } catch {
    return null;
  }
}
