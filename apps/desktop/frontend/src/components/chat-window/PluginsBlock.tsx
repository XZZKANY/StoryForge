import { PLUGINS_FILE, serializePluginsFile } from '@storyforge/project-core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '../ui';
import {
  listPlugins,
  pluginTitle,
  readEnabledPlugins,
  type PluginDescription,
} from '../../lib/api/plugins';
import { useAsyncEffect } from '../../lib/async-guards';
import { PLUGINS_CHANGED_EVENT } from '../../lib/plugin-events';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { normalizePathForMatch } from '../../lib/project/path';
import { requestSettingsSection } from '../../lib/settings-section';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../../lib/host/tauri-fs';
import { emitToast } from '../../lib/toast';

type PluginChoicesView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      installed: PluginDescription[];
      enabled: string[];
      problem: string | null;
    };

const PLUGINS_PATH = `/${normalizePathForMatch(PLUGINS_FILE)}`;
const PLUGINS_DIR = PLUGINS_FILE.slice(0, PLUGINS_FILE.lastIndexOf('/'));
// 与技能块的小标同一个样式。
const TAG_CLASS =
  'flex-shrink-0 rounded-sm border border-border px-1.5 py-px text-3xs leading-4 text-muted';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const touchesPlugins = (changed: string | undefined) =>
  !changed || `/${normalizePathForMatch(changed)}`.endsWith(PLUGINS_PATH);

const unreadableText = (problem: string) =>
  `${PLUGINS_FILE} 读不懂，先修好或删掉它再勾选：${problem}`;

/**
 * 改作品的插件启用文件：启用追加到末尾、取消去掉（不分大小写），其余名字（包括本机没装的）原样留着。
 * 文件读不懂（坏 JSON、有被丢掉的名字等）就不写，免得把作者手写的内容覆盖掉。
 */
export async function writePluginChoice(
  projectRoot: string,
  name: string,
  enable: boolean,
): Promise<string[]> {
  const dir = resolveProjectRelativePath(projectRoot, PLUGINS_DIR);
  const file = resolveProjectRelativePath(projectRoot, PLUGINS_FILE);
  if (dir === null || file === null) throw new Error('插件启用文件的路径不在当前作品里');
  const { enabled, problem } = await readEnabledPlugins(projectRoot);
  if (problem !== null) throw new Error(unreadableText(problem));
  const key = name.toLowerCase();
  const rest = enabled.filter((item) => item.toLowerCase() !== key);
  const next = !enable ? rest : rest.length < enabled.length ? enabled : [...enabled, name];
  if (!(await TauriFileSystem.projectPathExists(projectRoot, dir)))
    await TauriFileSystem.createDir(projectRoot, dir);
  await TauriFileSystem.writeFile(projectRoot, file, serializePluginsFile(next));
  return next;
}

function usePluginChoices(projectPath: string | null) {
  const [loaded, setLoaded] = useState<{ projectPath: string; view: PluginChoicesView } | null>(
    null,
  );
  const [version, setVersion] = useState(0);
  // 正在写的行：小写名字 → 要写成的勾选状态。
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // 逐个写：每次都在上一次写完之后重读文件，两行连着点不会互相覆盖。
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const onMutation = (event: Event) => {
      if (touchesPlugins((event as CustomEvent<{ path?: string }>).detail?.path))
        setVersion((value) => value + 1);
    };
    const onPluginsChanged = () => setVersion((value) => value + 1);
    window.addEventListener(FS_MUTATION_EVENT, onMutation);
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    return () => {
      window.removeEventListener(FS_MUTATION_EVENT, onMutation);
      window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    };
  }, []);

  useAsyncEffect(
    (isCurrent) => {
      if (!projectPath) return;
      const settle = (view: PluginChoicesView) => {
        if (isCurrent()) setLoaded({ projectPath, view });
      };
      Promise.all([listPlugins(), readEnabledPlugins(projectPath)]).then(
        ([installed, { enabled, problem }]) =>
          settle({ status: 'ready', installed, enabled, problem }),
        (error: unknown) => settle({ status: 'error', message: errorText(error) }),
      );
    },
    [projectPath, version],
  );

  const toggle = useCallback(
    (name: string, enable: boolean) => {
      if (!projectPath) return;
      const key = name.toLowerCase();
      setPending((current) => new Map(current).set(key, enable));
      queueRef.current = queueRef.current.then(async () => {
        try {
          const enabled = await writePluginChoice(projectPath, name, enable);
          setLoaded((current) =>
            current?.projectPath === projectPath && current.view.status === 'ready'
              ? { projectPath, view: { ...current.view, enabled, problem: null } }
              : current,
          );
        } catch (error) {
          emitToast(`改插件选用失败：${errorText(error)}`, { tone: 'error' });
          // 界面可能是旧的（文件在外面被改坏了）：重读一次把锁住的状态显示出来。
          setVersion((value) => value + 1);
        } finally {
          setPending((current) => {
            const next = new Map(current);
            next.delete(key);
            return next;
          });
        }
      });
    },
    [projectPath],
  );

  const view: PluginChoicesView = !projectPath
    ? { status: 'idle' }
    : loaded?.projectPath === projectPath
      ? loaded.view
      : { status: 'loading' };
  return { view, pending, toggle };
}

