import { useId, useState } from 'react';

import { Button } from '../ui';
import { pluginTitle, type PluginDescription } from '../../lib/api/plugins';
import type { AppDialogApi } from '../app/AppDialog';
import { settingsTextMatches, useSettingsQuery } from './search-context';
import {
  PluginContents,
  PluginImportDialog,
  PluginProblems,
  pluginMeta,
} from './PluginImportDialog';
import type { PluginsState } from './usePlugins';

// 设置搜索按这些词命中整个插件分组。
const SEARCH_TEXT = '插件 技能 写法 指令 导入 压缩包 zip 移除 Codex';

/** 设置页「插件」：本机插件库里装了什么、从文件夹或压缩包导入、移除；每本书在对话头「上下文」里选用。 */
export function PluginsSection({
  plugins,
  confirm,
}: {
  plugins: PluginsState;
  confirm: AppDialogApi['confirm'];
}) {
  const visible = settingsTextMatches(useSettingsQuery(), SEARCH_TEXT);
  const remove = async (plugin: PluginDescription) => {
    const confirmed = await confirm({
      title: `移除插件「${pluginTitle(plugin)}」？`,
      message: '会从本机插件库挪进回收夹；已经启用它的作品会显示「本机没装」。',
      confirmLabel: '移除',
      cancelLabel: '取消',
      tone: 'danger',
    });
    if (confirmed) await plugins.remove(plugin);
  };

  return (
    <>
      {visible && (
        <div data-testid="plugins-section">
          <p className="px-4 pt-3 text-xs leading-relaxed text-muted">
            插件装在本机；每本书在对话头「上下文」里自己选用。只收文本，StoryForge
            不运行插件里的程序。
          </p>
          {plugins.loadState === 'error' && (
            <div role="alert" className="mx-4 mt-3 text-sm" data-testid="plugins-load-error">
              <p className="break-words text-error">读不到插件库：{plugins.loadError}</p>
              <Button
                size="sm"
                className="mt-2"
                disabled={plugins.busy}
                onClick={() => void plugins.reload()}
              >
                重试读取
              </Button>
            </div>
          )}
          {plugins.loadState === 'loading' && (
            <p role="status" className="px-4 pt-3 text-xs text-muted">
              正在读取本机插件库…
            </p>
          )}
          {plugins.loadState === 'idle' && plugins.plugins.length === 0 && (
            <p className="px-4 pt-3 text-xs text-subtle" data-testid="plugins-empty">
              还没有插件。
            </p>
          )}
          {plugins.plugins.length > 0 && (
            <ul className="space-y-2 px-4 pt-3" data-testid="plugin-cards">
              {plugins.plugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  disabled={plugins.busy}
                  removing={plugins.removing === plugin.id}
                  onRemove={() => void remove(plugin)}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={plugins.busy}
              loading={plugins.importingFrom === 'folder'}
              onClick={() => void plugins.startImport('folder')}
              data-testid="plugins-import"
            >
              从文件夹导入…
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={plugins.busy}
              loading={plugins.importingFrom === 'zip'}
              onClick={() => void plugins.startImport('zip')}
              data-testid="plugins-import-zip"
            >
              从压缩包导入…
            </Button>
          </div>
        </div>
      )}
      {plugins.preview && (
        <PluginImportDialog
          preview={plugins.preview}
          installed={plugins.plugins}
          installing={plugins.installing}
          onCancel={plugins.cancelImport}
          onInstall={() => void plugins.install()}
        />
      )}
    </>
  );
}

function PluginCard({
  plugin,
  disabled,
  removing,
  onRemove,
}: {
  plugin: PluginDescription;
  disabled: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const title = pluginTitle(plugin);
  const meta = pluginMeta(plugin.manifest);
  const [firstProblem] = plugin.problems;
  return (
    <li
      className="rounded-lg border border-border bg-background"
      data-testid="plugin-card"
      data-plugin-id={plugin.id}
    >
      <div className="flex items-start gap-3 py-2.5 pl-3 pr-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" data-testid="plugin-card-title">
            <span className="font-medium text-foreground">{title}</span>
            {meta && <span className="text-xs text-muted"> · {meta}</span>}
            {plugin.bundled && (
              <>
                {' '}
                <span
                  className="rounded-sm border border-border px-1.5 py-px text-3xs leading-4 text-muted"
                  data-testid="plugin-card-bundled"
                >
                  内置
                </span>
              </>
            )}
          </p>
          {plugin.manifest?.description && (
            <p
              className="mt-0.5 line-clamp-2 text-xs text-muted"
              title={plugin.manifest.description}
            >
              {plugin.manifest.description}
            </p>
          )}
          <p className="mt-1 text-2xs text-subtle" data-testid="plugin-card-counts">
            技能 {plugin.skills.length} · 写法 {plugin.styles.length} · 指令{' '}
            {plugin.instructions ? '有' : '无'}
          </p>
          {firstProblem !== undefined && (
            <p
              className="mt-1 flex min-w-0 gap-1 text-2xs text-warning"
              data-testid="plugin-card-problem"
            >
              <span className="truncate" title={firstProblem}>
                {firstProblem}
              </span>
              {plugin.problems.length > 1 && (
                <span className="flex-shrink-0">等 {plugin.problems.length} 条</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            onClick={() => setOpen((value) => !value)}
            data-testid="plugin-card-toggle"
          >
            {open ? '收起' : '查看'}
          </Button>
          {!plugin.bundled && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`移除插件「${title}」`}
              disabled={disabled}
              loading={removing}
              onClick={onRemove}
              data-testid="plugin-card-remove"
            >
              移除
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div
          id={detailsId}
          className="space-y-3 border-t border-border px-3 py-2.5"
          data-testid="plugin-card-details"
        >
          <PluginContents description={plugin} />
          <PluginProblems problems={plugin.problems} />
        </div>
      )}
    </li>
  );
}
