import { useId } from 'react';
import { Button, Input } from '../ui';
import type { AppDialogApi } from '../app/AppDialog';
import { RowShell, ToggleRow, SelectRow } from './SettingRows';
import { useSettingsRowVisible } from './search-context';
import type { WebSearchSettings } from './useWebSearch';

export function WebSearchSection({
  search,
  confirm,
}: {
  search: WebSearchSettings;
  confirm: AppDialogApi['confirm'];
}) {
  const keyId = useId();
  const visible = useSettingsRowVisible(
    '联网搜索 网页阅读 链接 OpenAI Responses Tavily API Key 保存 移除密钥',
    '启用联网搜索，查询词发送到 Tavily，结果带来源链接，密钥仅本机加密保存。',
  );
  const ready = search.loadState === 'ready';
  return (
    <>
      {ready && (
        <SelectRow
          title="搜索服务"
          description="OpenAI 复用当前模型服务的地址、模型和密钥；Tavily 使用独立搜索密钥。"
          value={search.provider}
          onChange={search.setProvider}
          testId="web-search-provider"
          options={[
            { value: 'openai', label: 'OpenAI（当前模型服务）' },
            { value: 'tavily', label: 'Tavily' },
          ]}
        />
      )}
      {ready && (
        <ToggleRow
          title="启用联网搜索"
          description={
            search.provider === 'openai'
              ? '开启后通过当前模型服务的 Responses API 搜索公开网页，复用已有 Key。搜索及模型调用会消耗该服务额度；第三方接口须支持 web_search。'
              : '开启后，AI 可按需把查询词发送到 Tavily 搜索公开网页，并提供来源链接；使用你的 Tavily API Key，搜索可能消耗服务额度。'
          }
          checked={search.enabled}
          onChange={search.setEnabled}
        />
      )}
      {ready && search.provider === 'openai' && (
        <div className="px-4 py-3 text-xs text-muted" data-testid="web-search-openai-model">
          当前搜索模型：{search.saved?.openaiModel ?? '尚未配置可用模型'}。无需重复填写 Key。
          {!search.saved?.openaiReady && ' 请先保存模型服务配置，再重新打开设置。'}
        </div>
      )}
      {ready && search.provider === 'tavily' && (
        <RowShell
          title="Tavily API Key"
          description={
            search.saved?.hasApiKey
              ? '密钥已在本机加密保存，留空沿用；输入新密钥会替换原密钥。'
              : '填写自己的 Tavily 搜索密钥。保存后不再显示明文，不写入浏览器存储。'
          }
          controlId={keyId}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              value={search.apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={search.saved?.hasApiKey ? '已保存，留空沿用' : '粘贴 Tavily API Key'}
              disabled={search.busy}
              onChange={(event) => search.setApiKey(event.target.value)}
              className="w-full max-w-[280px]"
              data-testid="web-search-api-key"
            />
          )}
        </RowShell>
      )}
      {visible && (
        <div className="px-4 py-3 text-xs" data-testid="web-search-settings">
          {search.loadState === 'loading' && (
            <p role="status" className="text-muted">
              正在读取联网搜索配置…
            </p>
          )}
          {search.notice && (
            <p
              role={search.notice.error ? 'alert' : 'status'}
              className={search.notice.error ? 'text-error' : 'text-success'}
            >
              {search.notice.text}
            </p>
          )}
          {search.loadState === 'error' && (
            <Button size="sm" onClick={() => void search.load()}>
              重新读取搜索配置
            </Button>
          )}
          {ready && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!search.dirty && !search.busy}
                loading={search.busy}
                loadingLabel="保存中"
                onClick={() => void search.save()}
                data-testid="web-search-save"
              >
                保存搜索设置
              </Button>
              <Button size="sm" disabled={!search.dirty || search.busy} onClick={search.reset}>
                撤销未保存更改
              </Button>
              {search.provider === 'tavily' && search.saved?.hasApiKey && (
                <Button
                  size="sm"
                  disabled={search.busy}
                  onClick={() => {
                    void confirm({
                      title: '移除搜索密钥？',
                      message:
                        '将移除本机保存的 Tavily API Key，并关闭联网搜索；作品正文不受影响。',
                      confirmLabel: '移除密钥',
                      cancelLabel: '取消',
                      tone: 'danger',
                    }).then((accepted) => {
                      if (accepted) void search.clearKey();
                    });
                  }}
                  data-testid="web-search-remove-key"
                >
                  移除搜索密钥
                </Button>
              )}
            </div>
          )}
          {ready && (
            <p className="mt-2 text-muted">
              开启后也可直接读取你给的网址及同站相关链接：按问题需要灵活深入，资料足够时结束，你可以随时停止。
              阅读遵循整次对话的运行预算；不会携带模型密钥或登录信息，正文会发送给当前模型用于回答。
              保存后对下一轮对话生效，关闭后停止新的搜索和网页读取。
            </p>
          )}
        </div>
      )}
    </>
  );
}
