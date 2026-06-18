'use client';

import { CreativePreferencesPanel } from './CreativePreferencesPanel';
import { ProviderSettingsPanel } from './ProviderSettingsPanel';

export function SettingsClient() {
  return (
    <main
      aria-labelledby="settings-title"
      className="min-h-screen bg-background px-6 py-10 text-foreground"
    >
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted">Settings · Provider Gateway</p>
        <h1 id="settings-title" className="mt-3 font-serif text-4xl font-semibold tracking-tight">
          模型与 Provider 设置
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          在这里配置兼容 OpenAI 协议的 Provider Base URL 和 API Key。StoryForge 会通过服务端代理访问
          `/v1/models`，并在凭据完整后自动展示可读取的模型列表。
        </p>
        <ProviderSettingsPanel />
        <CreativePreferencesPanel />
      </div>
    </main>
  );
}
