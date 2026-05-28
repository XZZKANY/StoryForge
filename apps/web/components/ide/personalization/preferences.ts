import type { IdeUrlState } from '../url/ide-url-state';
import { serializeIdeUrlState } from '../url/ide-url-state';

export type IdeTheme = 'light' | 'dark';

export type IdeLayoutPreferences = {
  readonly leftPanelWidth: number;
  readonly bottomPanelHeight: number;
  readonly rightDockWidth: number;
};

export type IdePersonalizationPreferences = {
  readonly theme: IdeTheme;
  readonly layout: IdeLayoutPreferences;
  readonly keybindings: Readonly<Record<string, string>>;
};

export const defaultIdePreferences: IdePersonalizationPreferences = {
  theme: 'dark',
  layout: {
    leftPanelWidth: 256,
    bottomPanelHeight: 280,
    rightDockWidth: 224,
  },
  keybindings: {},
};

type PreferencePatch = Partial<{
  readonly theme: unknown;
  readonly layout: Partial<Record<keyof IdeLayoutPreferences, unknown>>;
  readonly keybindings: Record<string, unknown>;
}>;

function isTheme(value: unknown): value is IdeTheme {
  return value === 'light' || value === 'dark';
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseKeybindings(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].trim().length > 0,
  );
  return Object.fromEntries(entries);
}

function normalizePreferences(value: PreferencePatch): IdePersonalizationPreferences {
  const layout = value.layout && typeof value.layout === 'object' ? value.layout : {};
  return {
    theme: isTheme(value.theme) ? value.theme : defaultIdePreferences.theme,
    layout: {
      leftPanelWidth: positiveNumber(
        layout.leftPanelWidth,
        defaultIdePreferences.layout.leftPanelWidth,
      ),
      bottomPanelHeight: positiveNumber(
        layout.bottomPanelHeight,
        defaultIdePreferences.layout.bottomPanelHeight,
      ),
      rightDockWidth: positiveNumber(
        layout.rightDockWidth,
        defaultIdePreferences.layout.rightDockWidth,
      ),
    },
    keybindings: parseKeybindings(value.keybindings),
  };
}

export function parseIdePreferences(raw: string | null | undefined): IdePersonalizationPreferences {
  if (!raw) return defaultIdePreferences;
  try {
    const parsed = JSON.parse(raw) as PreferencePatch;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return defaultIdePreferences;
    return normalizePreferences(parsed);
  } catch {
    return defaultIdePreferences;
  }
}

export function mergeIdePreferences(
  current: IdePersonalizationPreferences,
  patch: Partial<{
    readonly theme: IdeTheme;
    readonly layout: Partial<IdeLayoutPreferences>;
    readonly keybindings: Readonly<Record<string, string>>;
  }>,
): IdePersonalizationPreferences {
  return normalizePreferences({
    theme: patch.theme ?? current.theme,
    layout: { ...current.layout, ...patch.layout },
    keybindings: { ...current.keybindings, ...patch.keybindings },
  });
}

export function serializeIdePreferences(preferences: IdePersonalizationPreferences): string {
  return JSON.stringify(preferences);
}

export function createEditorPopoutUrl(state: IdeUrlState): string {
  const query = serializeIdeUrlState(state);
  return `/ide?${query}&window=editor`;
}
