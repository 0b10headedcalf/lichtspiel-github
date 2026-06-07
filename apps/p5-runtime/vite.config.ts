import { defineConfig } from 'vite';

const port = Number(process.env['LICHTSPIEL_P5_DEV_PORT'] ?? 5273);

export default defineConfig({
  server: {
    port,
    host: process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1',
    strictPort: false,
  },
  // Inline env so the runtime can read bridge port etc. at build time.
  define: {
    __BRIDGE_WS_PORT__: JSON.stringify(process.env['LICHTSPIEL_BRIDGE_WS_PORT'] ?? '7890'),
    __BIND_HOST__: JSON.stringify(process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1'),
    __ML_PORT__: JSON.stringify(process.env['LICHTSPIEL_ML_PORT'] ?? '7892'),
  },
});