function PluginRow({
  label,
  version,
  missing,
  checked,
  busy,
  locked,
  onToggle,
}: {
  label: string;
  version: string | null;
  missing: boolean;
  checked: boolean;
  busy: boolean;
  locked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <li>
      <label
        className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-elevated ${
          busy || locked ? 'opacity-60' : 'cursor-pointer'
        }`}
        data-testid={missing ? 'context-plugin-missing' : 'context-plugin'}
      >
        <input
          type="checkbox"
          className="flex-shrink-0 accent-accent"
          checked={checked}
          disabled={busy || locked}
          onChange={(event) => onToggle(event.target.checked)}
          data-testid="context-plugin-toggle"
        />
        <span className={`min-w-0 truncate ${missing ? 'text-subtle' : 'text-foreground'}`}>
          {label}
        </span>
        {version && <span className="flex-shrink-0 text-2xs text-subtle">v{version}</span>}
        {missing && (
          <span className={TAG_CLASS} data-testid="context-plugin-missing-tag">
            本机没装
          </span>
        )}
      </label>
    </li>
  );
}

/** 「上下文」浮窗的插件块：列出本机插件库，勾选写进这本书的 `.storyforge/plugins.json`。 */
export function PluginsBlock({
  projectPath,
  title,
  onOpenSettings,
}: {
  projectPath: string | null;
  title: ReactNode;
  onOpenSettings?: () => void;
}) {
  const { view, pending, toggle } = usePluginChoices(projectPath);
  const ready = view.status === 'ready' ? view : null;
  const locked = ready !== null && ready.problem !== null;
  const enabledKeys = new Set(ready?.enabled.map((name) => name.toLowerCase()));
  const installedKeys = new Set(ready?.installed.map((plugin) => plugin.id.toLowerCase()));
  const missing = ready?.enabled.filter((name) => !installedKeys.has(name.toLowerCase())) ?? [];
  const checkedOf = (name: string) => {
    const key = name.toLowerCase();
    return pending.get(key) ?? enabledKeys.has(key);
  };
  return (
    <div className="space-y-1.5 px-3 py-2.5" data-testid="context-plugins">
      {title}
      {view.status === 'idle' && <p className="text-xs text-muted">还没打开作品。</p>}
      {view.status === 'loading' && (
        <p className="text-xs text-muted" role="status">
          正在读取…
        </p>
      )}
      {view.status === 'error' && (
        <p className="text-xs text-warning" role="alert">
          读不到插件：{view.message}
        </p>
      )}
      {ready && ready.problem !== null && (
        <p className="text-xs text-warning" data-testid="context-plugins-problem">
          {unreadableText(ready.problem)}
        </p>
      )}
      {ready && !ready.installed.length && !missing.length && (
        <p className="text-xs text-muted" data-testid="context-plugins-empty">
          本机还没有插件。
        </p>
      )}
      {ready && (ready.installed.length > 0 || missing.length > 0) && (
        <ul className="space-y-0.5" data-testid="context-plugins-list">
          {ready.installed.map((plugin) => (
            <PluginRow
              key={plugin.id}
              label={pluginTitle(plugin)}
              version={plugin.manifest?.version ?? null}
              missing={false}
              checked={checkedOf(plugin.id)}
              busy={pending.has(plugin.id.toLowerCase())}
              locked={locked}
              onToggle={(checked) => toggle(plugin.id, checked)}
            />
          ))}
          {missing.map((name) => (
            <PluginRow
              key={`missing:${name}`}
              label={name}
              version={null}
              missing
              checked={checkedOf(name)}
              busy={pending.has(name.toLowerCase())}
              locked={locked}
              onToggle={(checked) => toggle(name, checked)}
            />
          ))}
        </ul>
      )}
      {onOpenSettings && (
        <Button
          size="compact"
          variant="ghost"
          onClick={() => {
            requestSettingsSection('plugins');
            onOpenSettings();
          }}
          data-testid="context-plugins-manage"
        >
          管理插件
        </Button>
      )}
    </div>
  );
}
