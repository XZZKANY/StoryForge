import type { CommandRegistry, IdeCommandDefinition } from './registry';

export const builtinCommands: readonly IdeCommandDefinition[] = [
  { id: 'judge.run', title: '运行 Judge', category: 'Judge', writes: true, shortcut: 'Ctrl+Alt+J' },
  {
    id: 'judge.repair',
    title: '生成定向修复',
    category: 'Judge',
    writes: true,
    shortcut: 'Ctrl+.',
  },
  { id: 'judge.approve', title: '批准修复写回', category: 'Judge', writes: true },
  { id: 'bookrun.start', title: '启动 BookRun', category: 'BookRun', writes: true },
  { id: 'bookrun.pause', title: '暂停 BookRun', category: 'BookRun', writes: true },
  { id: 'bookrun.resume', title: '恢复 BookRun', category: 'BookRun', writes: true },
  { id: 'bookrun.stop', title: '停止 BookRun', category: 'BookRun', writes: true },
  {
    id: 'bookrun.retry_from_checkpoint',
    title: '从 checkpoint 重试',
    category: 'BookRun',
    writes: true,
  },
  { id: 'audit.open', title: '打开审计记录', category: 'Audit', writes: false },
  { id: 'memory.resolve_conflict', title: '仲裁记忆冲突', category: 'Story Memory', writes: true },
];

export function registerBuiltinCommands(registry: CommandRegistry): CommandRegistry {
  for (const command of builtinCommands) {
    registry.register(command);
  }
  return registry;
}
