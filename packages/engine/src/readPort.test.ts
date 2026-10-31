import { describe, expect, it } from 'vitest';
import { MAX_SOURCE_BYTES as BREAKDOWN_SOURCE_BYTES } from './kernel/bookBreakdown';
import { contextFixtureReader } from './kernel/contextFixture.test-support';
import { memoryProject } from './kernel/memoryProject.test-support';
import {
  decodeUtf8,
  MAX_NATIVE_READ_BYTES,
  normalizeNewlines,
  ProjectReadError,
  readOptionalProjectText,
  readProjectText,
  stripBom,
} from './readPort';

// 「林舟」的 UTF-8，6 字节。
const file = { chunks: [{ base64: '5p6X6Iif', repeat: 1 }] };
const encoded = (text: string) => new TextEncoder().encode(text);
const textFile = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...encoded(text))), repeat: 1 }],
});
const BOM = String.fromCharCode(0xfeff);
const REPLACEMENT = String.fromCharCode(0xfffd);

describe('the single UTF-8 decoder', () => {
  it('keeps a leading BOM and CRLF exactly as they are on disk', () => {
    expect(decodeUtf8(encoded(BOM + '甲\r\n乙'))).toBe(BOM + '甲\r\n乙');
    expect(decodeUtf8(encoded(BOM + '甲'), { fatal: true })).toBe(BOM + '甲');
  });

  it('leaves BOM and newline cleanup to callers that only parse', () => {
    expect(normalizeNewlines(stripBom(BOM + '甲\r\n乙\r丙\n'))).toBe('甲\n乙\n丙\n');
    expect(stripBom(BOM + BOM + '甲')).toBe(BOM + '甲');
    expect(stripBom('甲' + BOM)).toBe('甲' + BOM);
  });

  it('replaces invalid bytes unless fatal, and drops a half character at a cut', () => {
    const invalid = new Uint8Array([0xe6, 0x9e, 0x41]);
    expect(decodeUtf8(invalid)).toBe(REPLACEMENT + 'A');
    expect(() => decodeUtf8(invalid, { fatal: true })).toThrow(TypeError);
    const cut = encoded('林舟').subarray(0, 4);
    expect(decodeUtf8(cut, { truncated: true })).toBe('林');
    expect(decodeUtf8(cut, { truncated: true })).toBe('林');
    expect(decodeUtf8(cut)).toBe('林' + REPLACEMENT);
  });
});

describe('reading project text', () => {
  const project = () =>
    memoryProject('D:/book', { 'a.md': textFile(BOM + '林舟\r\n'), 'b.md': file });

  it('decodes faithfully and gives null past the budget', async () => {
    const { reader } = project();
    const read = await readProjectText(reader, 'D:/book', 'a.md', 1024);
    expect(read?.text).toBe(BOM + '林舟\r\n');
    expect(read?.bytes.length).toBe(11);
    expect(await readProjectText(reader, 'D:/book', 'a.md', 4)).toBeNull();
    await expect(readProjectText(reader, 'D:/book', 'missing.md', 1024)).rejects.toThrow(
      ProjectReadError,
    );
  });

  it('turns an unreadable optional source into null and reads each path once with a cache', async () => {
    const opened = project();
    const cache = new Map<string, string | null>();
    expect(await readOptionalProjectText(opened.reader, 'D:/book', 'missing.md', 1024)).toBeNull();
    expect(await readOptionalProjectText(opened.reader, 'D:/book', 'b.md', 1024, cache)).toBe(
      '林舟',
    );
    opened.apply({ 'b.md': textFile('改过') });
    expect(await readOptionalProjectText(opened.reader, 'D:/book', 'b.md', 1024, cache)).toBe(
      '林舟',
    );
    expect(await readOptionalProjectText(opened.reader, 'D:/book', 'b.md', 1024)).toBe('改过');
  });
});

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
