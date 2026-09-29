import { expect, it, vi } from 'vitest';

vi.mock('../src/lib/api-client', () => ({
  getApiConfig: vi.fn(async () => ({ baseUrl: 'http://fixture.invalid', apiKey: 'synthetic' })),
}));

import { takePendingFileSuggestion } from '../src/lib/assistant-events';
import '../src/lib/smoke';

it('keeps failed-attempt and successful smoke proposals distinguishable in version evidence', () => {
  const filePath = 'C:/smoke/正文/chapter-001.md';
  const params = { filePath, before: 'original', after: 'revised' };
  const controller = window.__STORYFORGE_SMOKE__!;
  controller.proposeRevision({ ...params, id: 'smoke-disk-drift' });
  expect(takePendingFileSuggestion(filePath)?.id).toBe('smoke-disk-drift');
  controller.proposeRevision({ ...params, id: 'smoke-file-revision' });
  expect(takePendingFileSuggestion(filePath)?.id).toBe('smoke-file-revision');
  controller.proposeRevision(params);
  expect(takePendingFileSuggestion(filePath)?.id).toBe('smoke-file-revision');
});
