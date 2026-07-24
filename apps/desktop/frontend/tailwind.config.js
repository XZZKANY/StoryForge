/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-foreground': 'rgb(var(--accent-foreground) / <alpha-value>)',
        error: 'rgb(var(--error) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        agent: 'rgb(var(--agent) / <alpha-value>)',
        'agent-foreground': 'rgb(var(--agent-foreground) / <alpha-value>)',
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        prose: 'var(--font-prose)',
        mono: 'var(--font-mono)',
      },
      spacing: {
        // 壳子三栏头部行行高单一事实源（左栏顶行 / 中栏页签行 / 右栏对话头共用，
        // h-shell-row / top-shell-row）；改行高只改这里，组件禁止再写死 h-9/h-10，
        // 指纹护栏见 tests/shell-row-height.test.ts。
        'shell-row': '2.5rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up-fade': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-up-fade': 'slide-up-fade 0.18s ease-out',
      },
    },
  },
  plugins: [],
};
