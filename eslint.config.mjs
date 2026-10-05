// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/desktop/staging/**',
      'apps/desktop/release/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_` no nome marca parametro/variavel ignorado de proposito.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: [
      'apps/desktop/**/*.{ts,js}',
      'apps/server/**/*.ts',
      'packages/**/*.ts',
      '*.{js,mjs}',
      'apps/*/*.{js,ts}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // O processo principal carrega modulos pesados com require() tardio de
    // proposito: uma falha de import chega ao log em vez de derrubar o app
    // antes do primeiro log (ver comentarios em main/index.ts e updater.ts).
    files: ['apps/desktop/src/main/**/*.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Scripts de build em CommonJS.
    files: ['apps/desktop/scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
