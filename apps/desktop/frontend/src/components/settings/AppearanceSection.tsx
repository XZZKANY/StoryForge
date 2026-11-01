import { useState, type KeyboardEvent } from 'react';

import { Button, Input, PlainButton } from '../ui';
import {
  ACCENT_CHOICES,
  baseColors,
  baseContrast,
  derivePalette,
  MIN_TEXT_CONTRAST,
  normalizeHex,
  PALETTE_PRESETS,
  resolveThemeMode,
  UI_FONTS,
  type AccentChoice,
  type AppearanceSettings,
  type Palette,
  type PalettePreset,
  type ThemeMode,
  type ThemePreference,
  type TokenName,
  type UiFont,
} from '../../lib/appearance';
import { useSystemPrefersDark } from '../app/useSystemPrefersDark';
import { RowShell, SelectRow } from './SettingRows';

type AppearanceUpdate = <Key extends keyof AppearanceSettings>(
  key: Key,
  value: AppearanceSettings[Key],
) => void;

const MODE_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
const MODE_LABEL: Record<ThemeMode, string> = { dark: '深色', light: '浅色' };
const PALETTE_OPTIONS = (Object.keys(PALETTE_PRESETS) as PalettePreset[]).map((value) => ({
  value,
  label: PALETTE_PRESETS[value].label,
}));
const ACCENT_KEYS = Object.keys(ACCENT_CHOICES) as AccentChoice[];
const FONT_OPTIONS = (Object.keys(UI_FONTS) as UiFont[]).map((value) => ({
  value,
  label: UI_FONTS[value].label,
}));

/** 设置 → 外观：返回一组行（不包外层），以便搜索把行全滤掉时卡片能按 :empty 收起。 */
export function AppearanceSection({
  settings,
  onChange,
}: {
  settings: AppearanceSettings;
  onChange: AppearanceUpdate;
}) {
  const prefersDark = useSystemPrefersDark();
  const mode = resolveThemeMode(settings.theme, prefersDark);
  const base = baseColors(mode, settings);
  const custom = settings.customColors[mode];
  const contrast = baseContrast(mode, settings);
  const setCustom = (field: 'background' | 'foreground', value: string | null) =>
    onChange('customColors', { ...settings.customColors, [mode]: { ...custom, [field]: value } });

  return (
    <>
      <RowShell title="模式" description="跟随系统会随 Windows 的深色 / 浅色设置一起切换。">
        {({ labelId, descriptionId }) => (
          <ModePicker
            value={settings.theme}
            settings={settings}
            onChange={(value) => onChange('theme', value)}
            labelledBy={labelId}
            describedBy={descriptionId}
          />
        )}
      </RowShell>
      <SelectRow
        title="主题"
        description={PALETTE_PRESETS[settings.palette].description}
        value={settings.palette}
        options={PALETTE_OPTIONS}
        onChange={(value) => onChange('palette', value as PalettePreset)}
        testId="appearance-palette"
      />
      <RowShell title="强调色" description="按钮和选中状态用这个颜色；紫色留给 AI。">
        {({ labelId, descriptionId }) => (
          <AccentPicker
            value={settings.accent}
            mode={mode}
            settings={settings}
            onChange={(value) => onChange('accent', value)}
            labelledBy={labelId}
            describedBy={descriptionId}
          />
        )}
      </RowShell>
      <ColorRow
        title={`背景（${MODE_LABEL[mode]}）`}
        description="整体底色；面板、卡片和描边的层次会跟着自动调整。"
        value={base.background}
        customized={custom.background !== null}
        onCommit={(hex) => setCustom('background', hex)}
        onReset={() => setCustom('background', null)}
        testId="appearance-background"
      />
      <ColorRow
        title={`前景（${MODE_LABEL[mode]}）`}
        description="正文与界面文字的颜色。"
        warning={
          contrast < MIN_TEXT_CONTRAST
            ? `与背景的对比度只有 ${contrast.toFixed(1)}:1，低于 4.5:1，文字会看不清。`
            : null
        }
        value={base.foreground}
        customized={custom.foreground !== null}
        onCommit={(hex) => setCustom('foreground', hex)}
        onReset={() => setCustom('foreground', null)}
        testId="appearance-foreground"
      />
      <SelectRow
        title="字体"
        description="界面文字的字体；正文字体在「编辑器」里设置。"
        value={settings.uiFont}
        options={FONT_OPTIONS}
        onChange={(value) => onChange('uiFont', value as UiFont)}
        testId="appearance-font"
      />
    </>
  );
}

