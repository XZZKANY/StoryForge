import { describe, expect, it } from 'vitest';

import { shouldResetRunPanels } from '../../src/components/chat-window/session-switch';

describe('切换会话时清理旧 run 面板', () => {
  it.each([
    ['切到已有会话', 7, null, true],
    ['自我持久化转移', 7, 7, false],
    ['待持久化 id 与下一会话不同', 8, 7, true],
  ])('%s', (_label, nextSessionId, selfPersistedSessionId, expected) => {
    expect(shouldResetRunPanels(nextSessionId, selfPersistedSessionId)).toBe(expected);
  });
});
