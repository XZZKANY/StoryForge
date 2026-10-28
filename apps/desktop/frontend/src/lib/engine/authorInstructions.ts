import {
  AUTHOR_INSTRUCTIONS_PATH,
  describeAuthorInstructions,
  MAX_INSTRUCTION_CHARS,
  ProjectReadError,
  readAuthorInstructions,
} from '@storyforge/engine';
import { nativeProjectReader } from './reader';

export type EngineAuthorInstructions = {
  /** 项目相对路径（posix）。 */
  path: string;
  exists: boolean;
  /** 每轮实际带给模型的正文；null = 文件不在，或在但带不进去（空、二进制、过大、读不了）。 */
  body: string | null;
  chars: number;
  truncated: boolean;
  limit: number;
};

/** 用对话每轮读长期规矩的同一个读口和同一套截断规则：面板看到的就是模型收到的。 */
export async function inspectEngineAuthorInstructions(
  projectRoot: string,
): Promise<EngineAuthorInstructions> {
  const base = { path: AUTHOR_INSTRUCTIONS_PATH, limit: MAX_INSTRUCTION_CHARS };
  const text = await readAuthorInstructions(nativeProjectReader, projectRoot);
  if (text !== null) return { ...base, exists: true, ...describeAuthorInstructions(text) };
  let exists: boolean;
  try {
    const info = await nativeProjectReader.inspectProjectPath(
      projectRoot,
      AUTHOR_INSTRUCTIONS_PATH,
    );
    exists = info.entryKind !== 'missing';
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    // 读不了不等于不存在：当它在，界面就只给「打开编辑」，不会新建去盖掉它。
    exists = true;
  }
  return { ...base, exists, body: null, chars: 0, truncated: false };
}
