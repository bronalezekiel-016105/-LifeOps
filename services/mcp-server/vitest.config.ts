import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pin an inline (empty) PostCSS config so Vite does NOT walk up the
  // directory tree searching for a postcss.config.js. This MCP server has
  // no CSS; without this, a stray postcss.config.js in a parent folder
  // (e.g. C:\Users\PC\Downloads) can hijack the test run.
  css: { postcss: {} },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks', // isolate DB state per test file
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
  },
});
