import { describe, expect, it } from 'vitest';
import { collectProjectKnowledgeContext } from './knowledgeContext';
import {
  knowledgeClaimFingerprint,
  renderKnowledgeEntry,
  type KnowledgeEntry,
} from './knowledgeEntries';
import { knowledgeEntryEvidenceState } from './knowledgeRetrieval';
import { buildLlmContextSnapshot } from './llmContext';
import { memoryProject } from './memoryProject.test-support';
import { sha256Hex } from './sha256';

const ROOT = 'D:/book';
const SOURCE = '正文/第001章.md';
const KNOWLEDGE = '设定/规则.md';
const CLAIM = '钟楼不能移动。';
const encoded = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const entry: KnowledgeEntry = {
  id: 'pk_11111111-1111-4111-8111-111111111111',
  status: 'active',
  kind: 'world_rule',
  evidence_state: 'current',
  title: '钟楼规则',
  claim: CLAIM,
  sources: [
    {
      type: 'project_file',
      path: SOURCE,
      content_sha256: `sha256:${sha256Hex(new TextEncoder().encode(CLAIM))}`,
    },
  ],
  claim_fingerprint: knowledgeClaimFingerprint('钟楼规则', CLAIM),
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  superseded_by: null,
};
const book = () =>
  memoryProject(ROOT, {
    [SOURCE]: encoded(CLAIM),
    [KNOWLEDGE]: encoded(renderKnowledgeEntry(entry)),
  });
const options = { platform: 'windows' as const, secrets: { values: [] } };
const collect = (project: ReturnType<typeof book>) =>
  collectProjectKnowledgeContext(
    project.reader,
    { project_root: ROOT },
    { ...options, query: '钟楼规则', contextFiles: [] },
  );
const snapshot = (project: ReturnType<typeof book>) =>
  buildLlmContextSnapshot(
    project.reader,
    {
      intent: 'file.revise',
      userMessage: '按钟楼规则修订',
      filePath: '正文/第002章.md',
      content: '第二章。',
      contextBundle: { project_root: ROOT },
    },
    options,
  );

describe('knowledge whose source chapter is gone', () => {
  it('stays current while the source still says the same thing', async () => {
    const project = book();
    expect(await knowledgeEntryEvidenceState(project.reader, ROOT, entry)).toBe('current');
    expect((await collect(project)).result!.items[0].evidenceState).toBe('current');
  });

  it.each([
    ['deleted', {}],
    ['renamed', { '正文/第001章 钟楼.md': encoded(CLAIM) }],
  ])(
    'turns stale instead of failing the whole context when the source was %s',
    async (_, extra) => {
      const project = book();
      project.apply({ [SOURCE]: null, ...extra });
      expect(await knowledgeEntryEvidenceState(project.reader, ROOT, entry)).toBe('stale');
      expect((await collect(project)).result!.items[0].evidenceState).toBe('stale');
      await expect(snapshot(project)).resolves.toBeTruthy();
      expect(project.takeWrites()).toEqual({});
    },
  );
});
