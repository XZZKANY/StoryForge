// @vitest-environment node
import { expect, it } from 'vitest';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import { overlayProject } from '../src/lib/engine/shadowProject';

const ROOT = 'D:/book';
const text = (value: string) => ({
  chunks: [{ base64: Buffer.from(value).toString('base64'), repeat: 1 }],
});
const bytes = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);

function setup() {
  const base = memoryProject(ROOT, {
    '正文/第001章.md': text('林舟推开门。'),
    '.storyforge/canon/canon.json': text('{}'),
  });
  return { base, overlay: overlayProject(base.reader) };
}

it('reads its own writes first and never writes the project', async () => {
  const { base, overlay } = setup();
  await overlay.writer.writeProjectFile(ROOT, '.storyforge/canon/canon.json', bytes('{"a":1}'));
  await overlay.writer.writeProjectFile(
    ROOT,
    '.storyforge/canon/derived/dossier.md',
    bytes('档案'),
  );
  expect(
    decode((await overlay.reader.readProjectBytes(ROOT, '.storyforge/canon/canon.json', 99)).bytes),
  ).toBe('{"a":1}');
  expect(
    await overlay.reader.inspectProjectPath(ROOT, `${ROOT}/.storyforge/canon/derived/dossier.md`),
  ).toEqual({ entryKind: 'file', targetKind: 'file', isReparsePoint: false, sizeBytes: 6 });
  // 真实项目里还是原样。
  expect(
    decode((await base.reader.readProjectBytes(ROOT, '.storyforge/canon/canon.json', 99)).bytes),
  ).toBe('{}');
  expect(base.takeWrites()).toEqual({});
  expect(overlay.writes()).toEqual([
    '.storyforge/canon/canon.json',
    '.storyforge/canon/derived/dossier.md',
  ]);
});

it('keeps the byte cap contract of the real reader', async () => {
  const { overlay } = setup();
  await overlay.writer.writeProjectFile(ROOT, '.storyforge/plan.json', bytes('abcdef'));
  expect(await overlay.reader.readProjectBytes(ROOT, '.storyforge/plan.json', 3)).toEqual({
    bytes: bytes('abcd'),
    exceeded: true,
  });
  expect(await overlay.reader.readProjectBytes(ROOT, '.storyforge/plan.json', 6)).toEqual({
    bytes: bytes('abcdef'),
    exceeded: false,
  });
});

it('lists written files beside real ones, including directories only the overlay has', async () => {
  const { overlay } = setup();
  await overlay.writer.writeProjectFile(ROOT, '.storyforge/canon/derived/dossier.md', bytes('x'));
  expect(await overlay.reader.inspectProjectPath(ROOT, '.storyforge/canon/derived')).toMatchObject({
    entryKind: 'directory',
    targetKind: 'directory',
  });
  expect(await overlay.reader.readProjectDirectory(ROOT, '.storyforge/canon', 10)).toEqual({
    names: ['canon.json', 'derived'],
    exceeded: false,
    terminalError: null,
  });
  expect(await overlay.reader.readProjectDirectory(ROOT, '.storyforge/canon/derived', 10)).toEqual({
    names: ['dossier.md'],
    exceeded: false,
    terminalError: null,
  });
  expect(await overlay.reader.readProjectDirectory(ROOT, '.storyforge/canon', 1)).toEqual({
    names: ['canon.json', 'derived'],
    exceeded: true,
    terminalError: null,
  });
  // 没写过的目录照真实读口。
  expect((await overlay.reader.readProjectDirectory(ROOT, '正文', 10)).names).toEqual([
    '第001章.md',
  ]);
});

it('serves the preimage before the real reader: what Python changed is read as it was', async () => {
  const base = memoryProject(ROOT, {
    '.storyforge/canon/canon.json': text('{"after":true}'),
    '.storyforge/serial-plan.json': text('{"after":true}'),
  });
  // 调用 Python 前：canon.json 还不存在，serial-plan.json 是旧版本。
  const overlay = overlayProject(
    base.reader,
    new Map([
      ['.storyforge/canon/canon.json', null],
      ['.storyforge/serial-plan.json', bytes('{"before":true}')],
    ]),
  );
  expect(await overlay.reader.inspectProjectPath(ROOT, '.storyforge/canon/canon.json')).toEqual({
    entryKind: 'missing',
    targetKind: 'missing',
    isReparsePoint: false,
    sizeBytes: 0,
  });
  await expect(
    overlay.reader.readProjectBytes(ROOT, `${ROOT}/.storyforge/canon/canon.json`, 99),
  ).rejects.toThrow('调用前这个文件不存在');
  expect(
    decode((await overlay.reader.readProjectBytes(ROOT, '.storyforge/serial-plan.json', 99)).bytes),
  ).toBe('{"before":true}');
  expect(
    (await overlay.reader.inspectProjectPath(ROOT, '.storyforge/serial-plan.json')).sizeBytes,
  ).toBe(15);
  // 引擎自己写过之后读到的是自己写的。
  await overlay.writer.writeProjectFile(ROOT, '.storyforge/canon/canon.json', bytes('{}'));
  expect(
    decode((await overlay.reader.readProjectBytes(ROOT, '.storyforge/canon/canon.json', 99)).bytes),
  ).toBe('{}');
  expect(decode(overlay.written().get('.storyforge/canon/canon.json')!)).toBe('{}');
});
