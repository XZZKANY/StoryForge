import { Button, Spinner } from '../ui';

export function EditorLoadStatus({
  filePath,
  loadedFilePath,
  loadError,
  onRetry,
}: {
  filePath: string | null;
  loadedFilePath: string | null;
  loadError: string;
  onRetry?: () => void;
}) {
  if (!filePath || loadedFilePath === filePath) return null;
  return (
    <div
      className="absolute inset-x-0 bottom-0 top-0 z-20 flex items-center justify-center bg-background px-6 text-center"
      role={loadError ? 'alert' : 'status'}
      data-testid={loadError ? 'editor-load-error' : 'editor-loading'}
    >
      <div>
        <p className={loadError ? 'text-sm text-error' : 'text-sm text-muted'}>
          {loadError ? (
            '读取文件失败'
          ) : (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              正在读取文件…
            </span>
          )}
        </p>
        {loadError && <p className="mt-2 max-w-xl text-xs text-subtle">{loadError}</p>}
        {loadError && onRetry ? (
          <Button onClick={onRetry} className="mt-3" data-testid="editor-load-retry">
            重试读取
          </Button>
        ) : null}
      </div>
    </div>
  );
}
