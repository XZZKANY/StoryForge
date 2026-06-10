'use client';

import { useState } from 'react';

const creativePreferencesStorageKey = 'storyforge-creative-preferences';

type CreativePreferences = {
  readonly genres: readonly string[];
  readonly style: string;
  readonly assistantBehavior: string;
  readonly defaultFlow: readonly string[];
};

const defaultPreferences: CreativePreferences = {
  genres: [],
  style: '',
  assistantBehavior: '',
  defaultFlow: [
    'Goal.analyze',
    'Blueprint.create',
    'Chapter.generate',
    'Judge.review',
    'Repair.suggest',
  ],
};

function readStoredPreferences(): CreativePreferences {
  try {
    const raw = window.localStorage.getItem(creativePreferencesStorageKey);
    if (!raw) return defaultPreferences;
    const value = JSON.parse(raw) as Partial<CreativePreferences>;
    return {
      genres: Array.isArray(value.genres)
        ? value.genres.filter((item) => typeof item === 'string')
        : defaultPreferences.genres,
      style:
        typeof value.style === 'string' && value.style ? value.style : defaultPreferences.style,
      assistantBehavior:
        typeof value.assistantBehavior === 'string' && value.assistantBehavior
          ? value.assistantBehavior
          : defaultPreferences.assistantBehavior,
      defaultFlow: Array.isArray(value.defaultFlow)
        ? value.defaultFlow.filter((item) => typeof item === 'string')
        : defaultPreferences.defaultFlow,
    };
  } catch {
    return defaultPreferences;
  }
}

export function CreativePreferencesPanel({
  title = 'Customize 创作偏好',
}: {
  readonly title?: string;
}) {
  const [preferences, setPreferences] = useState(readStoredPreferences);
  const [status, setStatus] = useState('尚未保存创作偏好。');

  function updateField<K extends keyof CreativePreferences>(key: K, value: CreativePreferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function savePreferences() {
    window.localStorage.setItem(creativePreferencesStorageKey, JSON.stringify(preferences));
    setStatus('创作偏好已保存到当前浏览器。');
  }

  return (
    <section
      aria-labelledby="creative-preferences-title"
      className="mt-8 border-t border-border pt-6"
    >
      <h2 id="creative-preferences-title" className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-5 grid gap-5">
        <label className="grid gap-2 text-sm font-medium" htmlFor="creative-genres">
          默认题材
          <input
            id="creative-genres"
            value={preferences.genres.join('，')}
            onChange={(event) =>
              updateField(
                'genres',
                event.target.value
                  .split(/[，,]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            placeholder="尚未设置"
            className="border-b border-border bg-transparent px-0 py-3 text-foreground outline-none placeholder:text-muted focus:border-foreground/50"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="creative-style">
          默认文风
          <input
            id="creative-style"
            value={preferences.style}
            onChange={(event) => updateField('style', event.target.value)}
            placeholder="尚未设置"
            className="border-b border-border bg-transparent px-0 py-3 text-foreground outline-none placeholder:text-muted focus:border-foreground/50"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="creative-assistant-behavior">
          Assistant 行为
          <textarea
            id="creative-assistant-behavior"
            value={preferences.assistantBehavior}
            onChange={(event) => updateField('assistantBehavior', event.target.value)}
            rows={3}
            placeholder="尚未设置"
            className="border-b border-border bg-transparent px-0 py-3 text-foreground outline-none placeholder:text-muted focus:border-foreground/50"
          />
        </label>
        <fieldset className="border-t border-border pt-4">
          <legend className="text-sm font-medium">默认流程</legend>
          <div className="mt-3 grid gap-2 text-sm text-foreground">
            {defaultPreferences.defaultFlow.map((step) => (
              <label key={step} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={preferences.defaultFlow.includes(step)}
                  onChange={(event) => {
                    updateField(
                      'defaultFlow',
                      event.target.checked
                        ? [...preferences.defaultFlow, step]
                        : preferences.defaultFlow.filter((item) => item !== step),
                    );
                  }}
                />
                {step}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={savePreferences}
          className="bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
        >
          保存创作偏好
        </button>
        <span className="text-sm text-muted">{status}</span>
      </div>
    </section>
  );
}
