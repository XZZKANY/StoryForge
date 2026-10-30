import { describe, expect, it } from 'vitest';
import { MAX_SOURCE_BYTES as BREAKDOWN_SOURCE_BYTES } from './kernel/bookBreakdown';
import { contextFixtureReader } from './kernel/contextFixture.test-support';
import { memoryProject } from './kernel/memoryProject.test-support';
import { MAX_NATIVE_READ_BYTES, ProjectReadError } from './readPort';

// 「林舟」的 UTF-8，6 字节。
const file = { chunks: [{ base64: '5p6X6Iif', repeat: 1 }] };

// 测试替身与 Rust 读口同一条上限：引擎哪里要的预算超出宿主肯给的，测试里就读不到。
describe('the native read budget ceiling', () => {
  const readers = {
    memoryProject: () => ({
      root: 'D:/book',
      reader: memoryProject('D:/book', { 'a.md': file }).reader,
    }),
    contextFixture: () => ({
      root: 'D:/synthetic-book',
      reader: contextFixtureReader({ files: { 'a.md': file }, missing_root: false }).reader,
    }),
  };
  for (const [name, open] of Object.entries(readers))
    it(`${name} refuses a budget above it and honours one at it`, async () => {
      const { root, reader } = open();
      await expect(
        reader.readProjectBytes(root, 'a.md', MAX_NATIVE_READ_BYTES + 1),
      ).rejects.toThrow(new ProjectReadError('作品文件读取预算无效'));
      const read = await reader.readProjectBytes(root, 'a.md', MAX_NATIVE_READ_BYTES);
      expect([read.bytes.length, read.exceeded]).toEqual([6, false]);
    });

  it('covers the largest budget the engine asks for', () => {
    expect(BREAKDOWN_SOURCE_BYTES).toBeLessThanOrEqual(MAX_NATIVE_READ_BYTES);
  });
});
