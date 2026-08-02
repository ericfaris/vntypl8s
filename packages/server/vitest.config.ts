import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@vntypl8s/shared': new URL('../shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
