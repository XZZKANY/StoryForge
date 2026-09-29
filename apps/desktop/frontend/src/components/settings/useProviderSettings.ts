import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { probeProviderHealth } from '../../lib/api-client';
import {
  getDesktopLlmConfig,
  saveDesktopLlmConfig,
  type DesktopLlmConfig,
  type DesktopLlmSlotConfig,
} from '../../lib/desktop-llm-config';
import {
  describeProviderHealth,
  isProviderKind,
  type ProviderHealth,
} from '../../lib/provider-config';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../lib/user-settings';

export type ProbeState = 'idle' | 'loading' | ProviderHealth;
type SaveState = 'idle' | 'loading' | 'saved' | 'error';
type Slot = 'provider' | 'polishProvider';
type WriteOperation = Slot | 'detect';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const scopeKey = (provider: AppSettings['provider'], secret: string) =>
  JSON.stringify([provider.kind, provider.baseUrl, provider.model, secret]);
// 磁盘基线键与 scopeKey 同构（secret 恒为 ''，本机从不回读密钥明文）；kind 归一与
// loadConfig 的 merge 一致，保证「读取完成 ≠ 未保存」。
const storedKey = (slot: Slot, value: DesktopLlmSlotConfig) =>
  scopeKey(
    {
      kind: isProviderKind(value.provider) ? value.provider : DEFAULT_APP_SETTINGS[slot].kind,
      baseUrl: value.baseUrl.trim(),
      model: value.model.trim(),
      apiKeyRef: '',
    },
    '',
  );

