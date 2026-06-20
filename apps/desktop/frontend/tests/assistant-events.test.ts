import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  emitAcceptCurrentFileSuggestion,
} from '../src/lib/assistant-events';

test('accept current file suggestion event is emitted for chat writeback confirmation', () => {
  const events: string[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
    dispatchEvent(event: Event) {
      events.push(event.type);
      return true;
    },
    },
  });

  try {
    emitAcceptCurrentFileSuggestion();
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }

  assert.deepEqual(events, [ACCEPT_CURRENT_FILE_SUGGESTION_EVENT]);
});
