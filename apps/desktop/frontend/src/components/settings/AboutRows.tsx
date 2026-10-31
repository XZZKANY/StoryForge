/** 设置「关于」分组：版本、检查更新与更新说明。 */
import { useState } from 'react';

import {
  checkAppUpdate,
  downloadAppUpdate,
  restartToInstall,
  useAppUpdate,
  type AppUpdateState,
} from '../../lib/app-update';
import { useAsyncEffect } from '../../lib/async-guards';
import { currentAppVersion } from '../../lib/update-check';
import { Button } from '../ui';
import { useSettingsRowVisible } from './search-context';
import { RowShell } from './SettingRows';

function updateStatus(update: AppUpdateState): { label: string; tone: string } | null {
  switch (update.phase) {
    case 'idle':
      return null;
    case 'checking':
      return { label: '检查中…', tone: 'text-subtle' };
    case 'up-to-date':
      return { label: `已是最新（${update.current}）`, tone: 'text-subtle' };
    case 'check-failed':
      return { label: `检查失败：${update.message}`, tone: 'text-error' };
    case 'available':
      return update.downloadError
        ? { label: `下载失败：${update.downloadError}`, tone: 'text-error' }
        : {
            label: `有新版本 ${update.update.latest}（当前 ${update.update.current}）`,
            tone: 'text-warning',
          };
    case 'downloading': {
      const done = update.total
        ? `${Math.floor((update.received / update.total) * 100)}%`
        : `${(update.received / 1048576).toFixed(1)} MB`;
      return { label: `正在下载 ${update.update.latest}… ${done}`, tone: 'text-subtle' };
    }
    case 'ready':
      return update.installError
        ? { label: `没能开始安装：${update.installError}`, tone: 'text-error' }
        : { label: `${update.update.latest} 已下载好`, tone: 'text-warning' };
  }
}

/** 出错已记进状态、在状态行显示，按钮这里不再抛。 */
const quietly = (task: () => Promise<void>) => () => void task().catch(() => {});

function UpdateNotes({ latest, notes }: { latest: string; notes: string }) {
  const visible = useSettingsRowVisible('更新说明', notes);
  if (!visible) return null;
  return (
    <div className="px-4 pb-3" data-testid="about-update-notes">
      <div className="text-xs font-medium text-foreground">{latest} 更新说明</div>
      <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">
        {notes}
      </div>
    </div>
  );
}

/** 关于区：当前版本 + 检查更新 → 下载 → 重启安装（与启动时的右下角提示共用一份进度）。 */
export function AboutRows() {
  const [version, setVersion] = useState<string | null>(null);
  const update = useAppUpdate();

  useAsyncEffect((isCurrent) => {
    void currentAppVersion().then((value) => {
      if (isCurrent()) setVersion(value);
    });
  }, []);

  const runCheck = async () => {
    await checkAppUpdate(version ?? (await currentAppVersion()));
  };
  const status = updateStatus(update);
  const info =
    update.phase === 'available' || update.phase === 'downloading' || update.phase === 'ready'
      ? update.update
      : null;
  const action =
    update.phase === 'available'
      ? { label: '下载新版', run: quietly(downloadAppUpdate) }
      : update.phase === 'downloading'
        ? { label: '下载中…', run: null }
        : update.phase === 'ready'
          ? { label: '重启安装', run: quietly(restartToInstall) }
          : {
              label: '检查更新',
              run: update.phase === 'checking' ? null : quietly(runCheck),
            };

  return (
    <>
      <RowShell title="当前版本" description="StoryForge IDE 桌面端。">
        <span
          className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 font-mono text-xs text-muted"
          data-testid="about-version"
        >
          {version ? `v${version}` : '开发模式'}
        </span>
      </RowShell>
      <RowShell
        title="检查更新"
        description="联网查看有没有新版本，有就可以下载。点「重启安装」会先问有没有未保存的修改，再关掉 StoryForge 装好并重新打开。网络不通时会检查失败，不影响写作。"
      >
        <div className="flex items-center gap-3">
          {status && (
            <span
              className={`max-w-[280px] truncate text-xs ${status.tone}`}
              data-testid="about-update-status"
            >
              {status.label}
            </span>
          )}
          <Button
            type="button"
            onClick={action.run ?? undefined}
            disabled={!action.run}
            size="sm"
            variant="secondary"
            className="flex-shrink-0 text-sm"
            data-testid="about-update-check"
          >
            {action.label}
          </Button>
        </div>
      </RowShell>
      {info?.notes && <UpdateNotes latest={info.latest} notes={info.notes} />}
    </>
  );
}
