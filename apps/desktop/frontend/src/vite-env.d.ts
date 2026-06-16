/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STORYFORGE_API_BASE_URL?: string;
  readonly VITE_STORYFORGE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
