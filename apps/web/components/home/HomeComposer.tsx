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
      className="!m-0 flex w-full flex-col items-center !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <div className="mb-8 flex items-center gap-3.5 text-center">
        <span className="relative h-8 w-8 text-[#d96f43]" aria-hidden>
          <span className="absolute -inset-1 rotate-12 text-[35px] leading-8">✳</span>
        </span>
        <h1
          id="home-composer-title"
          className="m-0 font-serif text-4xl font-medium leading-none tracking-[-0.035em] text-[#ded4c2] md:text-[45px]"
        >
          {homeMainTitle}
        </h1>
      </div>
      <form
        onSubmit={handleSubmit}
        className="h-[132px] w-full overflow-hidden rounded-[20px] border border-[#3a3935] bg-[#2c2c2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
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
          rows={2}
          className="h-[70px] w-full resize-none bg-transparent px-5 pt-5 text-base text-[#e8decb] placeholder:text-[#aaa196] focus:outline-none"
        />
        <div className="flex items-center justify-between px-5 pb-4 pt-2">
          <div className="flex items-center gap-3.5 text-[#aaa196]">
            <span className="text-3xl font-extralight leading-none" aria-hidden>
              ＋
            </span>
            <span className="hidden text-xs text-[#8f887f] sm:inline">
              附加资料 / 世界观 / 上章摘要
            </span>
          </div>
          <div className="flex items-center gap-4 text-[#eee4d2]">
            <span className="hidden text-sm text-[#f0e5d4] sm:inline">
              创作模式 <span className="text-xs text-[#aaa196]">⌄</span>
            </span>
            <span className="hidden text-lg sm:inline" aria-hidden>
              🎙
            </span>
            <span className="hidden text-lg sm:inline" aria-hidden>
              ▥
            </span>
            <button
              type="submit"
              className="h-8 rounded-full bg-[#e7dccd] px-3 text-sm font-extrabold text-[#1e1d1b] hover:bg-[#f3eadf]"
            >
              开始
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
