/// <reference types="vite/client" />

// Injected by vite.config.ts `define`.
declare const __BRIDGE_WS_PORT__: string;
declare const __BIND_HOST__: string;

// Tauri v2 global (injected when running in the desktop shell).
interface TauriGlobal {
  core: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  event: {
    listen: (event: string, handler: (evt: { payload: unknown }) => void) => Promise<() => void>;
  };
}

interface Window {
  __TAURI__?: TauriGlobal;
}
