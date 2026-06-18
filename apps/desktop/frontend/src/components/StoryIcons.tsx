const DEFAULT_ICON_CLASS = 'h-3.5 w-3.5';

export function ProjectIcon({ className = DEFAULT_ICON_CLASS }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-icon-kind="project">
      <path
        d="M2.25 4.25c0-.83.67-1.5 1.5-1.5h3.35c.38 0 .74.14 1.01.4l1.07 1.02c.18.17.42.27.67.27h2.4c.83 0 1.5.67 1.5 1.5v5.81c0 .83-.67 1.5-1.5 1.5h-8.5c-.83 0-1.5-.67-1.5-1.5v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5 7.15h6M5 9.3h4.6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

export function FolderIcon({ className = DEFAULT_ICON_CLASS }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-icon-kind="folder">
      <path
        d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.32c.42 0 .82.17 1.12.47l1.09 1.1c.11.11.26.18.42.18h4.05a1.75 1.75 0 0 1 1.75 1.75v5A1.75 1.75 0 0 1 12.5 13h-9a1.75 1.75 0 0 1-1.75-1.75v-6.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MarkdownFileIcon({ className = DEFAULT_ICON_CLASS }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-icon-kind="markdown-file">
      <path
        d="M4 1.75h5.2c.32 0 .63.13.86.36l2.33 2.33c.23.23.36.54.36.86V13A1.25 1.25 0 0 1 11.5 14.25h-7A1.25 1.25 0 0 1 3.25 13V2.5A.75.75 0 0 1 4 1.75Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.25 2v2.55c0 .33.27.6.6.6h2.55" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.15 11V7.25l1.35 2 1.35-2V11M9.25 7.25 10.5 11l1.25-3.75" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HomeStoryIcon({ className = DEFAULT_ICON_CLASS }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-icon-kind="home">
      <path d="M2 7.5 8 2l6 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 6.75V14h7V6.75" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
