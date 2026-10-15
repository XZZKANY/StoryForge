import { MAX_NATIVE_READ_BYTES, ProjectReadError, type ProjectReader } from '../readPort';

export type EncodedFile = { chunks: { base64: string; repeat: number }[] };
export function decodeFixtureBytes(file: EncodedFile): Uint8Array {
  const parts = file.chunks.map((chunk) => ({
    bytes: Uint8Array.from(atob(chunk.base64), (char) => char.charCodeAt(0)),
    repeat: chunk.repeat,
  }));
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.bytes.length * part.repeat, 0),
  );
  let offset = 0;
  for (const part of parts) {
    for (let i = 0; i < part.repeat; i += 1) {
      output.set(part.bytes, offset);
      offset += part.bytes.length;
    }
  }
  return output;
}

/** Synthetic files only; no production cache or filesystem access. Used by the Python replay. */
export function contextFixtureReader(fixture: {
  files: Record<string, EncodedFile | undefined>;
  missing_root: boolean;
}) {
  const root = 'D:/synthetic-book';
  const files = new Map(
    Object.entries(fixture.files).map(([path, file]) => {
      if (file === undefined) throw new TypeError('Invalid fixture file');
      return [path, decodeFixtureBytes(file)];
    }),
  );
  const directories = new Map<string, string[]>([['.', []]]);
  for (const path of files.keys()) {
    const parts = path.split('/');
    let directory = '.';
    for (let i = 0; i < parts.length; i += 1) {
      const names = directories.get(directory)!;
      if (!names.includes(parts[i])) names.push(parts[i]);
      if (i !== parts.length - 1) {
        directory = parts.slice(0, i + 1).join('/');
        if (!directories.has(directory)) directories.set(directory, []);
      }
    }
  }
  const trace: { operation: string; path: string; cap?: number }[] = [];
  function relative(base: string, input: string) {
    if (base !== root || fixture.missing_root) throw new ProjectReadError('Missing fixture root');
    const path = input.replace(/\\/g, '/');
    const result = path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
    if (result.split('/').includes('..') || result.startsWith('/') || result.includes(':'))
      throw new ProjectReadError('Outside fixture');
    return result === '' ? '.' : result;
  }
  const reader: ProjectReader = {
    async resolveProjectPath(base, path) {
      trace.push({ operation: 'resolve', path });
      const value = relative(base, path);
      return { relativePath: value, resolvedRelativePath: value };
    },
    async inspectProjectPath(base, input) {
      const path = relative(base, input);
      trace.push({ operation: 'inspect', path });
      const kind = files.has(path) ? 'file' : directories.has(path) ? 'directory' : 'missing';
      return {
        entryKind: kind,
        targetKind: kind,
        isReparsePoint: false,
        sizeBytes: files.get(path)?.length ?? 0,
      };
    },
    async readProjectDirectory(base, input, cap) {
      const path = relative(base, input);
      trace.push({ operation: 'directory', path, cap });
      const names = directories.get(path);
      if (!names) throw new ProjectReadError('Not a fixture directory');
      return { names: names.slice(0, cap + 1), exceeded: names.length > cap, terminalError: null };
    },
    async readProjectBytes(base, input, cap) {
      const path = relative(base, input);
      trace.push({ operation: 'bytes', path, cap });
      if (cap > MAX_NATIVE_READ_BYTES) throw new ProjectReadError('项目文件读取预算无效');
      const bytes = files.get(path);
      if (!bytes) throw new ProjectReadError('Not a fixture file');
      return { bytes: bytes.slice(0, cap + 1), exceeded: bytes.length > cap };
    },
  };
  return { reader, root, trace };
}
