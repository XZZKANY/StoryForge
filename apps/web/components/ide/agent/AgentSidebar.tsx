import { builtinCommands } from '../commands/registerBuiltinCommands';

const agentToolCommandIds = [
  'judge.repair',
  'memory.resolve_conflict',
  'bookrun.retry_from_checkpoint',
] as const;

export function AgentSidebar() {
  const tools = builtinCommands.filter((command) =>
    agentToolCommandIds.includes(command.id as (typeof agentToolCommandIds)[number]),
  );
  return (
    <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-950 p-4 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">AI Agent Sidebar</p>
        <h2 className="mt-1 text-lg font-semibold">Agent 工具</h2>
        <p className="mt-2 text-sm text-stone-300">
          Agent 的写操作必须调用 commands.execute，并在响应中展示 audit_event_id。
        </p>
      </header>
      <ul className="space-y-2 text-sm">
        {tools.map((tool) => (
          <li key={tool.id} className="rounded border border-stone-800 bg-stone-900 p-2">
            <strong>{tool.title}</strong>
            <p className="text-xs text-stone-400">{tool.id}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-200">
        无 Character Bible 上下文时，Agent 不会静默伪造设定。
      </p>
    </section>
  );
}
