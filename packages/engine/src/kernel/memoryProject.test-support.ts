import { ProjectReadError, type ProjectReader } from '../readPort';
import type { ProjectWriter } from '../writePort';
import { decodeFixtureBytes, type EncodedFile } from './contextFixture.test-support';

/**
 * Synthetic project tree with a recording writer, for replaying Python file-backed oracles.
 * Paths are lexical (no links); absolute inputs must sit under the synthetic root.
 */
export function memoryProject(root: string, initial: Record<string, EncodedFile>) {
  const files = new Map(
    Object.entries(initial).map(([path, file]) => [path, decodeFixtureBytes(file)]),
  );
  const writes = new Map<string, Uint8Array>();
  const prefix = root.replace(/\\/g, '/').replace(/\/+$/, '');

  function relative(base: string, input: string): string {
    if (base !== root) throw new ProjectReadError('Unknown fixture root');
    let path = input.replace(/\\/g, '/');
    if (path.toLowerCase() === prefix.toLowerCase()) path = '';
    else if (path.toLowerCase().startsWith(prefix.toLowerCase() + '/'))
      path = path.slice(prefix.length + 1);
    else if (path.startsWith('/') || /^.:/.test(path))
      throw new ProjectReadError('Outside fixture', 'outside-project');
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (!parts.length) throw new ProjectReadError('Outside fixture', 'outside-project');
        parts.pop();
      } else parts.push(part);
    }
    return parts.length ? parts.join('/') : '.';
  }
  const isDirectory = (path: string) =>
    path === '.' || [...files.keys()].some((file) => file.startsWith(path + '/'));
  const kind = (path: string) =>
    files.has(path) ? 'file' : isDirectory(path) ? 'directory' : 'missing';

  const reader: ProjectReader = {
    async resolveProjectPath(base, path) {
      const value = relative(base, path);
      return { relativePath: value, resolvedRelativePath: value };
    },
    async inspectProjectPath(base, input) {
      const path = relative(base, input);
      const entryKind = kind(path);
      return {
        entryKind,
        targetKind: entryKind,
        isReparsePoint: false,
        sizeBytes: files.get(path)?.length ?? 0,
      };
    },
    async readProjectDirectory(base, input, cap) {
      const path = relative(base, input);
      if (kind(path) !== 'directory') throw new ProjectReadError('Not a fixture directory');
      const names = new Set<string>();
      const start = path === '.' ? '' : path + '/';
      for (const file of files.keys())
        if (file.startsWith(start)) names.add(file.slice(start.length).split('/')[0]);
      const list = [...names];
      return { names: list.slice(0, cap + 1), exceeded: list.length > cap, terminalError: null };
    },
    async readProjectBytes(base, input, cap) {
      const path = relative(base, input);
      const bytes = files.get(path);
      if (!bytes) throw new ProjectReadError('Not a fixture file');
      return { bytes: bytes.slice(0, cap + 1), exceeded: bytes.length > cap };
    },
  };
  const writer: ProjectWriter = {
    async writeProjectFile(base, path, bytes) {
      const target = relative(base, path);
      if (!target.startsWith('.storyforge/'))
        throw new Error(`Engine wrote outside .storyforge: ${target}`);
      const previous = files.get(target);
      files.set(target, new Uint8Array(bytes));
      // The Python oracle records tree changes, so an identical rewrite is not a change.
      const same =
        previous?.length === bytes.length && previous.every((byte, i) => byte === bytes[i]);
      if (!same) writes.set(target, new Uint8Array(bytes));
    },
  };
  return {
    reader,
    writer,
    /** Drain the writes recorded since the previous call. */
    takeWrites() {
      const output = Object.fromEntries(writes);
      writes.clear();
      return output;
    },
    /** Apply a recorded author edit (or deletion) between calls. */
    apply(changes: Record<string, EncodedFile | null>) {
      for (const [path, file] of Object.entries(changes)) {
        if (file === null) files.delete(path);
        else files.set(path, decodeFixtureBytes(file));
      }
    },
  };
}
