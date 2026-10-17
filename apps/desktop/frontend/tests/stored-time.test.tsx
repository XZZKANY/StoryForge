/**
 * 会话时间慢 8 小时（作者 10-17 巡检）：引擎按 UTC 存不带时区的时间，界面用 new Date() 当本地时间解析。
 * 期望值都用同一个 UTC 时刻按本地时区算出来，测试在哪个时区跑都成立。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { ConversationHeader } from '../src/components/chat-window/panels';
import { formatStoredTimeShort, parseStoredTime } from '../src/lib/stored-time';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UTC = Date.UTC(2026, 9, 17, 5, 16, 21);
const pad = (value: number) => String(value).padStart(2, '0');
const local = new Date(UTC);
const expectedShort = `${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`;

test('不带时区的库内时间按 UTC 解析；带了时区的照原样', () => {
  assert.equal(parseStoredTime('2026-10-17 05:16:21')?.getTime(), UTC);
  assert.equal(parseStoredTime('2026-10-17T05:16:21')?.getTime(), UTC);
  assert.equal(parseStoredTime('2026-10-17T05:16:21Z')?.getTime(), UTC);
  assert.equal(parseStoredTime('2026-10-17T13:16:21+08:00')?.getTime(), UTC);
  assert.equal(parseStoredTime('不是时间'), null);
  assert.equal(formatStoredTimeShort('不是时间'), '不是时间');
});

test('会话列表显示的是本地时间', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ConversationHeader
          title="看看第5章"
          sessions={[
            {
              id: 1,
              title: '看看第5章',
              task_type: 'chat',
              created_at: '2026-10-17 05:16:21',
              updated_at: '2026-10-17 05:16:21',
            } as never,
          ]}
          onSelectSession={() => undefined}
          onNewSession={() => undefined}
        />,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="conversation-session-switch"]')!
        .click(),
    );
    const item = document.querySelector('[data-testid="session-item"]')!;
    assert.match(item.textContent ?? '', new RegExp(expectedShort));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
