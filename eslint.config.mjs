import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    ignores: ['.next/**', 'dist/**', '.tmp/**', 'data/**', 'node_modules/**', 'coverage/**', 'tsconfig.tsbuildinfo'],
  },
];

export default config;
