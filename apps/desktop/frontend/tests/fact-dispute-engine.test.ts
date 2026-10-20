/**
 * 全项目审计 B-08：先记「老陈出生北城」、之后才在 canon 里补「老陈是陈默的别名」，
 * 再把「陈默出生南城」以本章为准——处理待定时要按作品现在的 canon 认别名，只剩一个有效值。
 */
import { beforeEach, expect, it, vi } from 'vitest';
import type { ProjectReader } from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';

const ROOT = 'D:\\book';
const fixture = vi.hoisted(() => ({ reader: null as unknown as ProjectReader }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.2.0' }));
vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: {
    resolveProjectPath: (...args: Parameters<ProjectReader['resolveProjectPath']>) =>
      fixture.reader.resolveProjectPath(...args),
    inspectProjectPath: (...args: Parameters<ProjectReader['inspectProjectPath']>) =>
      fixture.reader.inspectProjectPath(...args),
    readProjectDirectory: (...args: Parameters<ProjectReader['readProjectDirectory']>) =>
      fixture.reader.readProjectDirectory(...args),
    readProjectBytes: (...args: Parameters<ProjectReader['readProjectBytes']>) =>
      fixture.reader.readProjectBytes(...args),
  },
}));

const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const born = (id: string, subject: string, value: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: '来历',
  subject,
  attribute: '出生地',
  value,
  object: null,
  path: '正文/第001章.md',
  status: 'active',
  ...extra,
});
const LEDGER = JSON.stringify({
  version: 1,
  facts: [
    born('north', '老陈', '北城'),
    born('south', '陈默', '南城', {
      path: '正文/第002章.md',
      status: 'disputed',
      disputes: 'north',
    }),
  ],
});
const active = (text: string) =>
  (JSON.parse(text).facts as { value: string; status: string }[])
    .filter((fact) => fact.status === 'active')
    .map((fact) => fact.value);

beforeEach(() => {
  fixture.reader = memoryProject(ROOT, {
    '.storyforge/canon/canon.json': file(
      JSON.stringify({
        version: 1,
        entities: [
          { id: 'e1', canonical_name: '陈默', aliases: ['老陈', '陈哥'] },
          { id: 'e2', canonical_name: '林舟', aliases: ['阿舟'] },
        ],
        invariants: {},
      }),
    ),
  }).reader;
});

it('以本章为准时按作品现在的 canon 认别名：按两个旧名记下的北城、西城都被替代，只剩南城', async () => {
  const { resolveLedgerDispute } = await import('../src/lib/api/facts');
  const ledger = JSON.stringify({
    version: 1,
    facts: [
      born('north', '老陈', '北城'),
      born('west', '陈哥', '西城', { path: '正文/第003章.md' }),
      born('south', '陈默', '南城', {
        path: '正文/第002章.md',
        status: 'disputed',
        disputes: 'north',
      }),
      born('east', '阿舟', '东城'),
    ],
  });
  expect(active(await resolveLedgerDispute(ROOT, ledger, 'south', 'accept'))).toEqual([
    '南城',
    '东城',
  ]);
});

it('canon 读不出来时照旧能处理：当初对上的那条照样被替代', async () => {
  fixture.reader = memoryProject(ROOT, {
    '.storyforge/canon/canon.json': file('{ 坏了'),
  }).reader;
  const { resolveLedgerDispute } = await import('../src/lib/api/facts');
  expect(active(await resolveLedgerDispute(ROOT, LEDGER, 'south', 'accept'))).toEqual(['南城']);
});
