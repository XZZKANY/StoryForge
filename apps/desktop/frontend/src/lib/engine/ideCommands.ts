import { getVersion } from '@tauri-apps/api/app';
import {
  BreakdownCancellations,
  callLlm,
  executeIdeCommand,
  missingLlmEnv,
  recordBookBreakdownRun,
  type BreakdownModel,
  type IdeCommandDeps,
  type LlmSource,
  type SecretContext,
} from '@storyforge/engine';
import { slots } from './agent';
import { clock, platform, wait } from './assistant';
import { nativeHttpPort } from './llm';
import { nativeProjectReader } from './reader';
import { engineRuns } from './store';
import { nativeProjectWriter } from './writer';

// Python 的取消登记是进程内的：拆书与它的取消命令必须落在同一张登记表上。
const cancellations = new BreakdownCancellations();

/** 配置齐了才做结构化分析（Python `missing_llm_env` 为空时才把配置交给拆书）。 */
function breakdownModel(
  source: LlmSource,
  secrets: SecretContext,
  appVersion: string,
): BreakdownModel | null {
  if (missingLlmEnv(source).length) return null;
  return {
    provider: source.STORYFORGE_LLM_PROVIDER ?? null,
    model: source.STORYFORGE_LLM_MODEL ?? null,
    callLlm: async (prompts) => {
      const response = await callLlm(source, prompts, {
        http: nativeHttpPort('main'),
        clock,
        wait,
        random: Math.random,
        appVersion,
        secrets,
      });
      return { content: response.content };
    },
  };
}

export async function ideCommandDeps(): Promise<IdeCommandDeps> {
  const [{ main, secrets }, appVersion] = await Promise.all([slots(), getVersion()]);
  return {
    reader: nativeProjectReader,
    writer: nativeProjectWriter,
    secrets,
    platform: platform(),
    now: () => new Date(),
    cancellations,
    breakdownModel: breakdownModel(main.source, secrets, appVersion),
    newAnalysisId: () => crypto.randomUUID().replace(/-/g, ''),
    // 生产路由带着 DB 会话：拆书记成引擎库里的一个 run（与 ts 档的 agent run 同库）。
    recordBreakdownRun: async (output) =>
      recordBookBreakdownRun({ store: (await engineRuns()).store, secrets }, output),
  };
}

/** 引擎错误的文本就是 Python 的 detail（状态码相同）；交给调用方的仍是普通 Error。 */
function asApiError(error: unknown): unknown {
  if (error instanceof Error && typeof (error as { status?: unknown }).status === 'number')
    return new Error(error.message);
  return error;
}

/**
 * ts 档的 IDE 命令：交回与 `/api/ide/commands/{id}` 相同的响应体；失败时错误文本与 Python 路径一致
 * （400 原文、未知命令 404、422 / 500 为「API 返回 …」）。
 */
export async function executeIdeCommandWithEngine(
  commandId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return (await executeIdeCommand(commandId, args, await ideCommandDeps())) as Record<
      string,
      unknown
    >;
  } catch (error) {
    throw asApiError(error);
  }
}
