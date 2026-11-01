/**
 * 观测镜的三个写作动作接在真实的 useObservatory 上：
 * 「不要」只在本机隐藏且可撤销；「标为已回收」先问回收章、校验后才写；「并入」不确认就不写。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useObservatory } from '../src/components/app/useObservatory';
import { ObservatoryView } from '../src/components/shell/ObservatoryView';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { canonDeclarationPathFor } from '../src/lib/canon-merge';
import { invalidateFileSystemCache } from '../src/lib/host/tauri-fs';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: vi.fn(async () => null) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = '/books/canon-actions';
const PATH = canonDeclarationPathFor(PROJECT);
const PROMISE = { id: 'p1', title: '归还旧钥匙', status: 'planted', planted_chapter: 2 };

let disk: Map<string, string>;
let toasts: ToastDetail[];
let confirm: ReturnType<typeof vi.fn>;
let prompt: ReturnType<typeof vi.fn>;
let root: Root;
let container: HTMLDivElement;
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);

function Harness() {
  const obs = useObservatory({ activeProject: PROJECT, dialogs: { confirm, prompt } });
  return (
    <ObservatoryView
      {...obs}
      onRescan={() => void obs.runScan()}
      onBackToChat={() => {}}
      onMergeProposal={(target, label) => void obs.mergeProposal(target, label)}
      onDismissProposal={obs.dismissProposal}
      onResolvePromise={(promise) => void obs.resolvePromise(promise)}
    />
  );
}

async function mount() {
  await act(async () => root.render(<Harness />));
}

const cards = () => container.querySelectorAll<HTMLElement>('[data-testid="proposal-card"]');
const canon = () => JSON.parse(disk.get(PATH)!);
const click = (element: HTMLElement | null | undefined) =>
  act(async () => {
    element!.click();
  });

beforeEach(() => {
  localStorage.clear();
  disk = new Map([[PATH, JSON.stringify({ version: 1, invariants: { promises: [PROMISE] } })]]);
  toasts = [];
  confirm = vi.fn(async () => true);
  prompt = vi.fn(async () => null);
  window.addEventListener(TOAST_EVENT, onToast);
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => disk.has(path),
    readFile: (path) => disk.get(path) ?? '',
    writeFile: (path, content) => void disk.set(path, content),
  };
  vi.mocked(executeIdeCommand).mockResolvedValue({
    command_id: 'observatory.scan',
    status: 'accepted',
    payload: {
      observatory: {
        proposals: {
          available: true,
          pending_count: 1,
          new_entities: [{ id: 'ent_radio', canonical_name: '旧电台', aliases: [] }],
          new_invariants: {},
        },
        promises: { current_chapter: 4, ledger: [PROMISE] },
      },
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.removeEventListener(TOAST_EVENT, onToast);
  delete window.__STORYFORGE_MOCK_FS__;
  invalidateFileSystemCache();
  vi.mocked(executeIdeCommand).mockReset();
});

test('「不要」：卡片收起、canon.json 不动、重开还在隐藏；右下角撤销能放回来', async () => {
  await mount();
  const before = disk.get(PATH);
  await click(cards()[0]?.querySelector('[data-testid="proposal-dismiss"]'));
  expect(cards()).toHaveLength(0);
  expect(disk.get(PATH)).toBe(before);
  expect(toasts.at(-1)?.message).toMatch(/不要了.*canon.json 没动/);

  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  expect(cards()).toHaveLength(0);

  await act(async () => toasts.at(-1)!.action!.run());
  expect(cards()).toHaveLength(1);
});

test('「并入」不点确认就不写', async () => {
  confirm.mockResolvedValue(false);
  await mount();
  const before = disk.get(PATH);
  await click(cards()[0]?.querySelector('[data-testid="proposal-merge"]'));
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('新实体「旧电台」') }),
  );
  expect(disk.get(PATH)).toBe(before);
});

test('「标为已回收」：默认填正文写到的章，写进 canon.json，可撤销', async () => {
  prompt.mockResolvedValue('3');
  await mount();
  await click(container.querySelector('[data-testid="promise-resolve"]'));
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: '4' }));
  expect(canon().invariants.promises[0]).toMatchObject({ status: 'resolved', resolved_chapter: 3 });
  const done = toasts.at(-1)!;
  expect(done.message).toBe('已把「归还旧钥匙」记为第 3 章回收');
  await act(async () => done.action!.run());
  expect(canon().invariants.promises[0]).toEqual(PROMISE);
});

test('回收章写得不对就不写：不是整数、早于埋下的章', async () => {
  await mount();
  const before = disk.get(PATH);
  for (const answer of ['第三章', '1']) {
    prompt.mockResolvedValueOnce(answer);
    await click(container.querySelector('[data-testid="promise-resolve"]'));
    expect(toasts.at(-1)?.tone).toBe('error');
  }
  expect(toasts.at(-2)?.message).toMatch(/正整数/);
  expect(toasts.at(-1)?.message).toMatch(/第 2 章才埋下/);
  expect(disk.get(PATH)).toBe(before);
});
