import { CONVERSATION_SKILL_DIR } from '@storyforge/project-core';

import {
  looksAbsolutePath,
  relativePathInsideProject,
  resolveProjectRelativePath,
} from '../../lib/project-context';
import { normalizePathForMatch } from '../../lib/project/path';
import type { AgentStep, ChatWindowAgentToolTrace, SkillReadRef } from './types';

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

// 这些工具先把目标文件整份读进来再审 / 改；file.create 的目标还不存在，不算读过。
const READS_TARGET = new Set([
  'file.review',
  'file.revise',
  'chapter.polish',
  'prose.continue',
  'project.trim_prose',
]);

/** 完成的 skill.read 读到的是哪份技能；名字缺就用调用时点的名字，两样都没有为 null。 */
export function traceSkillRead(trace: ChatWindowAgentToolTrace): SkillReadRef | null {
  if (trace.status !== 'completed' || trace.tool_name !== 'skill.read') return null;
  const input: Obj = trace.input_summary ?? {};
  const output: Obj = trace.output_summary ?? {};
  const name = text(output.skill_name) ?? text(input.name);
  if (name === null) return null;
  return { name, plugin: text(output.plugin), path: text(output.path) };
}

/**
 * 一次工具调用读过的文件，照引擎记下的原样（多为项目相对路径）；没完成的调用不算。
 * skill.read 只计作品技能；插件技能不在作品里，由 {@link runContextReads} 按 step.skill 另列。
 */
export function traceReadSources(trace: ChatWindowAgentToolTrace): string[] {
  if (trace.status !== 'completed') return [];
  const input: Obj = trace.input_summary ?? {};
  const output: Obj = trace.output_summary ?? {};
  const found: (string | null)[] = [];
  if (trace.tool_name === 'fs.read') found.push(text(output.path) ?? text(input.path));
  else if (trace.tool_name === 'skill.read') {
    const skill = traceSkillRead(trace);
    if (skill && skill.plugin === null) found.push(skill.path);
  } else if (trace.tool_name === 'project.knowledge') {
    if (input.action === 'read') found.push(text(output.path) ?? text(input.path));
  } else {
    if (READS_TARGET.has(trace.tool_name)) found.push(text(input.file_path) ?? text(input.path));
    // 产字工具的上下文快照记在 context_provenance；拟章纲把快照摘要直接摊在 input_summary 上。
    const provenance = isObj(input.context_provenance)
      ? input.context_provenance
      : trace.tool_name === 'chapter.brief'
        ? input
        : {};
    if (Array.isArray(provenance.context_files)) found.push(...provenance.context_files.map(text));
  }
  return [...new Set(found.filter((path): path is string => path !== null))];
}

/** fs.search 记检索词、fs.list 记子目录（根目录记空串）；其余工具没有。 */
export function traceLookup(trace: ChatWindowAgentToolTrace): string | undefined {
  if (trace.status !== 'completed') return undefined;
  const input: Obj = trace.input_summary ?? {};
  if (trace.tool_name === 'fs.search') return text(input.query) ?? '';
  if (trace.tool_name === 'fs.list') return text(input.subpath) ?? '';
  return undefined;
}

export type ContextReadFile = {
  /** 项目相对路径，统一用 `/`。 */
  path: string;
  /** 能在编辑器打开的绝对路径；不在项目里的为 null（只显示，不能点）。 */
  filePath: string | null;
};

export type ContextLookup = { kind: 'search' | 'list'; text: string };

export type RunContextReads = { files: ContextReadFile[]; lookups: ContextLookup[] };

function readFile(projectPath: string | null, source: string): ContextReadFile {
  if (looksAbsolutePath(source)) {
    const inside = projectPath ? relativePathInsideProject(projectPath, source) : null;
    if (inside === null) return { path: source.replace(/\\/g, '/'), filePath: null };
    source = inside;
  }
  const path = source.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  return { path, filePath: projectPath ? resolveProjectRelativePath(projectPath, path) : null };
}

/** 这一轮读过的文件（按首次读到的顺序去重）与搜过 / 看过的目录。 */
export function runContextReads(
  steps: readonly AgentStep[],
  projectPath: string | null,
): RunContextReads {
  const files: ContextReadFile[] = [];
  const lookups: ContextLookup[] = [];
  const seenFiles = new Set<string>();
  const seenLookups = new Set<string>();
  const addFile = (file: ContextReadFile) => {
    const key = normalizePathForMatch(file.path);
    if (!key || seenFiles.has(key)) return;
    seenFiles.add(key);
    files.push(file);
  };
  for (const step of steps) {
    for (const source of step.sources ?? []) addFile(readFile(projectPath, source));
    if (step.skill?.plugin)
      addFile({
        path: `插件「${step.skill.plugin}」/${step.skill.path ?? step.skill.name}`,
        filePath: null,
      });
    if (step.lookup === undefined) continue;
    const kind = step.tool === 'fs.search' ? 'search' : step.tool === 'fs.list' ? 'list' : null;
    if (kind === null) continue;
    const key = `${kind}\u0000${step.lookup}`;
    if (seenLookups.has(key)) continue;
    seenLookups.add(key);
    lookups.push({ kind, text: step.lookup });
  }
  return { files, lookups };
}

const SKILL_PREFIX = `${normalizePathForMatch(CONVERSATION_SKILL_DIR)}/`;

/** 这一轮读过的技能：「这一轮读了」里落在作品 `技能/` 下的那几份，键是归一后的项目相对路径。 */
export function skillsReadThisRun(reads: RunContextReads | null): Set<string> {
  const used = new Set<string>();
  for (const file of reads?.files ?? []) {
    const key = normalizePathForMatch(file.path);
    if (file.filePath !== null && key.startsWith(SKILL_PREFIX)) used.add(key);
  }
  return used;
}

type SkillListItem = { path: string; name: string; plugin: string | null };

const skillKey = (plugin: string | null, name: string) => `${plugin ?? ''}\u0000${name}`;

/**
 * 这一轮用了的技能名：作品技能看「这一轮读了」里有没有它的文件，
 * 另外 skill.read 按（插件, 名字）读过的作品 / 插件技能都算。
 */
export function skillsUsedThisRun(
  steps: readonly AgentStep[] | null,
  projectPath: string | null,
  skills: readonly SkillListItem[],
): Set<string> {
  if (!steps) return new Set();
  const paths = skillsReadThisRun(runContextReads(steps, projectPath));
  const read = new Set(
    steps.flatMap((step) => (step.skill ? [skillKey(step.skill.plugin, step.skill.name)] : [])),
  );
  return new Set(
    skills
      .filter(
        (skill) =>
          read.has(skillKey(skill.plugin, skill.name)) ||
          (skill.plugin === null && paths.has(normalizePathForMatch(skill.path))),
      )
      .map((skill) => skill.name),
  );
}
