import type { IdeCommandDefinition } from './registry';

export type CommandPaletteProps = {
  readonly commands: readonly IdeCommandDefinition[];
  readonly query?: string;
};

export function filterCommands(
  commands: readonly IdeCommandDefinition[],
  query: string,
): readonly IdeCommandDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) =>
    [command.id, command.title, command.category].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export function CommandPalette({ commands, query = '' }: CommandPaletteProps) {
  const filtered = filterCommands(commands, query);
  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">Command Palette</p>
        <h2 className="mt-1 text-lg font-semibold">命令面板</h2>
      </header>
      <ul className="mt-3 space-y-2 text-sm">
        {filtered.map((command) => (
          <li key={command.id} className="rounded border border-stone-800 bg-stone-950 p-2">
            <strong>{command.title}</strong>
            <p className="text-xs text-stone-400">
              {command.id} · {command.category}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
