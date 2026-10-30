import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginNameProblem } from '@storyforge/project-core';

import {
  describeStagedPlugin,
  listPlugins,
  pluginTitle,
  type PluginDescription,
} from '../../lib/api/plugins';
import { emitPluginsChanged } from '../../lib/plugin-events';
import {
  commitPluginImport,
  discardPluginImport,
  removePlugin,
  stagePluginImport,
  type StagedPluginImport,
} from '../../lib/plugin-library';
import { emitToast } from '../../lib/toast';

export type PluginImportPreview = {
  staged: StagedPluginImport;
  description: PluginDescription;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// 暂存清不掉不要紧：下一次导入前宿主会先清旧暂存。
const discardQuietly = (stageId: string) => void discardPluginImport(stageId).catch(() => {});

/** 预览里的插件装不了的原因；能装返回 null。 */
export function pluginInstallBlocker(description: PluginDescription): string | null {
  const { manifest } = description;
  if (!manifest) return '没有读到可用的插件清单，装不了。';
  const nameProblem = pluginNameProblem(manifest.name);
  if (nameProblem) return `插件名「${manifest.name}」不能用：${nameProblem}`;
  if (!description.skills.length && !description.styles.length && !description.instructions)
    return '里面没有技能、写法或指令片段，装了也用不上。';
  return null;
}

/** 设置页「插件」：本机插件库列表、从文件夹导入（暂存 → 预览 → 安装 / 取消）、移除。 */
export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginDescription[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [preview, setPreview] = useState<PluginImportPreview | null>(null);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const seq = ++loadSeqRef.current;
    const current = () => aliveRef.current && seq === loadSeqRef.current;
    return listPlugins().then(
      (list) => {
        if (!current()) return;
        setPlugins(list);
        setLoadState('idle');
        setLoadError('');
      },
      (error: unknown) => {
        if (!current()) return;
        setLoadState('error');
        setLoadError(errorText(error));
      },
    );
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startImport = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setImporting(true);
    let staged: StagedPluginImport | null = null;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择插件文件夹' });
      if (!selected || typeof selected !== 'string') return;
      staged = await stagePluginImport(selected);
      const description = await describeStagedPlugin(staged.stageRoot);
      if (!aliveRef.current) {
        discardQuietly(staged.stageId);
        return;
      }
      setPreview({ staged, description });
    } catch (error) {
      if (staged) discardQuietly(staged.stageId);
      emitToast(`导入插件失败：${errorText(error)}`, { tone: 'error' });
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setImporting(false);
    }
  }, []);

  const cancelImport = useCallback(() => {
    if (!preview || installing) return;
    discardQuietly(preview.staged.stageId);
    setPreview(null);
  }, [installing, preview]);

  const install = useCallback(async () => {
    if (!preview || busyRef.current || pluginInstallBlocker(preview.description)) return;
    const manifest = preview.description.manifest!;
    busyRef.current = true;
    setInstalling(true);
    try {
      await commitPluginImport(preview.staged.stageId, manifest.name);
      await reload();
      emitPluginsChanged();
      emitToast(`已安装插件「${manifest.displayName || manifest.name}」`, { tone: 'success' });
      if (aliveRef.current) setPreview(null);
    } catch (error) {
      emitToast(`安装插件失败：${errorText(error)}`, { tone: 'error' });
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setInstalling(false);
    }
  }, [preview, reload]);

  const remove = useCallback(
    async (plugin: PluginDescription) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setRemoving(plugin.id);
      try {
        await removePlugin(plugin.id);
        await reload();
        emitPluginsChanged();
        emitToast(`已移除插件「${pluginTitle(plugin)}」`, { tone: 'success' });
      } catch (error) {
        emitToast(`移除插件失败：${errorText(error)}`, { tone: 'error' });
      } finally {
        busyRef.current = false;
        if (aliveRef.current) setRemoving(null);
      }
    },
    [reload],
  );

  return {
    plugins,
    loadState,
    loadError,
    reload,
    importing,
    installing,
    removing,
    busy: importing || installing || removing !== null,
    preview,
    startImport,
    cancelImport,
    install,
    remove,
  };
}

export type PluginsState = ReturnType<typeof usePlugins>;
