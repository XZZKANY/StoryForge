/**
 * 灵感速记（作者 10-17 巡检）：点 × 立刻删掉、不能撤销；记下的一条不能改字。
 * 全项目审计（10-19 E-04/E-05/E-06）：写盘以读到的那一份为基线，别处改过就拒写；
 * 撤销只认删除时那本书；写失败不报「已删除」；没读出来就不写。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBookProfile, type BookProfileHandle } from '../src/components/app/useBookProfile';
import {
  appendIdeaNote,
  editIdeaNote,
  removeIdeaNote,
  restoreIdeaNoteLine,
} from '../src/lib/idea-notes';
import { buildProjectIndex } from '../src/lib/project-context';
import { scanManuscriptTotals } from '../src/lib/manuscript-stats';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { emitToast } from '../src/lib/toast';

vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildProjectIndex: vi.fn(),
}));
vi.mock('../src/lib/manuscript-stats', () => ({ scanManuscriptTotals: vi.fn() }));
vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeFileIfUnchanged: vi.fn(),
    createDir: vi.fn(),
  },
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTES = ['# 灵感', '', '- 十七楼那个人是刘哥的弟弟', '  - [x] 第 7 章吞噬变异体', ''].join(
  '\n',
);

test('改一条只换文字：缩进与勾选状态照旧；行号不对或空文字原样返回', () => {
  assert.equal(
    editIdeaNote(NOTES, 3, '第 8 章吞噬变异体'),
    NOTES.replace('  - [x] 第 7 章吞噬变异体', '  - [x] 第 8 章吞噬变异体'),
  );
  assert.equal(
    editIdeaNote(NOTES, 2, '十七楼是刘哥的弟弟'),
    NOTES.replace('- 十七楼那个人是刘哥的弟弟', '- 十七楼是刘哥的弟弟'),
  );
  assert.equal(editIdeaNote(NOTES, 0, '改标题'), NOTES);
  assert.equal(editIdeaNote(NOTES, 2, '   '), NOTES);
});

test('删掉再放回：文件逐字回到原样', () => {
  const raw = NOTES.split('\n')[3]!;
  assert.equal(restoreIdeaNoteLine(removeIdeaNote(NOTES, 3), 3, raw), NOTES);
});

const BOOK_A = 'D:/book';
const BOOK_B = 'D:/other';
const NOTES_A = `${BOOK_A}/灵感.md`;
const NOTES_B = `${BOOK_B}/灵感.md`;
const ONLY_B = ['# 灵感', '', '- B 书独有的一条', ''].join('\n');

/** 内存里的磁盘：条件写照宿主的规矩比对基线，对不上就拒写。 */
const disk = new Map<string, string>();
let unreadable = false;

let root: Root | null = null;
let handle: BookProfileHandle | null = null;
function Harness({ project }: { project: string }) {
  handle = useBookProfile({ activeProject: project, active: true });
  return null;
}

async function open(project = BOOK_A) {
  if (!root) root = createRoot(document.createElement('div'));
  await act(async () => root!.render(<Harness project={project} />));
  await act(async () => {});
}

const note = (text: string) => handle!.notes.find((item) => item.text === text);
const toasts = () => vi.mocked(emitToast).mock.calls.map(([text]) => text);

beforeEach(() => {
  disk.clear();
  disk.set(NOTES_A, NOTES);
  unreadable = false;
  vi.mocked(buildProjectIndex).mockImplementation(
    async (projectPath: string) =>
      ({
        projectPath,
        files: [],
        summary: { hasStoryStructure: false, counts: {} },
      }) as never,
  );
  vi.mocked(scanManuscriptTotals).mockResolvedValue({ chapters: 0, chars: 0, unreadable: 0 });
  vi.mocked(TauriFileSystem.readFile).mockImplementation(async (path: string) => {
    if (!path.endsWith('灵感.md')) return '{}';
    if (unreadable) throw new Error('拒绝访问');
    const text = disk.get(path);
    if (text === undefined) throw new Error('not found');
    return text;
  });
  vi.mocked(TauriFileSystem.writeFileIfUnchanged).mockImplementation(
    async (_root, path, content, expected) => {
      const current = disk.get(path) ?? null;
      const matches = expected.kind === 'missing' ? current === null : current === expected.content;
      if (!matches) throw new Error('磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突');
      disk.set(path, content);
    },
  );
  vi.mocked(emitToast).mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.mocked(TauriFileSystem.writeFileIfUnchanged).mockReset();
  vi.mocked(TauriFileSystem.writeFile).mockReset();
});

