import { defineConfig } from 'vite';

const port = Number(process.env['LICHTSPIEL_P5_DEV_PORT'] ?? 5273);

export default defineConfig({
  server: {
    port,
    host: process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1',
    strictPort: false,
    // Generated templates are written by the ml-service WHILE the app runs, then
    // dynamic-imported (?t= cache-bust). Once imported they're in the module
    // graph, so the watcher's late add/change event triggers a FULL PAGE RELOAD
    // seconds after the hot-load — wiping the freshly mounted sketch. They never
    // need HMR (a regen imports a fresh ?t= URL), so don't watch them.
    watch: { ignored: ['**/templates/generated/**'] },
  },
  // Inline env so the runtime can read bridge port etc. at build time.
  define: {
    __BRIDGE_WS_PORT__: JSON.stringify(process.env['LICHTSPIEL_BRIDGE_WS_PORT'] ?? '7890'),
    __BIND_HOST__: JSON.stringify(process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1'),
    __ML_PORT__: JSON.stringify(process.env['LICHTSPIEL_ML_PORT'] ?? '7892'),
  },
});
