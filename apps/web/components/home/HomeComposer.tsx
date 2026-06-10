'use client';

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { parseAssistantIntent } from './assistant-intent';
import { homeComposerPlaceholder } from './home-data';
import { createHomeViewHref, type HomeSearchParams, type HomeView } from './home-view';

const quickActions: readonly { readonly label: string; readonly view: HomeView }[] = [
  { label: 'New project 新建', view: 'projects' },
  { label: 'Current project 当前项目', view: 'projects' },
  { label: 'Review 审阅', view: 'projects' },
  { label: 'Artifacts 产物', view: 'artifacts' },
] as const;

const preservedContextQueryKeys = [
  'book_id',
  'assistant_session_id',
  'book_run_id',
  'scene_packet_id',
  'repair_patch_id',
  'target_chapter_ordinal',
  'artifact_id',
] as const;

export function HomeComposer({
  initialSearchParams = {},
}: {
  readonly initialSearchParams?: HomeSearchParams;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = value.trim();
    if (!intent) return;
    const parsedIntent = parseAssistantIntent(intent);
    const params = new URLSearchParams();
    if (parsedIntent.taskType === 'trial_generation') {
      params.set('view', 'projects');
    }
    for (const key of preservedContextQueryKeys) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    params.set('intent', intent);
    router.push(`/?${params.toString()}`);
  }

  return (
    <form action="/" method="get" onSubmit={handleSubmit} className="w-full">
      <input type="hidden" name="view" value="projects" />
      {preservedContextQueryKeys.map((key) => {
        const value = firstParam(initialSearchParams[key]);
        return value ? <input key={key} type="hidden" name={key} value={value} /> : null;
      })}
      <input ref={fileInputRef} type="file" className="hidden" aria-label="附加资料文件" />
      <div className="rounded-lg border-0 bg-panel p-3">
        <label htmlFor="home-composer-input" className="sr-only">
          给 StoryForge Assistant 发送消息
        </label>
        <textarea
          id="home-composer-input"
          name="intent"
          aria-label="给 StoryForge Assistant 发送消息"
          placeholder={homeComposerPlaceholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={3}
          className="min-h-[48px] w-full resize-none bg-transparent px-1 py-1 text-base leading-6 text-foreground placeholder:text-muted focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            aria-label="附加资料"
            onClick={() => fileInputRef.current?.click()}
            className="grid h-8 w-8 place-items-center rounded-lg text-xl text-foreground hover:bg-muted/20"
          >
            +
          </button>
          <button
            type="submit"
            aria-label="发送"
            disabled={!value.trim()}
            className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-lg font-bold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted/20 disabled:text-muted/70"
          >
            ↑
          </button>
        </div>
      </div>
      <div className="mt-[clamp(12px,1.6vw,18px)] flex flex-wrap justify-center gap-2">
        {quickActions.map((action) => (
          <Link
            key={action.label}
            href={createHomeViewHref(action.view)}
            className="rounded-lg bg-panel px-[clamp(12px,1.2vw,16px)] py-[clamp(7px,0.8vw,10px)] text-[clamp(12px,0.85vw,14px)] font-semibold text-foreground no-underline hover:bg-muted/20"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </form>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
