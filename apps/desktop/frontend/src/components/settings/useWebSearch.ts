import { useCallback, useEffect, useRef, useState } from 'react';
import { useMountedRef } from '../../lib/async-guards';
import {
  getWebSearchConfig,
  saveWebSearchConfig,
  type WebSearchConfig,
  type WebSearchProvider,
} from '../../lib/api/web-search';

export function useWebSearch() {
  const alive = useMountedRef();
  const generation = useRef(0);
  const busyRef = useRef(false);
  const [saved, setSaved] = useState<WebSearchConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<WebSearchProvider>('tavily');
  const [apiKey, setApiKey] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const dirty =
    saved !== null &&
    (enabled !== saved.enabled ||
      provider !== saved.provider ||
      (provider === 'tavily' && apiKey.length > 0));
  const apply = useCallback((value: WebSearchConfig) => {
    setSaved(value);
    setEnabled(value.enabled);
    setProvider(value.provider);
    setApiKey('');
    setLoadState('ready');
  }, []);
  const load = useCallback(() => {
    if (busyRef.current) return;
    const token = ++generation.current;
    return getWebSearchConfig().then(
      (value) => {
        if (alive.current && generation.current === token) apply(value);
      },
      () => {
        if (alive.current && generation.current === token) {
          setLoadState('error');
          setNotice({
            error: true,
            text: '联网搜索配置暂不可用，请确认正在使用支持此功能的桌面程序。',
          });
        }
      },
    );
  }, [alive, apply]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const reload = () => {
    if (busyRef.current) return;
    setLoadState('loading');
    setNotice(null);
    return load();
  };
  const persist = async (clear = false) => {
    if (!alive.current || !saved || busyRef.current) return;
    if (provider === 'openai' && enabled && !saved.openaiReady) {
      setNotice({
        error: true,
        text: '请先在模型服务中选择已配置密钥的 OpenAI 兼容模型，再启用搜索。',
      });
      return;
    }
    if (!clear && provider === 'tavily' && enabled && !saved.hasApiKey && !apiKey.trim()) {
      setNotice({ error: true, text: '请先填写自己的 Tavily API Key，再启用联网搜索。' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    generation.current += 1;
    try {
      const value = await saveWebSearchConfig(
        clear
          ? { enabled: false, clearApiKey: true }
          : {
              enabled,
              ...(provider !== saved.provider ? { provider } : {}),
              ...(provider === 'tavily' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            },
      );
      if (!alive.current) return;
      apply(value);
      setNotice({
        error: false,
        text: clear ? '密钥已移除，联网搜索已关闭。' : '联网搜索配置已保存。',
      });
    } catch {
      if (alive.current)
        setNotice({ error: true, text: '联网搜索配置保存失败，草稿仍保留，请重试。' });
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return {
    saved,
    enabled,
    provider,
    apiKey,
    loadState,
    busy,
    dirty,
    notice,
    load: reload,
    setProvider: (value: string) => {
      if (!busyRef.current && (value === 'openai' || value === 'tavily')) {
        setProvider(value);
        setNotice(null);
      }
    },
    setEnabled: (value: boolean) => {
      if (!busyRef.current) {
        setEnabled(value);
        setNotice(null);
      }
    },
    setApiKey: (value: string) => {
      if (!busyRef.current) {
        setApiKey(value);
        setNotice(null);
      }
    },
    save: () => persist(),
    clearKey: () => persist(true),
    reset: () => {
      if (!busyRef.current && saved) {
        apply(saved);
        setNotice(null);
      }
    },
  };
}
export type WebSearchSettings = ReturnType<typeof useWebSearch>;