// These requests share one on-disk document. Keep UI delivery scoped, but never
// release the write claim merely because the author edits a field while awaiting it.
export function useProviderSettings(settings: AppSettings, onChange: (next: AppSettings) => void) {
  const latestRef = useRef({ settings, onChange });
  const aliveRef = useRef(true);
  const secretsRef = useRef({ provider: '', polishProvider: '' });
  const [secretInput, setMainSecret] = useState('');
  const [polishSecretInput, setPolishSecret] = useState('');
  const [storedConfig, setStoredConfig] = useState<DesktopLlmConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [polishSaveState, setPolishSaveState] = useState<SaveState>('idle');
  const [polishSaveError, setPolishSaveError] = useState('');
  const [probe, setProbe] = useState<ProbeState>('idle');
  const [detectState, setDetectState] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectError, setDetectError] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [writeOperation, setWriteOperation] = useState<WriteOperation | null>(null);
  // 每槽位「最近一次落盘时的 scopeKey」；null = 尚未成功读取磁盘，不据此报未保存。
  const [baseline, setBaseline] = useState<{
    provider: string | null;
    polishProvider: string | null;
  }>({ provider: null, polishProvider: null });
  const writeRef = useRef<symbol | null>(null);
  const readRef = useRef(0);
  const probeRef = useRef(0);
  const dirtyRef = useRef({ provider: false, polishProvider: false });
  const scopesRef = useRef({
    provider: scopeKey(settings.provider, ''),
    polishProvider: `${scopeKey(settings.provider, '')}:${scopeKey(settings.polishProvider, '')}`,
  });
  const epochsRef = useRef({ provider: 0, polishProvider: 0 });

  const syncScopes = useCallback((next: AppSettings) => {
    const main = scopeKey(next.provider, secretsRef.current.provider);
    const polish = `${scopeKey(next.provider, '')}:${scopeKey(next.polishProvider, secretsRef.current.polishProvider)}`;
    if (scopesRef.current.provider !== main) {
      scopesRef.current.provider = main;
      epochsRef.current.provider += 1;
      probeRef.current += 1;
      setProbe('idle');
      setDetectState('idle');
      setDetectedModels([]);
      setDetectError('');
      setSaveState('idle');
      setSaveError('');
    }
    if (scopesRef.current.polishProvider !== polish) {
      scopesRef.current.polishProvider = polish;
      epochsRef.current.polishProvider += 1;
      setPolishSaveState('idle');
      setPolishSaveError('');
    }
  }, []);

  useLayoutEffect(() => {
    // Also protect externally changed props, not just this dialog's event handlers.
    for (const slot of ['provider', 'polishProvider'] as const) {
      if (scopeKey(latestRef.current.settings[slot], '') !== scopeKey(settings[slot], ''))
        dirtyRef.current[slot] = true;
    }
    latestRef.current = { settings, onChange };
    syncScopes(settings);
  }, [settings, onChange, syncScopes]);

  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      readRef.current += 1;
      probeRef.current += 1;
      writeRef.current = null;
    };
  }, []);

  const commit = useCallback(
    (next: AppSettings) => {
      latestRef.current.settings = next;
      syncScopes(next);
      latestRef.current.onChange(next);
    },
    [syncScopes],
  );
  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    if (key === 'provider') dirtyRef.current.provider = true;
    if (key === 'polishProvider') dirtyRef.current.polishProvider = true;
    commit({ ...latestRef.current.settings, [key]: value });
  };
  const resetSettings = () => {
    dirtyRef.current = { provider: true, polishProvider: true };
    commit(DEFAULT_APP_SETTINGS);
  };
  const setSecret = (slot: Slot, value: string) => {
    dirtyRef.current[slot] = true;
    secretsRef.current[slot] = value;
    (slot === 'provider' ? setMainSecret : setPolishSecret)(value);
    syncScopes(latestRef.current.settings);
  };

  const loadConfig = useCallback(() => {
    if (writeRef.current) return;
    const request = ++readRef.current;
    return getDesktopLlmConfig()
      .then((config) => {
        if (!aliveRef.current || readRef.current !== request) return;
        setStoredConfig(config);
        if (config) {
          const latest = latestRef.current.settings;
          const merge = (slot: Slot, value: DesktopLlmConfig | DesktopLlmConfig['polish']) => {
            if (!value || dirtyRef.current[slot]) return latest[slot];
            return {
              ...latest[slot],
              kind: isProviderKind(value.provider)
                ? value.provider
                : DEFAULT_APP_SETTINGS[slot].kind,
              baseUrl: value.baseUrl || latest[slot].baseUrl,
              model: value.model || latest[slot].model,
              apiKeyRef: value.hasApiKey
                ? `stored://storyforge/llm-provider${slot === 'polishProvider' ? '/polish' : ''}`
                : '',
            };
          };
          const mergedProvider = merge('provider', config);
          const mergedPolish = merge('polishProvider', config.polish);
          commit({ ...latest, provider: mergedProvider, polishProvider: mergedPolish });
          // 未保存基线 = 磁盘现状：未编辑槽位取 merge 结果（保证读取完成即无未保存）；
          // 已编辑槽位取磁盘原值，草稿偏离原值即报未保存；磁盘缺失 polish 槽位时无法
          // 对比，按当前值收口不误报。
          setBaseline({
            provider: dirtyRef.current.provider
              ? storedKey('provider', config)
              : scopeKey(mergedProvider, ''),
            polishProvider:
              config.polish !== null && dirtyRef.current.polishProvider
                ? storedKey('polishProvider', config.polish)
                : scopeKey(mergedPolish, ''),
          });
        }
        setLoadState('idle');
      })
      .catch((error) => {
        if (!aliveRef.current || readRef.current !== request) return;
        setLoadState('error');
        setLoadError(message(error));
      });
  }, [commit]);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);
  useEffect(() => {
    if (polishSaveState !== 'saved') return;
    const timer = window.setTimeout(() => setPolishSaveState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [polishSaveState]);

  const runProbe = async () => {
    if (writeRef.current || probe === 'loading') return;
    const request = ++probeRef.current;
    setProbe('loading');
    try {
      const result = await probeProviderHealth();
      if (aliveRef.current && probeRef.current === request) setProbe(result);
    } catch (error) {
      if (!aliveRef.current || probeRef.current !== request) return;
      setProbe({
        status: 'unreachable',
        reachable: false,
        baseUrl: null,
        model: null,
        latencyMs: null,
        modelCount: null,
        models: [],
        detail: message(error),
        missingEnv: [],
      });
    }
  };

  const writeConfig = async (operation: WriteOperation, clearApiKey = false) => {
    if (writeRef.current) return;
    const claim = Symbol('config-write');
    writeRef.current = claim;
    const slot = operation === 'polishProvider' ? 'polishProvider' : 'provider';
    const epoch = epochsRef.current[slot];
    const current = () =>
      aliveRef.current && writeRef.current === claim && epochsRef.current[slot] === epoch;
    const setState = slot === 'provider' ? setSaveState : setPolishSaveState;
    const setError = slot === 'provider' ? setSaveError : setPolishSaveError;
    const snapshot = latestRef.current.settings;
    const selected = snapshot[slot];
    const secret = secretsRef.current[slot];
    // Starting a mutation supersedes an earlier read and health result, even if
    // the author has not edited metadata. It does not cancel any native write.
    readRef.current += 1;
    probeRef.current += 1;
    setWriteOperation(operation);
    setLoadState('idle');
    setLoadError('');
    setProbe('idle');
    if (operation === 'detect') {
      setDetectState('loading');
      setDetectError('');
    } else {
      setState('loading');
      setError('');
    }
    try {
      const credentials = clearApiKey ? { clearApiKey: true } : { apiKey: secret };
      const next = await saveDesktopLlmConfig({
        provider: snapshot.provider.kind,
        baseUrl: snapshot.provider.baseUrl,
        model: snapshot.provider.model,
        ...(slot === 'provider'
          ? credentials
          : {
              polish: {
                provider: selected.kind,
                baseUrl: selected.baseUrl,
                model: selected.model,
                ...credentials,
              },
            }),
      });
      if (!current()) return;
      if (next) setStoredConfig(next);
      if (operation === 'detect') {
        const health = await probeProviderHealth();
        if (!current()) return;
        setDetectedModels(health.models);
        if (health.status === 'ok' && health.models.length > 0) setDetectState('ok');
        else {
          setDetectState('error');
          setDetectError(describeProviderHealth(health).label);
        }
      } else {
        if (next) {
          const latest = latestRef.current.settings;
          const saved = slot === 'provider' ? next : next.polish;
          // 落盘成功即刷新该槽位基线：表单与磁盘重新一致，「未保存」徽标随之消失。
          if (saved) setBaseline((prev) => ({ ...prev, [slot]: storedKey(slot, saved) }));
          commit({
            ...latest,
            [slot]: {
              ...latest[slot],
              apiKeyRef: saved?.hasApiKey
                ? `stored://storyforge/llm-provider${slot === 'polishProvider' ? '/polish' : ''}`
                : '',
            },
          });
          // Reset only the secret submitted by this still-current request. The
          // scope invalidation happens before publishing its success feedback.
          setSecret(slot, '');
        }
        setState('saved');
      }
    } catch (error) {
      if (!current()) return;
      if (operation === 'detect') {
        setDetectState('error');
        setDetectError(message(error));
      } else {
        setState('error');
        setError(message(error));
      }
    } finally {
      if (aliveRef.current && writeRef.current === claim) {
        writeRef.current = null;
        setWriteOperation(null);
      }
    }
  };

  // 未保存判定：当前表单（含密钥输入草稿）与最近一次落盘基线不一致；基线为 null
  // （读取失败或尚未读完）时不报未保存、不拦关窗，无法判断就不误报。
  const unsavedSlots = {
    provider:
      baseline.provider !== null && scopeKey(settings.provider, secretInput) !== baseline.provider,
    polishProvider:
      baseline.polishProvider !== null &&
      scopeKey(settings.polishProvider, polishSecretInput) !== baseline.polishProvider,
  };

  return {
    update,
    resetSettings,
    secretInput,
    polishSecretInput,
    storedConfig,
    saveState,
    saveError,
    polishSaveState,
    polishSaveError,
    probe,
    detectState,
    detectedModels,
    detectError,
    loadState,
    loadError,
    writeOperation,
    unsavedSlots,
    loadConfig: () => {
      if (writeRef.current) return;
      setLoadState('loading');
      setLoadError('');
      return loadConfig();
    },
    runProbe,
    setSecretInput: (value: string) => setSecret('provider', value),
    setPolishSecretInput: (value: string) => setSecret('polishProvider', value),
    detectModels: () => writeConfig('detect'),
    saveProviderConfig: () => writeConfig('provider'),
    clearProviderSecret: () => writeConfig('provider', true),
    savePolishProviderConfig: () => writeConfig('polishProvider'),
    clearPolishProviderSecret: () => writeConfig('polishProvider', true),
  };
}
