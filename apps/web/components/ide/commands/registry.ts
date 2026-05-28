import type { IdeCommandResponse } from './command-client';

export type IdeCommandDefinition = {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly writes: boolean;
  readonly shortcut?: string;
};

export type CommandRegistryOptions = {
  readonly executeRemote?: (
    commandId: string,
    args: Record<string, unknown>,
  ) => Promise<IdeCommandResponse>;
};

export type CommandRegistry = {
  readonly register: (command: IdeCommandDefinition) => void;
  readonly list: () => readonly IdeCommandDefinition[];
  readonly get: (commandId: string) => IdeCommandDefinition | undefined;
  readonly execute: (
    commandId: string,
    args?: Record<string, unknown>,
  ) => Promise<IdeCommandResponse>;
};

export function createCommandRegistry(options: CommandRegistryOptions = {}): CommandRegistry {
  const commands = new Map<string, IdeCommandDefinition>();

  return {
    register(command) {
      commands.set(command.id, command);
    },
    list() {
      return [...commands.values()].sort((left, right) => left.id.localeCompare(right.id));
    },
    get(commandId) {
      return commands.get(commandId);
    },
    async execute(commandId, args = {}) {
      if (!commands.has(commandId)) {
        throw new Error(`未知 IDE 命令：${commandId}`);
      }
      if (options.executeRemote) {
        return options.executeRemote(commandId, args);
      }
      const { executeIdeCommand } = await import('./command-client');
      return executeIdeCommand(commandId, args);
    },
  };
}