test('删一条速记：写回删掉后的文件，右下角给「撤销」，点了把那一行放回原位', async () => {
  await open();
  const target = note('十七楼那个人是刘哥的弟弟')!;

  await act(async () => handle!.removeNote(target));
  assert.equal(disk.get(NOTES_A), removeIdeaNote(NOTES, target.line));
  assert.equal(note('十七楼那个人是刘哥的弟弟'), undefined);
  const [message, options] = vi.mocked(emitToast).mock.calls.at(-1)!;
  assert.equal(message, '已删除这条速记');

  await act(async () => options!.action!.run());
  assert.equal(disk.get(NOTES_A), NOTES);
  assert.ok(note('十七楼那个人是刘哥的弟弟'));
  assert.equal(vi.mocked(TauriFileSystem.writeFile).mock.calls.length, 0);
});

test('读过之后灵感文件在别处改过：再记一条不盖掉后来存的内容，重新读出来后照常记', async () => {
  await open();
  const saved = `${NOTES}- 作者刚在编辑器里存的线索\n`;
  disk.set(NOTES_A, saved);

  await act(async () => handle!.addNote('新的一条'));
  assert.equal(disk.get(NOTES_A), saved);
  assert.match(String(toasts().at(-1)), /^灵感速记没有保存/);
  await act(async () => {});
  assert.ok(note('作者刚在编辑器里存的线索'));

  await act(async () => handle!.addNote('新的一条'));
  assert.equal(disk.get(NOTES_A), appendIdeaNote(saved, '新的一条'));
});

test('删了一条后换到另一本书再点撤销：那一行回到原来那本，另一本的文件和界面都不动', async () => {
  disk.set(NOTES_B, ONLY_B);
  await open(BOOK_A);
  await act(async () => handle!.removeNote(note('十七楼那个人是刘哥的弟弟')!));
  const [, options] = vi.mocked(emitToast).mock.calls.at(-1)!;

  await open(BOOK_B);
  assert.ok(note('B 书独有的一条'));
  await act(async () => options!.action!.run());

  assert.equal(disk.get(NOTES_A), NOTES);
  assert.equal(disk.get(NOTES_B), ONLY_B);
  assert.deepEqual(
    handle!.notes.map((item) => item.text),
    ['B 书独有的一条'],
  );
});

test('删除写盘失败：不报「已删除」也不给撤销，那一条还在', async () => {
  await open();
  vi.mocked(TauriFileSystem.writeFileIfUnchanged).mockRejectedValueOnce(new Error('磁盘已满'));

  await act(async () => handle!.removeNote(note('十七楼那个人是刘哥的弟弟')!));
  assert.equal(disk.get(NOTES_A), NOTES);
  assert.ok(note('十七楼那个人是刘哥的弟弟'));
  assert.ok(!toasts().includes('已删除这条速记'));
  assert.match(String(toasts().at(-1)), /^灵感速记没有保存：磁盘已满/);
});

test('灵感文件没读出来（不是不存在）：不拿空内容写，免得盖掉整个文件', async () => {
  unreadable = true;
  await open();

  await act(async () => handle!.addNote('新的一条'));
  assert.equal(disk.get(NOTES_A), NOTES);
  assert.equal(vi.mocked(TauriFileSystem.writeFileIfUnchanged).mock.calls.length, 0);
  assert.match(String(toasts().at(-1)), /还没读出来/);
});

test('还没有灵感文件：第一条按「文件不存在」为基线新建', async () => {
  disk.delete(NOTES_A);
  await open();

  await act(async () => handle!.addNote('第一条'));
  assert.equal(disk.get(NOTES_A), appendIdeaNote('', '第一条'));
  assert.deepEqual(vi.mocked(TauriFileSystem.writeFileIfUnchanged).mock.calls[0]?.[3], {
    kind: 'missing',
  });
});

test('刚换到另一本书、它的灵感文件还没读出来：不拿上一本的内容写进去', async () => {
  disk.set(NOTES_B, ONLY_B);
  await open(BOOK_A);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.mocked(TauriFileSystem.readFile).getMockImplementation()!;
  vi.mocked(TauriFileSystem.readFile).mockImplementation(async (path: string) => {
    if (path === NOTES_B) await gate;
    return read(path);
  });

  await open(BOOK_B);
  await act(async () => handle!.addNote('写给 B 的一条'));
  assert.equal(disk.get(NOTES_B), ONLY_B);
  assert.equal(disk.get(NOTES_A), NOTES);
  assert.match(String(toasts().at(-1)), /还没读出来/);
  await act(async () => release());
});
