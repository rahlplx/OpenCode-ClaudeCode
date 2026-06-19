import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Only lint our own server/cli code; Kanna client + shared files are verbatim and must not be modified
  {
    files: ['src/server/**/*.ts', 'src/cli/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/', 'dist-cli/', 'dist-electron/', 'android/', 'node_modules/'],
  },
);
