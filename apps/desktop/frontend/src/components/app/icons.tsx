/**
 * App 壳层使用的内联 SVG 图标。
 * 纯展示组件，无业务逻辑，从 App.tsx 抽出集中管理。
 */

export function FolderPlusIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.32c.42 0 .82.17 1.12.47l1.09 1.1c.11.11.26.18.42.18h4.05a1.75 1.75 0 0 1 1.75 1.75v5A1.75 1.75 0 0 1 12.5 13h-9a1.75 1.75 0 0 1-1.75-1.75v-6.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M8 7.25v3.5M6.25 9h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MessagePlusIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M7.25 3.25H4.4c-.9 0-1.65.74-1.65 1.65v6.7c0 .9.74 1.65 1.65 1.65h6.7c.9 0 1.65-.74 1.65-1.65V8.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.6 2.45c.54-.54 1.41-.54 1.95 0s.54 1.41 0 1.95L7.3 10.65l-2.3.65.65-2.3 5.95-6.55Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StoryStructureIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.25h4.25v3.5H2.5v-3.5ZM9.25 3.25h4.25v3.5H9.25v-3.5ZM2.5 9.25h4.25v3.5H2.5v-3.5ZM9.25 9.25h4.25v3.5H9.25v-3.5Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <path
        d="M6.75 5h2.5M6.75 11h2.5M4.6 6.75v2.5M11.4 6.75v2.5"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 3.5 4.25 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TaskIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4h10M3 8h6M3 12h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.75l1.1 3.15L12.25 6l-3.15 1.1L8 10.25 6.9 7.1 3.75 6l3.15-1.1L8 1.75Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </svg>
  );
}

export function PanelIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.75 3.25h10.5v9.5H2.75z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.8 3.25v9.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function LayoutSplitIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.75 3.25h10.5v9.5H2.75z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 3.25v9.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.55 2.1h2.9l.35 1.55c.33.12.64.3.92.53l1.48-.48 1.45 2.5-1.15 1.08a4.4 4.4 0 0 1 0 1.44l1.15 1.08-1.45 2.5-1.48-.48c-.28.23-.59.41-.92.53l-.35 1.55h-2.9l-.35-1.55a4.1 4.1 0 0 1-.92-.53l-1.48.48-1.45-2.5 1.15-1.08a4.4 4.4 0 0 1 0-1.44L2.35 6.2 3.8 3.7l1.48.48c.28-.23.59-.41.92-.53l.35-1.55Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}
