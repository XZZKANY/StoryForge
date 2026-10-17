import { describe, expect, it } from 'vitest';
import { canonDelta, readPendingProposals } from './canonDelta';
import type { EncodedFile } from './contextFixture.test-support';
import { memoryProject } from './memoryProject.test-support';

const ROOT = 'D:\\book';
const CANON = '.storyforge/canon/canon.json';
const encode = (text: string): EncodedFile => ({
  chunks: [
    {
      base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))),
      repeat: 1,
    },
  ],
});

async function setup() {
  const project = memoryProject(ROOT, {
    '正文/第001章.md': encode('# 第001章\n\n她把那封旧信收进抽屉，没有拆。\n'),
  });
  const observe = (title: string) =>
    canonDelta(
      project.reader,
      project.writer,
      ROOT,
      { promiseClaims: [{ title, planted_chapter: 1 }] },
      'windows',
    );
  const pendingPromises = async () => {
    const pending = await readPendingProposals(project.reader, ROOT);
    return (
      (pending.new_invariants as { promises?: { id: string; title: string }[] }).promises ?? []
    );
  };
  const readCanon = async () => {
    const { bytes } = await project.reader.readProjectBytes(ROOT, CANON, 1_000_000);
    return JSON.parse(new TextDecoder().decode(bytes)) as {
      invariants?: { promises?: object[] };
    };
  };
  const writePromises = async (promises: object[]) => {
    const canon = await readCanon();
    canon.invariants = { ...canon.invariants, promises };
    project.apply({ [CANON]: encode(JSON.stringify(canon, null, 2)) });
  };
  return { observe, pendingPromises, writePromises };
}

describe('伏笔提案按 id 认是否已声明', () => {
  it('并入后标为已回收，旧提案不再变回待确认；同一条再被观察到也不再列出', async () => {
    const book = await setup();
    await book.observe('巡检信件');
    const [proposal] = await book.pendingPromises();
    expect(proposal.title).toBe('巡检信件');

    await book.writePromises([proposal]);
    expect(await book.pendingPromises()).toEqual([]);

    await book.writePromises([{ ...proposal, status: 'resolved', resolved_chapter: 2 }]);
    expect(await book.pendingPromises()).toEqual([]);

    await book.observe('巡检信件');
    expect(await book.pendingPromises()).toEqual([]);
  });

  it('canon 里 id 前后带空白也算同一条；别的伏笔照常待确认', async () => {
    const book = await setup();
    await book.observe('巡检信件');
    const [proposal] = await book.pendingPromises();
    await book.writePromises([{ ...proposal, id: ` ${proposal.id} `, status: 'resolved' }]);
    await book.observe('抽屉钥匙');
    expect((await book.pendingPromises()).map((item) => item.title)).toEqual(['抽屉钥匙']);
  });
});
