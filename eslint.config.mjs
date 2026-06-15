import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/out/',
      '**/.next/',
      '**/generated/',
      '**/.git/',
      '**/.pytest-tmp/',
      '**/.pytest_cache/',
      '**/__pycache__/',
      '**/.codex/',
      '**/.worktrees/',
      'apps/desktop/generate-icons.*',
      'apps/api/',
      'apps/workflow/',
      'docs/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/scripts/verify-*-browser.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  eslintConfigPrettier,
);
