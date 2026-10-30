import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { probeProviderHealth } from '../../lib/api-client';
import {
  activateLlmProfile,
  deleteLlmProfile,
  listLlmProfiles,
  LlmProbeError,
  probeLlmDraft,
  saveLlmProfile,
  setPolishLlmProfile,
  type LlmDraftModels,
  type LlmProfile,
  type LlmProfiles,
} from '../../lib/desktop-llm-config';
import {
  getProviderPreset,
  profileTitle,
  providerKindOr,
  type ProviderHealth,
  type ProviderKind,
} from '../../lib/provider-config';

export type ProfileHealth = 'loading' | ProviderHealth;

export type ProfileDraft = {
  /** null = 新建一套。 */
  id: string | null;
  name: string;
  kind: ProviderKind | null;
  baseUrl: string;
  /** 这套正在用的模型；保存时若已不在勾选里，换成勾选的第一个。 */
  model: string;
  /** 勾上要出现在对话下拉里的模型。 */
  models: string[];
  /** 只在本次编辑里暂存，保存后清空；编辑已存的那套时留空 = 沿用。 */
  apiKey: string;
  /** 预设服务商的地址默认折叠，点「改地址」或地址与预设不同时才展开。 */
  editAddress: boolean;
  hasStoredKey: boolean;
};

export type ModelFetch =
  | { state: 'idle' }
  | { state: 'loading' }
  | ({ state: 'ok' } & LlmDraftModels)
  | { state: 'error'; message: string };

type Busy = 'save' | 'activate' | 'delete' | 'clear-key' | 'polish';
export type ProfilesNotice = { tone: 'ok' | 'error'; text: string } | null;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const draftScope = (draft: ProfileDraft) =>
  JSON.stringify([draft.name, draft.kind, draft.baseUrl, draft.models, draft.apiKey]);
const fetchScope = (draft: ProfileDraft) =>
  JSON.stringify([draft.id, draft.kind, draft.baseUrl.trim(), draft.apiKey.trim()]);

function listedHealth(profile: LlmProfile, listed: LlmDraftModels, latencyMs: number) {
  const health: ProviderHealth = {
    status: 'ok',
    reachable: true,
    baseUrl: profile.baseUrl,
    model: profile.model || null,
    latencyMs,
    modelCount: listed.models.length,
    models: listed.models,
    detail: listed.partial ? '仅显示本次探测返回的部分模型' : null,
    missingEnv: [],
  };
  return health;
}

function failedHealth(profile: LlmProfile, error: unknown) {
  const status = error instanceof LlmProbeError ? error.kind : 'unreachable';
  const health: ProviderHealth = {
    status,
    reachable: status === 'unauthorized',
    baseUrl: profile.baseUrl,
    model: profile.model || null,
    latencyMs: null,
    modelCount: null,
    models: [],
    detail: message(error),
    missingEnv: [],
  };
  return health;
}

