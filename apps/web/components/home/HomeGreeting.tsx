'use client';

import { homeMainTitle, homeUserFallbackName } from './home-data';

export function HomeGreeting() {
  return (
    <header className="w-full text-left">
      <p className="m-0 text-sm font-medium text-[#aaa39a]">StoryForge Assistant</p>
      <h1
        id="home-assistant-title"
        className="m-0 mt-3 font-serif !text-[clamp(38px,4vw,58px)] font-semibold leading-none text-[#efe6d7]"
      >
        晚上好，{homeUserFallbackName}
      </h1>
      <p className="m-0 mt-4 text-sm text-[#bdb3a6]">{homeMainTitle}</p>
    </header>
  );
}
