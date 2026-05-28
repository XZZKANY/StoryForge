import type { IdePersonalizationPreferences } from './preferences';
import { PersonalizationControls } from './PersonalizationControls';
import { defaultIdePreferences } from './preferences';

export type PersonalizationPanelProps = {
  readonly preferences?: IdePersonalizationPreferences;
};

export function PersonalizationPanel({
  preferences = defaultIdePreferences,
}: PersonalizationPanelProps) {
  const keybindingEntries = Object.entries(preferences.keybindings);
  return (
    <section
      data-testid="ide-personalization"
      className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-xs text-stone-200"
    >
      <h2 className="font-semibold text-stone-100">IDE 个性化</h2>
      <dl className="mt-2 grid gap-1">
        <div>
          <dt className="inline text-stone-400">主题：</dt>
          <dd className="inline font-semibold">{`主题：${preferences.theme}`}</dd>
        </div>
        <div>
          <dt className="inline text-stone-400">布局持久化：</dt>
          <dd className="inline font-semibold">
            left {preferences.layout.leftPanelWidth}px / bottom{' '}
            {preferences.layout.bottomPanelHeight}px / right {preferences.layout.rightDockWidth}px
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-stone-400">键位自定义</p>
      {keybindingEntries.length === 0 ? (
        <p className="text-stone-500">使用默认键位</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {keybindingEntries.map(([commandId, shortcut]) => (
            <li key={commandId}>
              {commandId} → {shortcut}
            </li>
          ))}
        </ul>
      )}
      <PersonalizationControls preferences={preferences} />
    </section>
  );
}