function ColorRow({
  title,
  description,
  value,
  customized,
  warning = null,
  onCommit,
  onReset,
  testId,
}: {
  title: string;
  description: string;
  value: string;
  customized: boolean;
  warning?: string | null;
  onCommit: (hex: string) => void;
  onReset: () => void;
  testId: string;
}) {
  // 输入框里允许打到一半（如「#1a」），只有凑成六位十六进制才生效；失焦后回显当前生效值。
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <RowShell
      title={title}
      description={description}
      note={
        warning && (
          <span className="mt-1 block text-warning" data-testid={`${testId}-warning`}>
            {warning}
          </span>
        )
      }
      controlId={testId}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value}
            onChange={(event) => {
              setDraft(null);
              onCommit(event.target.value);
            }}
            aria-label={`${title}取色`}
            aria-describedby={control['aria-describedby']}
            className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            data-testid={`${testId}-picker`}
          />
          <Input
            {...control}
            value={draft ?? value}
            onChange={(event) => {
              setDraft(event.target.value);
              const hex = normalizeHex(event.target.value);
              if (hex) onCommit(hex);
            }}
            onBlur={() => setDraft(null)}
            spellCheck={false}
            controlSize="sm"
            className="w-[96px] font-mono"
            data-testid={testId}
          />
          {customized && (
            <Button size="sm" variant="ghost" onClick={onReset} data-testid={`${testId}-reset`}>
              恢复
            </Button>
          )}
        </div>
      )}
    </RowShell>
  );
}

function rovingKeyDown<T extends string>(
  values: readonly T[],
  value: T,
  onChange: (next: T) => void,
) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const index = values.indexOf(value);
    const next = values[(index + (forward ? 1 : -1) + values.length) % values.length];
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  };
}

const rgb = (palette: Palette, name: TokenName) => `rgb(${palette[name].join(' ')})`;

function MiniWindow({ palette }: { palette: Palette }) {
  return (
    <span
      className="absolute inset-0 flex"
      style={{ background: rgb(palette, 'background') }}
      aria-hidden="true"
    >
      <span className="h-full w-[16px]" style={{ background: rgb(palette, 'panel') }} />
      <span className="flex flex-1 flex-col gap-[3px] p-[6px]">
        <span
          className="h-[3px] w-[70%] rounded-full"
          style={{ background: rgb(palette, 'foreground') }}
        />
        <span
          className="h-[3px] w-[88%] rounded-full"
          style={{ background: rgb(palette, 'subtle') }}
        />
        <span
          className="h-[3px] w-[56%] rounded-full"
          style={{ background: rgb(palette, 'subtle') }}
        />
        <span
          className="mt-auto h-[6px] w-[16px] self-end rounded-full"
          style={{ background: rgb(palette, 'accent') }}
        />
      </span>
    </span>
  );
}

function ModePicker({
  value,
  settings,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: ThemePreference;
  settings: AppearanceSettings;
  onChange: (value: ThemePreference) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const dark = derivePalette('dark', settings);
  const light = derivePalette('light', settings);
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex gap-2"
      onKeyDown={rovingKeyDown(
        MODE_OPTIONS.map((option) => option.value),
        value,
        onChange,
      )}
    >
      {MODE_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <PlainButton
            key={option.value}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-value={option.value}
            data-testid={`appearance-mode-${option.value}`}
            onClick={() => onChange(option.value)}
            className={`flex flex-col items-center gap-1.5 rounded-lg p-1 text-2xs transition-colors ${
              selected ? 'text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            <span
              className={`relative block h-[48px] w-[76px] overflow-hidden rounded-md border ${
                selected ? 'border-accent ring-1 ring-accent' : 'border-border'
              }`}
            >
              {option.value === 'system' ? (
                <>
                  <MiniWindow palette={light} />
                  <span className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}>
                    <MiniWindow palette={dark} />
                  </span>
                </>
              ) : (
                <MiniWindow palette={option.value === 'dark' ? dark : light} />
              )}
            </span>
            {option.label}
          </PlainButton>
        );
      })}
    </div>
  );
}

function AccentPicker({
  value,
  mode,
  settings,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: AccentChoice;
  mode: ThemeMode;
  settings: AppearanceSettings;
  onChange: (value: AccentChoice) => void;
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex items-center gap-1.5"
      onKeyDown={rovingKeyDown(ACCENT_KEYS, value, onChange)}
    >
      {ACCENT_KEYS.map((key) => {
        const selected = key === value;
        const palette = derivePalette(mode, { ...settings, accent: key });
        const fill = rgb(palette, 'accent');
        return (
          <PlainButton
            key={key}
            role="radio"
            aria-checked={selected}
            aria-label={ACCENT_CHOICES[key].label}
            title={ACCENT_CHOICES[key].label}
            tabIndex={selected ? 0 : -1}
            data-value={key}
            data-testid={`appearance-accent-${key}`}
            onClick={() => onChange(key)}
            className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
              selected ? 'border-foreground' : 'border-transparent hover:border-border-strong'
            }`}
          >
            <span
              className="h-5 w-5 rounded-full border border-border"
              style={{
                background:
                  key === 'mono'
                    ? `linear-gradient(135deg, ${fill} 50%, ${rgb(palette, 'background')} 50%)`
                    : fill,
              }}
            />
          </PlainButton>
        );
      })}
    </div>
  );
}
