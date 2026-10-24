import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// src/show/ is the show document and the maths on it: no DOM, no stores, no
// bus. That keeps sampling and limits testable in a bare process, and the
// same code the editor draws with is the code that drives the servos.
const showLayering = {
  files: ['src/show/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/ui/**', '**/stores/**', '**/playback/**', '@ht/stores/**', '@ht/services/**', 'electron*'],
            message: 'show/ is the document and its maths only. Move this dependency up a layer.',
          },
        ],
      },
    ],
  },
}

export default tseslint.config(
  { ignores: ['dist/**', 'dist-web/**', 'dist-electron/**', 'dist-player/**', 'node_modules/**', 'ht-servo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  showLayering,
  {
    files: ['electron/**/*.ts', 'player/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', __dirname: 'readonly', Buffer: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  }
)
