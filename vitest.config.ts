import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests share one SQLite connection (re-pointed per test), so run files sequentially.
    fileParallelism: false,
    // Let Vite resolve next-auth's extensionless "next/server" import.
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'next/server': 'next/server.js',
    },
  },
});
