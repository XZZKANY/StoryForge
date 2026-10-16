/** IDE 命令在进程内的 TS 引擎里跑；引擎包按需加载。 */
export async function executeIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await import('../engine/ideCommands')).executeIdeCommandWithEngine(commandId, args);
}