/** 设置页「模型服务」：多套配置的列表、切换、增删改与草稿探测。写操作一次只走一件。 */
export function useModelProfiles() {
  const aliveRef = useRef(true);
  const busyRef = useRef<Busy | null>(null);
  const readRef = useRef(0);
  const fetchRef = useRef(0);
  const draftRef = useRef<ProfileDraft | null>(null);
  const [list, setList] = useState<LlmProfiles | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<ProfilesNotice>(null);
  const [health, setHealth] = useState<Record<string, ProfileHealth>>({});
  const [draft, setDraftState] = useState<ProfileDraft | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [fetched, setFetched] = useState<ModelFetch>({ state: 'idle' });
  const [saveError, setSaveError] = useState('');

  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      readRef.current += 1;
      fetchRef.current += 1;
    };
  }, []);

  const setDraft = (next: ProfileDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  };

  const load = useCallback(() => {
    if (busyRef.current) return;
    const request = ++readRef.current;
    const current = () => aliveRef.current && readRef.current === request;
    return listLlmProfiles().then(
      (next) => {
        if (!current()) return;
        setList(next);
        setLoadState('idle');
        setLoadError('');
      },
      (error: unknown) => {
        if (!current()) return;
        setLoadState('error');
        setLoadError(message(error));
      },
    );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 宿主那边是同一份文件：一次只放行一个写操作，写操作开始后更早发出的读取结果作废。
  const claim = (kind: Busy) => {
    if (busyRef.current) return false;
    busyRef.current = kind;
    setBusy(kind);
    readRef.current += 1;
    setNotice(null);
    return true;
  };
  const release = () => {
    busyRef.current = null;
    if (aliveRef.current) setBusy(null);
  };
  const apply = (next: LlmProfiles | null) => {
    if (!next) return;
    setList(next);
    setLoadState('idle');
    setLoadError('');
  };
  const forget = (id: string) =>
    setHealth((previous) => {
      const rest = { ...previous };
      delete rest[id];
      return rest;
    });
  const titleOf = (profiles: LlmProfiles | null, id: string | null) => {
    const profile = profiles?.profiles.find((item) => item.id === id);
    return profile ? profileTitle(profile) : '';
  };

  const openDraft = (next: ProfileDraft | null) => {
    fetchRef.current += 1;
    setDraft(next);
    setBaseline(next ? draftScope(next) : null);
    setFetched({ state: 'idle' });
    setSaveError('');
  };

  const activate = async (id: string) => {
    if (!list || list.activeProfileId === id || !claim('activate')) return;
    try {
      const next = await activateLlmProfile(id);
      if (!aliveRef.current) return;
      apply(next);
      setNotice({ tone: 'ok', text: `已切到「${titleOf(next ?? list, id)}」，下一次调用生效` });
    } catch (error) {
      if (aliveRef.current) setNotice({ tone: 'error', text: `切换失败：${message(error)}` });
    } finally {
      release();
    }
  };

  const remove = async (profile: LlmProfile) => {
    if (!claim('delete')) return;
    try {
      const next = await deleteLlmProfile(profile.id);
      if (!aliveRef.current) return;
      apply(next);
      forget(profile.id);
      if (draftRef.current?.id === profile.id) openDraft(null);
      setNotice({ tone: 'ok', text: `已删除「${profileTitle(profile)}」` });
    } catch (error) {
      if (aliveRef.current) setNotice({ tone: 'error', text: `删除失败：${message(error)}` });
    } finally {
      release();
    }
  };

  const clearKey = async (profile: LlmProfile) => {
    if (!claim('clear-key')) return;
    try {
      const { id, name, provider, baseUrl, model } = profile;
      const next = await saveLlmProfile({ id, name, provider, baseUrl, model, clearApiKey: true });
      if (!aliveRef.current) return;
      apply(next);
      forget(id);
      const current = draftRef.current;
      if (current?.id === id) setDraft({ ...current, hasStoredKey: false });
      setNotice({ tone: 'ok', text: `已移除「${profileTitle(profile)}」的 Key` });
    } catch (error) {
      if (aliveRef.current) setNotice({ tone: 'error', text: `移除失败：${message(error)}` });
    } finally {
      release();
    }
  };

  const setPolish = async (id: string | null) => {
    if (!claim('polish')) return;
    try {
      const next = await setPolishLlmProfile(id);
      if (!aliveRef.current) return;
      apply(next);
      setNotice({
        tone: 'ok',
        text: id ? `整章润色改用「${titleOf(next ?? list, id)}」` : '整章润色跟随当前模型',
      });
    } catch (error) {
      if (aliveRef.current) setNotice({ tone: 'error', text: `设置失败：${message(error)}` });
    } finally {
      release();
    }
  };

  const startNew = () =>
    openDraft({
      id: null,
      name: '',
      kind: null,
      baseUrl: '',
      model: '',
      models: [],
      apiKey: '',
      editAddress: false,
      hasStoredKey: false,
    });

  const startEdit = (profile: LlmProfile) => {
    const kind = providerKindOr(profile.provider, 'openai-compatible');
    const preset = getProviderPreset(kind).baseUrl;
    openDraft({
      id: profile.id,
      name: profile.name,
      kind,
      baseUrl: profile.baseUrl,
      model: profile.model,
      models: profile.models,
      apiKey: '',
      editAddress: !preset || preset !== profile.baseUrl.trim(),
      hasStoredKey: profile.hasApiKey,
    });
  };

  const updateDraft = (patch: Partial<ProfileDraft>) => {
    const current = draftRef.current;
    if (!current || busyRef.current === 'save') return;
    let next = { ...current, ...patch };
    if (patch.kind && patch.kind !== current.kind) {
      // 换服务商：地址换成预设，模型名多半不通用，清掉让作者重选。
      const preset = getProviderPreset(patch.kind).baseUrl;
      next = { ...next, baseUrl: preset, editAddress: !preset, model: '', models: [] };
    }
    if (fetchScope(next) !== fetchScope(current)) {
      fetchRef.current += 1;
      setFetched({ state: 'idle' });
    }
    setSaveError('');
    setDraft(next);
  };

  const fetchModels = async () => {
    const current = draftRef.current;
    if (!current?.kind) return;
    const request = ++fetchRef.current;
    setFetched({ state: 'loading' });
    try {
      const listed = await probeLlmDraft({
        provider: current.kind,
        baseUrl: current.baseUrl.trim(),
        apiKey: current.apiKey.trim() || undefined,
        profileId: current.id ?? undefined,
      });
      if (aliveRef.current && fetchRef.current === request) setFetched({ state: 'ok', ...listed });
    } catch (error) {
      if (aliveRef.current && fetchRef.current === request)
        setFetched({ state: 'error', message: message(error) });
    }
  };

  // 保存后自动测一次：当前那套走引擎的真实出网链路，其余用它已存的 Key 拉一次模型列表。
  const testProfile = async (profile: LlmProfile, active: boolean) => {
    setHealth((previous) => ({ ...previous, [profile.id]: 'loading' }));
    const startedAt = performance.now();
    let result: ProviderHealth;
    try {
      result = active
        ? await probeProviderHealth()
        : listedHealth(
            profile,
            await probeLlmDraft({
              provider: profile.provider,
              baseUrl: profile.baseUrl,
              profileId: profile.id,
            }),
            Math.round(performance.now() - startedAt),
          );
    } catch (error) {
      result = failedHealth(profile, error);
    }
    if (aliveRef.current) setHealth((previous) => ({ ...previous, [profile.id]: result }));
  };

  const saveDraft = async () => {
    const current = draftRef.current;
    if (!current) return;
    const problem = !current.kind
      ? '先选服务商'
      : !current.baseUrl.trim()
        ? '先填服务地址'
        : !current.models.length
          ? '先勾选或填一个模型'
          : '';
    if (problem) {
      setSaveError(problem);
      return;
    }
    if (!claim('save')) return;
    setSaveError('');
    try {
      const saved = await saveLlmProfile({
        id: current.id ?? undefined,
        name: current.name.trim(),
        provider: current.kind ?? 'openai-compatible',
        baseUrl: current.baseUrl.trim(),
        model: current.models.includes(current.model) ? current.model : current.models[0],
        models: current.models,
        apiKey: current.apiKey,
      });
      if (!aliveRef.current) return;
      apply(saved);
      openDraft(null);
      const profile = saved?.profiles.find((item) => item.id === saved.savedProfileId);
      if (saved && profile) await testProfile(profile, saved.activeProfileId === profile.id);
    } catch (error) {
      if (aliveRef.current) setSaveError(`保存失败：${message(error)}`);
    } finally {
      release();
    }
  };

  return {
    list,
    loadState,
    loadError,
    busy,
    notice,
    health,
    draft,
    draftDirty: draft !== null && baseline !== null && draftScope(draft) !== baseline,
    fetched,
    saveError,
    reload: () => {
      if (busyRef.current) return;
      setLoadState('loading');
      setLoadError('');
      return load();
    },
    activate,
    remove,
    clearKey,
    setPolish,
    startNew,
    startEdit,
    cancelEdit: () => openDraft(null),
    updateDraft,
    fetchModels,
    saveDraft,
  };
}

export type ModelProfilesState = ReturnType<typeof useModelProfiles>;
