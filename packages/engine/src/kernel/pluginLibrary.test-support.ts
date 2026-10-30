import { ProjectReadError, type ProjectReader } from '../readPort';
import type { EncodedFile } from './contextFixture.test-support';
import { memoryProject } from './memoryProject.test-support';

export type TextFiles = Record<string, string>;

export function encodeText(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
}

export const encodeTexts = (files: TextFiles): Record<string, EncodedFile> =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encodeText(text)]));

/**
 * 作品之外再装一个本机插件库：作品、插件库、每个插件文件夹各是一个根，读取按根分派。
 * 插件库根的内存项目同时装着所有插件的文件（列目录才看得见它们）；插件文件可以改、整个插件可以移走。
 */
export function withPluginLibrary(
  bookRoot: string,
  book: ProjectReader,
  libraryRoot: string,
  plugins: Record<string, TextFiles>,
) {
  const separator = libraryRoot.includes('\\') ? '\\' : '/';
  const pluginRoot = (id: string) => `${libraryRoot}${separator}${id}`;
  const roots = new Map<string, ProjectReader>();
  const projects = new Map<string, ReturnType<typeof memoryProject>>();
  const library: TextFiles = {};
  for (const [id, files] of Object.entries(plugins)) {
    const project = memoryProject(pluginRoot(id), encodeTexts(files));
    projects.set(id, project);
    roots.set(pluginRoot(id), project.reader);
    for (const [path, text] of Object.entries(files)) library[`${id}/${path}`] = text;
  }
  roots.set(libraryRoot, memoryProject(libraryRoot, encodeTexts(library)).reader);
  const pick = (root: string): ProjectReader => {
    if (root === bookRoot) return book;
    const reader = roots.get(root);
    if (!reader) throw new ProjectReadError('Unknown fixture root');
    return reader;
  };
  const reader: ProjectReader = {
    resolveProjectPath: async (root, path) => pick(root).resolveProjectPath(root, path),
    inspectProjectPath: async (root, path) => pick(root).inspectProjectPath(root, path),
    readProjectDirectory: async (root, path, cap) =>
      pick(root).readProjectDirectory(root, path, cap),
    readProjectBytes: async (root, path, cap) => pick(root).readProjectBytes(root, path, cap),
  };
  return {
    reader,
    pluginRoot,
    editPlugin: (id: string, path: string, text: string) =>
      projects.get(id)!.apply({ [path]: encodeText(text) }),
    removePlugin: (id: string) => roots.delete(pluginRoot(id)),
  };
}
