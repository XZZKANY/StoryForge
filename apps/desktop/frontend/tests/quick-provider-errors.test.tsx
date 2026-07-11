import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { App } from '../src/App';
import { saveDesktopLlmConfig } from '../src/lib/desktop-llm-config';

vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/desktop-llm-config')>();
  return { ...actual, saveDesktopLlmConfig: vi.fn() };
});

vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: vi.fn().mockResolvedValue({ status: 'unreachable' }),
}));

const mockedSaveDesktopLlmConfig = vi.mocked(saveDesktopLlmConfig);

beforeEach(() => {
  localStorage.clear();
  mockedSaveDesktopLlmConfig.mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function renderAppWithRejectedSave() {
  mockedSaveDesktopLlmConfig.mockRejectedValue(new Error('配置写盘失败'));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
  });
  return { container, root };
}

test('欢迎页 Provider 保存失败时回滚并显示错误', async () => {
  const { container, root } = await renderAppWithRejectedSave();
  try {
    const providerButton =
      container.querySelector<HTMLButtonElement>('button[title="切换模型服务商"]');
    assert.ok(providerButton);
    assert.match(providerButton.textContent ?? '', /OpenAI/);
    act(() => providerButton.click());

    const deepseekButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'DeepSeek',
    );
    assert.ok(deepseekButton);
    await act(async () => {
      deepseekButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(providerButton.textContent ?? '', /OpenAI/);
    assert.match(container.textContent ?? '', /服务商切换失败/);
    assert.match(container.textContent ?? '', /已恢复原服务商/);
  } finally {
    act(() => root.unmount());
  }
});

test('欢迎页模型保存失败时回滚并显示错误', async () => {
  const { container, root } = await renderAppWithRejectedSave();
  try {
    const modelButton = container.querySelector<HTMLButtonElement>('button[title="切换默认模型"]');
    assert.ok(modelButton);
    assert.match(modelButton.textContent ?? '', /选择模型/);
    act(() => modelButton.click());

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="例如 gpt-4.1、deepseek-chat"]',
    );
    assert.ok(input);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'gpt-test',
      );
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    const applyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '应用',
    );
    assert.ok(applyButton);
    await act(async () => {
      applyButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.match(modelButton.textContent ?? '', /选择模型/);
    assert.match(container.textContent ?? '', /模型切换失败/);
    assert.match(container.textContent ?? '', /已恢复原模型/);
  } finally {
    act(() => root.unmount());
  }
});

test('较早的模型保存失败不能回滚较新的同值请求', async () => {
  let rejectFirst!: (error: Error) => void;
  mockedSaveDesktopLlmConfig
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    const applyModel = async (model: string) => {
      const modelButton =
        container.querySelector<HTMLButtonElement>('button[title="切换默认模型"]');
      assert.ok(modelButton);
      act(() => modelButton.click());
      const input = container.querySelector<HTMLInputElement>(
        'input[placeholder="例如 gpt-4.1、deepseek-chat"]',
      );
      assert.ok(input);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          model,
        );
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      const applyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === '应用',
      );
      assert.ok(applyButton);
      await act(async () => {
        applyButton.click();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    };

    await applyModel('gpt-race');
    assert.match(
      container.querySelector<HTMLButtonElement>('button[title="切换默认模型"]')?.textContent ?? '',
      /gpt-race/,
    );
    await applyModel('gpt-race');
    await act(async () => {
      rejectFirst(new Error('旧请求失败'));
      await Promise.resolve();
    });

    const modelButton = container.querySelector<HTMLButtonElement>('button[title="切换默认模型"]');
    assert.match(modelButton?.textContent ?? '', /gpt-race/);
    assert.equal((container.textContent ?? '').includes('模型切换失败'), false);
  } finally {
    act(() => root.unmount());
  }
});
