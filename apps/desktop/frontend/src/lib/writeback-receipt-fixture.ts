/** Browser smoke fixture only. Production admission/durability belongs to the Rust commands. */
import { relativePathInsideProject } from './project/path';
import type { DiskBaseline } from './tauri-fs';
import type { WritebackReceipt, WritebackRequest } from './writeback-receipt-types';

type FixtureFs = {
  readFile?: (path: string) => Promise<string> | string;
  writeFile?: (path: string, content: string) => Promise<void> | void;
  pathExists?: (path: string) => Promise<boolean> | boolean;
};
type StoredFixtureReceipt = {
  fingerprint: string;
  before: DiskBaseline;
  after: string;
  receipt: WritebackReceipt;
};
// Deliberately synchronous fixture label, NOT the native SHA-256 identity/security boundary.
// Exact serialized fingerprint below detects fixture-label collisions without permitting replay.
function fixtureLabel(value: string): string {
  return Array.from({ length: 8 }, (_, seed) => {
    let hash = 2166136261 ^ seed;
    for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}
async function identity(projectRoot: string, request: WritebackRequest) {
  const relative = relativePathInsideProject(projectRoot, request.path);
  if (!relative) throw new Error('写回目标不在当前项目内');
  const operationId = fixtureLabel(JSON.stringify([relative, request.operationKey]));
  return {
    operationId,
    fingerprint: JSON.stringify([relative, request.operationKey, request.source, request.content]),
    path: `${projectRoot.replace(/[/\\]+$/, '')}/.storyforge/writeback-receipts/${operationId}.fixture.json`,
  };
}
function requireFixture(fs: FixtureFs) {
  if (!fs.readFile || !fs.pathExists || !fs.writeFile)
    throw new Error('测试文件系统缺少写回回执能力');
  return { read: fs.readFile, exists: fs.pathExists, write: fs.writeFile };
}
export async function inspectFixtureReceipt(
  fs: FixtureFs,
  projectRoot: string,
  request: WritebackRequest,
): Promise<WritebackReceipt | null> {
  const io = requireFixture(fs);
  const key = await identity(projectRoot, request);
  if (!(await io.exists(key.path))) return null;
  const stored = JSON.parse(await io.read(key.path)) as StoredFixtureReceipt;
  if (stored.fingerprint !== key.fingerprint) throw new Error('写回操作身份冲突');
  const exists = await io.exists(request.path);
  const content = exists ? await io.read(request.path) : null;
  const current =
    content === stored.after
      ? 'after'
      : stored.before.kind === 'content' && content === stored.before.content
        ? 'before'
        : !exists
          ? stored.before.kind === 'missing'
            ? 'before'
            : 'missing'
          : 'diverged';
  return { ...stored.receipt, current };
}
export async function writeFixtureReceipt(
  fs: FixtureFs,
  projectRoot: string,
  request: WritebackRequest,
  expected: DiskBaseline,
  checkpointTimestamp: number | null,
  dispatch: () => Promise<void>,
): Promise<WritebackReceipt> {
  const existing = await inspectFixtureReceipt(fs, projectRoot, request);
  if (existing) return existing;
  const io = requireFixture(fs);
  const key = await identity(projectRoot, request);
  const stored: StoredFixtureReceipt = {
    fingerprint: key.fingerprint,
    before: expected,
    after: request.content,
    receipt: {
      operationId: key.operationId,
      state: 'outcome_unknown',
      current: 'before',
      checkpointTimestamp,
      createdFile: expected.kind === 'missing',
      receiptPersisted: false,
    },
  };
  await io.write(key.path, JSON.stringify(stored));
  try {
    await dispatch();
    stored.receipt = { ...stored.receipt, state: 'applied', current: 'after' };
  } catch (error) {
    stored.receipt = {
      ...stored.receipt,
      state: 'not_written',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    await io.write(
      key.path,
      JSON.stringify({ ...stored, receipt: { ...stored.receipt, receiptPersisted: true } }),
    );
    return { ...stored.receipt, receiptPersisted: true };
  } catch (error) {
    return { ...stored.receipt, detail: error instanceof Error ? error.message : String(error) };
  }
}

// A browser fixture has no native create_new; this queue only emulates admission.
// Durable truth still comes from the fixture files, not this process-local queue.
const fixtureAuditQueues = new WeakMap<FixtureFs, Promise<void>>();
export async function createFixtureAudit(
  fs: FixtureFs,
  root: string,
  operationId: string,
  content: string,
): Promise<void> {
  const io = requireFixture(fs);
  const separator = root.includes('\\') ? '\\' : '/';
  const path = [
    root.replace(/[/\\]+$/, ''),
    '.storyforge',
    'author-loop',
    `${operationId}.md`,
  ].join(separator);
  const previous = fixtureAuditQueues.get(fs) ?? Promise.resolve();
  const work = previous
    .catch(() => {})
    .then(async () => {
      if (!(await io.exists(path))) await io.write(path, content);
    });
  fixtureAuditQueues.set(fs, work);
  try {
    await work;
  } finally {
    if (fixtureAuditQueues.get(fs) === work) fixtureAuditQueues.delete(fs);
  }
}
