'use client';

import { useState } from 'react';

const storageKey = 'storyforge-provider-settings';

type ProviderSettings = {
  readonly baseUrl: string;
};

type ModelsResponse =
  | { readonly ok: true; readonly models: readonly string[]; readonly endpoint: string }
  | { readonly ok: false; readonly message: string; readonly endpoint?: string };

const defaultSettings: ProviderSettings = {
  baseUrl: 'https://api.openai.com',
};

function readStoredSettings(): ProviderSettings {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultSettings;
    const value = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      baseUrl:
        typeof value.baseUrl === 'string' && value.baseUrl
          ? value.baseUrl
          : defaultSettings.baseUrl,
    };
  } catch {
    return defaultSettings;
  }
}

function readInputValue(id: string): string {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element.value : '';
}

export function SettingsClient() {
  const [baseUrl, setBaseUrl] = useState(() => readStoredSettings().baseUrl);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<readonly string[]>([]);
  const [status, setStatus] = useState('尚未测试当前 Provider 端点。');
  const [endpoint, setEndpoint] = useState('');
  const [saveStatus, setSaveStatus] = useState('尚未手动保存。');

  function readCurrentFormSettings(): ProviderSettings {
    return {
      baseUrl: readInputValue('provider-base-url').trim(),
    };
  }

  function saveProviderSettings() {
    const current = readCurrentFormSettings();
    const nextSettings = {
      baseUrl: current.baseUrl || defaultSettings.baseUrl,
    };
    setBaseUrl(nextSettings.baseUrl);
    window.localStorage.setItem(storageKey, JSON.stringify(nextSettings));
    setSaveStatus('Provider 设置已保存到当前浏览器。');
  }

  async function testProviderEndpoint() {
    const current = readCurrentFormSettings();
    const nextSettings = {
      baseUrl: current.baseUrl || defaultSettings.baseUrl,
    };
    setBaseUrl(nextSettings.baseUrl);
    window.localStorage.setItem(storageKey, JSON.stringify(nextSettings));
    setSaveStatus('Provider 设置已保存到当前浏览器。');

    if (!nextSettings.baseUrl) {
      setModels([]);
      setEndpoint('');
      setStatus('请先填写 Provider Base URL。');
      return;
    }

    setTesting(true);
    setModels([]);
    setStatus('正在检测 Provider 端点，并尝试拉取模型列表……');
    setEndpoint('');
    try {
      const response = await fetch('/api/provider-models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      const result = (await response.json()) as ModelsResponse;
      setEndpoint(result.endpoint ?? '');
      if (result.ok) {
        setModels(result.models);
        setStatus(`Provider 可连接，发现 ${result.models.length} 个模型。`);
      } else {
        setStatus(result.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '检测失败，请检查网络和 Base URL。');
    } finally {
      setTesting(false);
    }
  }

  return (
    <main
      aria-labelledby="settings-title"
      className="min-h-screen bg-[#1f1f1d] px-6 py-10 text-[#e8decb]"
    >
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-[#aaa39a]">Settings · Provider Gateway</p>
        <h1 id="settings-title" className="mt-3 font-serif text-4xl font-semibold tracking-tight">
          模型与 Provider 设置
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b7afa4]">
          在这里配置兼容 OpenAI 协议的 Provider Base URL。StoryForge 会通过服务端代理访问
          `/v1/models`，检测端点连通性并展示可读取的模型列表。
        </p>

        <section
          aria-labelledby="provider-form-title"
          className="mt-8 rounded-3xl border border-[#3b3a37] bg-[#2b2b29] p-6 shadow-2xl shadow-black/20"
        >
          <h2 id="provider-form-title" className="text-lg font-semibold">
            Provider 连接
          </h2>
          <div className="mt-5 grid gap-5">
            <label className="grid gap-2 text-sm font-medium" htmlFor="provider-base-url">
              Provider Base URL
              <input
                id="provider-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.openai.com"
                className="rounded-2xl border border-[#4a4945] bg-[#1b1b19] px-4 py-3 text-[#f3eadf] outline-none focus:border-[#d8cab8]"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveProviderSettings}
              className="rounded-full border border-[#6a655d] px-5 py-2.5 text-sm font-semibold text-[#f3eadf] hover:border-[#d8cab8]"
            >
              保存设置
            </button>
            <button
              type="button"
              onClick={testProviderEndpoint}
              disabled={testing}
              className="rounded-full bg-[#e8decb] px-5 py-2.5 text-sm font-semibold text-[#1f1f1d] disabled:cursor-wait disabled:opacity-70"
            >
              {testing ? '检测中……' : '检测并拉取模型'}
            </button>
            <span className="text-sm text-[#aaa39a]">{saveStatus}</span>
          </div>
        </section>

        <section
          aria-live="polite"
          aria-labelledby="provider-result-title"
          className="mt-6 rounded-3xl border border-[#3b3a37] bg-[#171715] p-6"
        >
          <h2 id="provider-result-title" className="text-lg font-semibold">
            检测结果
          </h2>
          <p className="mt-3 text-sm text-[#d8cab8]">{status}</p>
          {endpoint ? <p className="mt-2 text-xs text-[#8f887f]">检测端点：{endpoint}</p> : null}
          {models.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-[#f3eadf]">可用模型</h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {models.map((model) => (
                  <li
                    key={model}
                    className="rounded-2xl border border-[#3b3a37] bg-[#242421] px-3 py-2 text-sm text-[#ddd4c8]"
                  >
                    {model}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
