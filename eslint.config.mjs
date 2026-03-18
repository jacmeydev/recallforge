import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    ignores: [
      '.next/**',
      '.tmp/**',
      'data/**',
      'node_modules/**',
      'coverage/**',
      'public/sw.js',
      'tsconfig.tsbuildinfo',
    ],
  },
  {
    files: ['src/app/(app)/browser/page.tsx'],
    rules: {
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    files: ['src/app/(app)/study/[deckId]/page.tsx'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];

export default config;
