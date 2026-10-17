/**
 * 灵感速记（作者 10-17 巡检）：点 × 立刻删掉、不能撤销；记下的一条不能改字。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBookProfile, type BookProfileHandle } from '../src/components/app/useBookProfile';
import { editIdeaNote, removeIdeaNote, restoreIdeaNoteLine } from '../src/lib/idea-notes';
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
  TauriFileSystem: { readFile: vi.fn(), writeFile: vi.fn(), createDir: vi.fn() },
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

let root: Root | null = null;
let handle: BookProfileHandle | null = null;
function Harness() {
  handle = useBookProfile({ activeProject: 'D:/book', active: true });
  return null;
}

beforeEach(() => {
  vi.mocked(buildProjectIndex).mockResolvedValue({
    projectPath: 'D:/book',
    files: [],
    summary: { hasStoryStructure: false, counts: {} },
  } as never);
  vi.mocked(scanManuscriptTotals).mockResolvedValue({ chapters: 0, chars: 0, unreadable: 0 });
  vi.mocked(TauriFileSystem.readFile).mockImplementation(async (path: string) =>
    path.endsWith('灵感.md') ? NOTES : '{}',
  );
  vi.mocked(TauriFileSystem.writeFile).mockResolvedValue(undefined);
  vi.mocked(emitToast).mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

test('删一条速记：写回删掉后的文件，右下角给「撤销」，点了把那一行放回原位', async () => {
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  await act(async () => {});
  const note = handle!.notes.find((item) => item.text === '十七楼那个人是刘哥的弟弟')!;

  await act(async () => handle!.removeNote(note));
  const writes = vi.mocked(TauriFileSystem.writeFile).mock.calls;
  assert.equal(writes.at(-1)?.[2], removeIdeaNote(NOTES, note.line));
  const [message, options] = vi.mocked(emitToast).mock.calls.at(-1)!;
  assert.equal(message, '已删除这条速记');

  await act(async () => options!.action!.run());
  assert.equal(vi.mocked(TauriFileSystem.writeFile).mock.calls.at(-1)?.[2], NOTES);
});
