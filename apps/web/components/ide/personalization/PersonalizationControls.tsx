'use client';

import type { FormEvent } from 'react';

import type { IdePersonalizationPreferences } from './preferences';
import { mergeIdePreferences, preferencesChangedEvent, saveIdePreferences } from './preferences';

export type PersonalizationControlsProps = {
  readonly preferences: IdePersonalizationPreferences;
};

export function PersonalizationControls({ preferences }: PersonalizationControlsProps) {
  const persistPreferences = (nextPreferences: IdePersonalizationPreferences) => {
    saveIdePreferences(window.localStorage, nextPreferences);
    window.dispatchEvent(new Event(preferencesChangedEvent));
  };

  const saveCustomKeybinding = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const commandId = String(formData.get('commandId') || '').trim();
    const shortcut = String(formData.get('shortcut') || '').trim();
    if (!commandId || !shortcut) return;
    persistPreferences(
      mergeIdePreferences(preferences, { keybindings: { [commandId]: shortcut } }),
    );
  };

  return (
    <div data-testid="ide-personalization-controls" className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-stone-700 px-2 py-1 text-stone-100"
          onClick={() => persistPreferences(mergeIdePreferences(preferences, { theme: 'light' }))}
        >
          保存浅色主题
        </button>
        <button
          type="button"
          className="rounded border border-stone-700 px-2 py-1 text-stone-100"
          onClick={() =>
            persistPreferences(
              mergeIdePreferences(preferences, {
                layout: { leftPanelWidth: 360, bottomPanelHeight: 320, rightDockWidth: 400 },
              }),
            )
          }
        >
          保存宽布局
        </button>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={saveCustomKeybinding}>
        <label className="grid gap-1 text-stone-300">
          <span>命令 ID</span>
          <input
            name="commandId"
            defaultValue="judge.run"
            className="w-36 rounded border border-stone-700 bg-stone-950 px-2 py-1 text-stone-100"
          />
        </label>
        <label className="grid gap-1 text-stone-300">
          <span>快捷键</span>
          <input
            name="shortcut"
            defaultValue="Alt+J"
            className="w-28 rounded border border-stone-700 bg-stone-950 px-2 py-1 text-stone-100"
          />
        </label>
        <button type="submit" className="rounded border border-stone-700 px-2 py-1 text-stone-100">
          保存自定义键位
        </button>
      </form>
    </div>
  );
}
