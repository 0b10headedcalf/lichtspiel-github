import { defineConfig } from 'vitest/config';

// Scope tests to the TypeScript sources only. Without this, a prior `pnpm build`
// leaves compiled `dist/tests/*.test.js` that vitest 4 would otherwise pick up
// (and which fail — tsc doesn't copy the JSON fixture into dist).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
