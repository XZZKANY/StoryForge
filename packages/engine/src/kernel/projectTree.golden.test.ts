import { expect, it } from 'vitest';
import golden from '../../golden/p1-reader.windows.json';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { ProjectTreeError, scanProjectFiles } from './projectTree';

type Fixture = (typeof golden.fixtures)[number];
const root = 'D:/synthetic-reader';

// The oracle describes an owned group, not a general-purpose in-memory filesystem.
function fixtureReader(fixture: Fixture): ProjectReader {
  const nodes = new Map<string, 'file' | 'directory' | 'link'>();
  const children = new Map<string, string[]>();
  function add(path: string, kind: 'file' | 'directory' | 'link') {
    if (nodes.has(path)) return;
    const slash = path.lastIndexOf('/');
    if (slash >= 0) {
      const parent = path.slice(0, slash);
      add(parent, 'directory');
      children.get(parent)!.push(path.slice(slash + 1));
    }
    nodes.set(path, kind);
    if (kind === 'directory') children.set(path, []);
  }
  for (const directory of fixture.directories) add(directory, 'directory');
  for (const file of fixture.files) add(file, 'file');
  for (let index = 0; index < fixture.hidden_entries; index++)
    add(`p/.e${String(index).padStart(5, '0')}`, 'file');
  if (fixture.depth) add(`p/${'d/'.repeat(fixture.depth)}a.md`, 'file');
  for (const link of fixture.links) add(link.path, 'link');
  function normalize(path: string) {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '' && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }
  function resolve(path: string) {
    const normalized = normalize(path);
    const link = fixture.links.find(
      (candidate) => normalized === candidate.path || normalized.startsWith(`${candidate.path}/`),
    );
    return link ? link.target + normalized.slice(link.path.length) : normalized;
  }
  const canonicalRoot = resolve(fixture.root);
  function target(base: string, path: string) {
    expect(base).toBe(root);
    const original = normalize(`${canonicalRoot}/${path}`);
    const resolved = resolve(original);
    if (resolved !== canonicalRoot && !resolved.startsWith(`${canonicalRoot}/`))
      throw new ProjectReadError('Synthetic outside target', 'outside-project');
    return { original, resolved };
  }
  function kind(path: string) {
    const value = nodes.get(path);
    return value === 'link' ? 'symlink' : (value ?? 'missing');
  }
  return {
    async resolveProjectPath(base, path) {
      const { original, resolved } = target(base, path);
      return {
        relativePath: original.slice(canonicalRoot.length + 1) || '.',
        resolvedRelativePath: resolved.slice(canonicalRoot.length + 1) || '.',
      };
    },
    async inspectProjectPath(base, path) {
      const { original, resolved } = target(base, path);
      return {
        entryKind: kind(original),
        targetKind: kind(resolved),
        isReparsePoint: nodes.get(original) === 'link',
        sizeBytes: kind(resolved) === 'file' ? 10 : 0,
      };
    },
    async readProjectDirectory(base, path, cap) {
      const { resolved } = target(base, path);
      const entries = children.get(resolved);
      if (!entries) throw new ProjectReadError('Synthetic directory unavailable');
      return {
        names: entries.slice(0, cap + 1),
        exceeded: entries.length > cap,
        terminalError: null,
      };
    },
    async readProjectBytes() {
      throw new TypeError('Traversal must not read file content');
    },
  };
}

for (const fixture of golden.fixtures) {
  for (const action of fixture.actions) {
    it.skipIf(fixture.skip !== null)(
      `Python reader oracle: ${fixture.id}/${action.id}`,
      async () => {
        const promise = scanProjectFiles(fixtureReader(fixture), root, {
          visible: (path) =>
            path === '.' ||
            action.visible === 'all' ||
            !path.split('/').some((part) => part.startsWith('.')),
          scope: action.scope,
          explicitFiles: action.explicit_files,
          maxEntries: 'max_entries' in action ? action.max_entries : undefined,
          maxDepth: 'max_depth' in action ? action.max_depth : undefined,
        });
        if ('error' in action && action.error !== undefined) {
          await expect(promise).rejects.toBeInstanceOf(ProjectTreeError);
          await expect(promise).rejects.toMatchObject(action.error);
        } else if ('output' in action && action.output !== undefined) {
          await expect(promise).resolves.toEqual(action.output);
        } else throw new Error('Incomplete Python reader oracle');
      },
    );
  }
}
