'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { homeComposerPlaceholder, homeMainTitle } from './home-data';

export function HomeComposer() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push('/blueprints');
  }

  return (
    <section
      aria-labelledby="home-composer-title"
      className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <h1
        id="home-composer-title"
        className="text-center text-3xl font-semibold text-stone-100 md:text-4xl"
      >
        {homeMainTitle}
      </h1>
      <form
        onSubmit={handleSubmit}
        className="mt-8 rounded-2xl border border-stone-800 bg-stone-900/80 p-3 shadow-xl shadow-black/40"
      >
        <label htmlFor="home-composer-input" className="sr-only">
          创作意图输入
        </label>
        <textarea
          id="home-composer-input"
          name="intent"
          aria-label="创作意图输入"
          placeholder={homeComposerPlaceholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={3}
          className="w-full resize-none bg-transparent px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2 px-1">
          <p className="text-xs text-stone-500">
            第一阶段：内容暂不提交后端，点击开始进入蓝图入口。
          </p>
          <button
            type="submit"
            className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-stone-50 hover:bg-amber-600"
          >
            开始
          </button>
        </div>
      </form>
    </section>
  );
}
