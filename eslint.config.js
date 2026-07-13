// Flat ESLint config, shared by every workspace. Each package's `lint` script runs
// `eslint .` and resolves this file via ancestor lookup. Type-aware rules are intentionally
// omitted: `tsc` already provides full type checking, so lint stays fast and never needs a
// per-file `parserOptions.project`. The no-`any` guarantee is enforced syntactically below.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/build/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // TypeScript resolves identifiers; core no-undef only produces false positives here.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
