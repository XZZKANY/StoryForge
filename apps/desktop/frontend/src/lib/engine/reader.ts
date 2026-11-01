import { invoke } from '@tauri-apps/api/core';
import { ProjectReadError, type ProjectReader, type ProjectPathKind } from '@storyforge/engine';
import { assertTauriRuntime } from '../host/tauri-env';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Native engine read response');
  }
  return value as Record<string, unknown>;
}

function relativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === '.' ||
      (!/[\\:\0]/.test(value) &&
        value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')))
  );
}

function pathKind(value: unknown): value is ProjectPathKind {
  return (
    typeof value === 'string' &&
    ['file', 'directory', 'symlink', 'other', 'missing'].includes(value)
  );
}

async function read(
  command: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertTauriRuntime(command);
  let value: unknown;
  try {
    value = await invoke<unknown>(command, args);
  } catch (error) {
    if (error !== null && typeof error === 'object' && !(error instanceof Error)) {
      const failure = record(error);
      if (
        (failure.kind !== 'io' && failure.kind !== 'outside-project') ||
        typeof failure.message !== 'string'
      )
        throw Object.assign(new TypeError('Invalid Native engine read error'), { cause: error });
      throw new ProjectReadError(failure.message, failure.kind);
    }
    throw new ProjectReadError(
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : 'Native project read failed',
    );
  }
  return record(value);
}

// This port intentionally bypasses UI filesystem mocks, list caches and display filters.
// Importing it does not perform IO; only an admitted request may call these methods.
export const nativeProjectReader: ProjectReader = {
  async resolveProjectPath(projectRoot, path) {
    const value = await read('resolve_engine_project_path', { projectRoot, path });
    if (!relativePath(value.relativePath) || !relativePath(value.resolvedRelativePath)) {
      throw new TypeError('Invalid Native engine path response');
    }
    return { relativePath: value.relativePath, resolvedRelativePath: value.resolvedRelativePath };
  },
  async inspectProjectPath(projectRoot, path) {
    const value = await read('inspect_engine_project_path', { projectRoot, path });
    if (
      !pathKind(value.entryKind) ||
      !pathKind(value.targetKind) ||
      typeof value.isReparsePoint !== 'boolean' ||
      typeof value.sizeBytes !== 'number' ||
      !Number.isSafeInteger(value.sizeBytes) ||
      value.sizeBytes < 0
    ) {
      throw new TypeError('Invalid Native engine metadata response');
    }
    return {
      entryKind: value.entryKind,
      targetKind: value.targetKind,
      isReparsePoint: value.isReparsePoint,
      sizeBytes: value.sizeBytes,
    };
  },
  async readProjectDirectory(projectRoot, path, remainingEntries) {
    const value = await read('read_engine_project_directory', {
      projectRoot,
      path,
      remainingEntries,
    });
    if (
      !Array.isArray(value.names) ||
      !value.names.every(
        (name: unknown) =>
          typeof name === 'string' &&
          name !== '' &&
          name !== '.' &&
          name !== '..' &&
          !/[\\/\0]/.test(name),
      ) ||
      typeof value.exceeded !== 'boolean' ||
      !(value.terminalError === null || typeof value.terminalError === 'string') ||
      value.names.length > remainingEntries + 1 ||
      value.exceeded !== value.names.length > remainingEntries ||
      (value.exceeded && value.terminalError !== null)
    ) {
      throw new TypeError('Invalid Native engine directory response');
    }
    return { names: value.names, exceeded: value.exceeded, terminalError: value.terminalError };
  },
  async readProjectBytes(projectRoot, path, maxBytes) {
    const value = await read('read_engine_project_bytes', { projectRoot, path, maxBytes });
    if (
      typeof value.base64 !== 'string' ||
      typeof value.bytesRead !== 'number' ||
      !Number.isSafeInteger(value.bytesRead) ||
      value.bytesRead < 0 ||
      value.bytesRead > maxBytes + 1 ||
      typeof value.exceeded !== 'boolean' ||
      value.exceeded !== value.bytesRead > maxBytes
    ) {
      throw new TypeError('Invalid Native engine bytes response');
    }
    const binary = atob(value.base64);
    const bytes = new Uint8Array(binary.length);
    // Preallocate at this 2MiB boundary: iterable/callback conversion stalls the WebView.
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytes.length !== value.bytesRead) throw new TypeError('Native engine byte count mismatch');
    return { bytes, exceeded: value.exceeded };
  },
};
