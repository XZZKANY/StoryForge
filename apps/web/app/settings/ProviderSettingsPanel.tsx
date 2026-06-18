'use client';

import { useCallback, useRef, useState } from 'react';

const storageKey = 'storyforge-provider-settings';

type ProviderSettings = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
};

type ModelsResponse =
  | { readonly ok: true; readonly models: readonly string[]; readonly endpoint: string }
  | { readonly ok: false; readonly message: string; readonly endpoint?: string };

const defaultSettings: ProviderSettings = {
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: '',
};

function readStoredSettings(): ProviderSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultSettings;
    const value = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      baseUrl:
        typeof value.baseUrl === 'string' && value.baseUrl
          ? value.baseUrl
          : defaultSettings.baseUrl,
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : defaultSettings.apiKey,
      model: typeof value.model === 'string' ? value.model : defaultSettings.model,
    };
  } catch {
    return defaultSettings;
  }
}

function readFormControlValue(id: string): string {
  const element = document.getElementById(id);
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    return element.value;
  }
  return '';
}

export function ProviderSettingsPanel() {
  const initialSettings = useRef<ProviderSettings | null>(null);
  if (initialSettings.current === null) {
    initialSettings.current = readStoredSettings();
  }
  const latestSettings = useRef<ProviderSettings>(initialSettings.current);
  const autoProbeTimer = useRef<number | null>(null);
  const probeRequestId = useRef(0);

  const [baseUrl, setBaseUrl] = useState(
    () => initialSettings.current?.baseUrl ?? defaultSettings.baseUrl,
  );
  const [apiKey, setApiKey] = useState(() => initialSettings.current?.apiKey ?? defaultSettings.apiKey);
  const [model, setModel] = useState(() => initialSettings.current?.model ?? defaultSettings.model);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<readonly string[]>([]);
  const [status, setStatus] = useState('尚未测试当前 Provider 端点。');
  const [endpoint, setEndpoint] = useState('');
  const [saveStatus, setSaveStatus] = useState('尚未手动保存。');

  function readCurrentFormSettings(): ProviderSettings {
    return {
      baseUrl: readFormControlValue('provider-base-url').trim(),
      apiKey: readFormControlValue('provider-api-key').trim(),
      model: readFormControlValue('provider-model').trim(),
    };
  }

  const persistProviderSettings = useCallback((settings: ProviderSettings) => {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  }, []);

  function saveProviderSettings() {
    const current = readCurrentFormSettings();
    const nextSettings = {
      baseUrl: current.baseUrl || defaultSettings.baseUrl,
      apiKey: current.apiKey,
      model: current.model,
    };
    setBaseUrl(nextSettings.baseUrl);
    setApiKey(nextSettings.apiKey);
    setModel(nextSettings.model);
    latestSettings.current = nextSettings;
    persistProviderSettings(nextSettings);
    setSaveStatus('Provider 设置已保存到当前浏览器。');
  }

  const probeProviderEndpoint = useCallback(async (
    mode: 'manual' | 'auto',
    settings: ProviderSettings,
  ) => {
    const requestId = probeRequestId.current + 1;
    probeRequestId.current = requestId;
    const current = {
      baseUrl: settings.baseUrl.trim(),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
    };
    const nextSettings = {
      baseUrl: current.baseUrl || defaultSettings.baseUrl,
      apiKey: current.apiKey,
      model: current.model,
    };
    latestSettings.current = nextSettings;
    setBaseUrl(nextSettings.baseUrl);
    setApiKey(nextSettings.apiKey);
    setModel(nextSettings.model);
    persistProviderSettings(nextSettings);
    setSaveStatus(
      mode === 'auto'
        ? 'Provider 设置已自动保存到当前浏览器。'
        : 'Provider 设置已保存到当前浏览器。',
    );

    if (!nextSettings.baseUrl) {
      setModels([]);
      setEndpoint('');
      setStatus('请先填写 Provider Base URL。');
      return;
    }
    if (!nextSettings.apiKey) {
      setModels([]);
      setEndpoint('');
      setStatus('请先填写 Provider API Key。');
      return;
    }

    setTesting(true);
    setModels([]);
    setStatus(
      mode === 'auto'
        ? '正在根据当前 URL 和 API Key 自动拉取模型列表……'
        : '正在检测 Provider 端点，并尝试拉取模型列表……',
    );
    setEndpoint('');
    try {
      const response = await fetch('/api/provider-models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      const result = (await response.json()) as ModelsResponse;
      if (requestId !== probeRequestId.current) return;
      setEndpoint(result.endpoint ?? '');
      if (result.ok) {
        setModels(result.models);
        const selectedModel = result.models.includes(nextSettings.model)
          ? nextSettings.model
          : (result.models[0] ?? '');
        if (selectedModel !== nextSettings.model) {
          setModel(selectedModel);
          latestSettings.current = { ...nextSettings, model: selectedModel };
          persistProviderSettings(latestSettings.current);
        }
        setStatus(`Provider 可连接，发现 ${result.models.length} 个模型。`);
      } else {
        setStatus(result.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '检测失败，请检查网络和 Base URL。');
    } finally {
      if (requestId === probeRequestId.current) {
        setTesting(false);
      }
    }
  }, [persistProviderSettings]);

  const scheduleAutoProbe = useCallback((settings: ProviderSettings) => {
    if (autoProbeTimer.current !== null) {
      window.clearTimeout(autoProbeTimer.current);
    }

    const currentBaseUrl = settings.baseUrl.trim();
    const currentApiKey = settings.apiKey.trim();
    if (!currentBaseUrl || !currentApiKey) {
      setModels([]);
      setEndpoint('');
      setStatus(
        currentBaseUrl || currentApiKey
          ? '请同时填写 Provider Base URL 和 API Key。'
          : '尚未测试当前 Provider 端点。',
      );
      return;
    }

    autoProbeTimer.current = window.setTimeout(() => {
      void probeProviderEndpoint('auto', latestSettings.current);
    }, 600);
  }, [probeProviderEndpoint]);

  function updateProviderDraft(nextPatch: Partial<ProviderSettings>) {
    const nextSettings = {
      ...latestSettings.current,
      ...nextPatch,
    };
    latestSettings.current = nextSettings;
    scheduleAutoProbe(nextSettings);
  }

  function testProviderEndpoint(mode: 'manual' | 'auto' = 'manual') {
    if (mode === 'manual' && autoProbeTimer.current !== null) {
      window.clearTimeout(autoProbeTimer.current);
      autoProbeTimer.current = null;
    }
    const settings = mode === 'manual' ? readCurrentFormSettings() : latestSettings.current;
    void probeProviderEndpoint(mode, settings);
  }

  return (
    <>
      <section
        aria-labelledby="provider-form-title"
        className="mt-8 rounded-3xl border border-border bg-panel p-6 shadow-2xl shadow-black/20"
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
              onChange={(event) => {
                const nextBaseUrl = event.target.value;
                setBaseUrl(nextBaseUrl);
                updateProviderDraft({ baseUrl: nextBaseUrl });
              }}
              placeholder="https://api.openai.com"
              className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground outline-none focus:border-foreground/50"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="provider-api-key">
            Provider API Key
            <input
              id="provider-api-key"
              value={apiKey}
              onChange={(event) => {
                const nextApiKey = event.target.value;
                setApiKey(nextApiKey);
                updateProviderDraft({ apiKey: nextApiKey });
              }}
              placeholder="sk-..."
              type="password"
              autoComplete="off"
              className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground outline-none focus:border-foreground/50"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="provider-model">
            模型
            <select
              id="provider-model"
              value={model}
              onChange={(event) => {
                const nextModel = event.target.value;
                setModel(nextModel);
                latestSettings.current = {
                  baseUrl: baseUrl.trim() || defaultSettings.baseUrl,
                  apiKey: apiKey.trim(),
                  model: nextModel,
                };
                persistProviderSettings({
                  baseUrl: latestSettings.current.baseUrl,
                  apiKey: latestSettings.current.apiKey,
                  model: nextModel,
                });
                setSaveStatus('模型选择已保存到当前浏览器。');
              }}
              className="rounded-2xl border border-border bg-background px-4 py-3 text-foreground outline-none focus:border-foreground/50"
            >
              <option value="">输入 URL 和 API Key 后自动加载模型</option>
              {models.map((availableModel) => (
                <option key={availableModel} value={availableModel}>
                  {availableModel}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveProviderSettings}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:border-foreground/50"
          >
            保存设置
          </button>
          <button
            type="button"
            onClick={() => void testProviderEndpoint('manual')}
            disabled={testing}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:cursor-wait disabled:opacity-70"
          >
            {testing ? '检测中……' : '检测并拉取模型'}
          </button>
          <span className="text-sm text-muted">{saveStatus}</span>
        </div>
      </section>

      <section
        aria-live="polite"
        aria-labelledby="provider-result-title"
        className="mt-6 rounded-3xl border border-border bg-panel p-6"
      >
        <h2 id="provider-result-title" className="text-lg font-semibold">
          检测结果
        </h2>
        <p className="mt-3 text-sm text-muted">{status}</p>
        {endpoint ? <p className="mt-2 text-xs text-muted/70">检测端点：{endpoint}</p> : null}
        {models.length > 0 ? (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-foreground">可用模型</h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {models.map((model) => (
                <li
                  key={model}
                  className="rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {model}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}
