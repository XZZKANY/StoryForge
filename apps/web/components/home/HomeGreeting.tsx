'use client';

import { homeMainTitle, homeUserFallbackName } from './home-data';

export function HomeGreeting() {
  return (
    <header className="w-full text-left">
      <p className="m-0 text-sm font-medium text-muted">StoryForge Assistant</p>
      <h1
        id="home-assistant-title"
        className="m-0 mt-3 font-serif !text-[clamp(38px,4vw,58px)] font-semibold leading-none text-foreground"
      >
        晚上好，{homeUserFallbackName}
      </h1>
      <p className="m-0 mt-4 text-sm text-muted">{homeMainTitle}</p>
    </header>
  );
}
