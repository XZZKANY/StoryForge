import { act, useLayoutEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { useProjectWorkspace } from '../src/components/app/useProjectWorkspace';
import { useReasoningEffort } from '../src/components/chat-window/useReasoningEffort';
import { nativeLlmSource } from '../src/lib/engine/llm';
import {
  bindReasoningEffortProject,
  currentReasoningEffortSourceValue,
  normalizeReasoningEffort,
  readReasoningEffort,
  writeReasoningEffort,
  type ReasoningEffort,
} from '../src/lib/reasoning-effort';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'D:\\书\\甲';
const B = 'D:\\书\\乙';
const RUST_SOURCE = {
  STORYFORGE_LLM_PROVIDER: 'openai-compatible',
  STORYFORGE_LLM_MODEL: 'm',
  STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
  // 进程环境变量里带的等级：界面选择要压过它。
  STORYFORGE_LLM_REASONING_EFFORT: 'medium',
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  bindReasoningEffortProject(null);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => ({ ...RUST_SOURCE }));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  host = null;
  root = null;
});

function mount(node: ReactNode) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(node));
}

test('默认关；按项目存取；不认识的值当关；没项目不落盘', () => {
  expect(readReasoningEffort(A)).toBe('off');
  expect(readReasoningEffort(null)).toBe('off');
  expect(writeReasoningEffort(A, 'high')).toBe('high');
  expect(localStorage.getItem(`storyforge:reasoning-effort:${A}`)).toBe('high');
  expect(readReasoningEffort(A)).toBe('high');
  expect(readReasoningEffort(B)).toBe('off');
  localStorage.setItem(`storyforge:reasoning-effort:${B}`, 'max');
  expect(readReasoningEffort(B)).toBe('off');
  for (const bad of [null, undefined, 1, 'HIGH', 'xhigh', ''])
    expect(normalizeReasoningEffort(bad)).toBe('off');
  expect(writeReasoningEffort(null, 'low')).toBe('low');
  expect(localStorage.length).toBe(2);
});

test('注入：关 → 空串压过环境变量，low → low，主模型与润色那套都覆盖，切项目换值', async () => {
  writeReasoningEffort(A, 'low');
  bindReasoningEffortProject(A);
  expect((await nativeLlmSource('main')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('low');
  expect((await nativeLlmSource('polish')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('low');

  bindReasoningEffortProject(B);
  expect((await nativeLlmSource('main')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('');

  writeReasoningEffort(B, 'high');
  expect((await nativeLlmSource('main')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('high');
  writeReasoningEffort(B, 'off');
  expect((await nativeLlmSource('polish')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('');
});

test('当前项目由持有它的 workspace hook 绑定：切项目后下一次取配置就是新项目的等级', async () => {
  writeReasoningEffort(A, 'low');
  writeReasoningEffort(B, 'high');
  let select: (path: string) => void = () => undefined;
  function Harness() {
    const workspace = useProjectWorkspace({
      onProjectSelected: () => undefined,
      onFileSelected: () => undefined,
    });
    select = workspace.selectProject;
    return null;
  }
  mount(<Harness />);
  expect(currentReasoningEffortSourceValue()).toBe('');
  act(() => select(A));
  expect((await nativeLlmSource('main')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('low');
  act(() => select(B));
  expect((await nativeLlmSource('main')).source.STORYFORGE_LLM_REASONING_EFFORT).toBe('high');
});

test('下拉用的 hook 换项目时同一次提交就换值，不提交上一个项目的等级', () => {
  writeReasoningEffort(A, 'low');
  writeReasoningEffort(B, 'high');
  const committed: [string | null, ReasoningEffort][] = [];
  let change: (next: ReasoningEffort) => void = () => undefined;
  function Probe({ projectPath }: { projectPath: string | null }) {
    const { effort, changeEffort } = useReasoningEffort(projectPath);
    change = changeEffort;
    useLayoutEffect(() => {
      committed.push([projectPath, effort]);
    });
    return null;
  }
  mount(<Probe projectPath={A} />);
  mount(<Probe projectPath={B} />);
  expect(committed).toEqual([
    [A, 'low'],
    [B, 'high'],
  ]);
  act(() => change('medium'));
  expect(readReasoningEffort(B)).toBe('medium');
  expect(readReasoningEffort(A)).toBe('low');
  expect(committed.at(-1)).toEqual([B, 'medium']);
});
