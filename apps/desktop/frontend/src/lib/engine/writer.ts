import { invoke } from '@tauri-apps/api/core';
import type { ProjectWriter } from '@storyforge/engine';
import { assertTauriRuntime } from '../host/tauri-env';
import { toBase64 } from './llm';

/**
 * 引擎唯一的写口：只写项目的 `.storyforge/`（派生缓存、连载计划、拆书报告），Rust 端再按真实路径核一遍，
 * 书稿永远走不到这里。原子写由 Rust 负责。
 */
export const nativeProjectWriter: ProjectWriter = {
  async writeProjectFile(root, relativePath, bytes) {
    assertTauriRuntime('write_engine_project_file');
    try {
      await invoke('write_engine_project_file', {
        projectRoot: root,
        relativePath,
        base64: toBase64(bytes),
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
};
