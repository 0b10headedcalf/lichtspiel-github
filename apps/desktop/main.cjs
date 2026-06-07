'use strict';

/**
 * Lichtspiel Electron main process.
 *
 * Hosts the two local halves of the stack in one window:
 *   - renderer  → the built p5 runtime (build/renderer), loaded over file://
 *   - main      → the Node live-bridge (build/bridge/bridge.cjs), required in-process
 *
 * The renderer connects to the bridge at ws://127.0.0.1:7890 (baked in at p5
 * build time). serialosc (monome) and Ableton/Max remain external: the app talks
 * to them over localhost exactly as the dev stack does.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// The .app bundle is read-only, but the bridge persists Ableton mappings to disk.
// Redirect that store to a writable per-user dir before the bridge module loads.
const mappingsDir = path.join(app.getPath('userData'), 'ableton-mappings');
try {
  fs.mkdirSync(mappingsDir, { recursive: true });
} catch (_) {
  /* best effort — the store also mkdirs on save */
}
process.env.LICHTSPIEL_MAPPINGS_DIR ||= mappingsDir;
process.env.LICHTSPIEL_BIND_HOST ||= '127.0.0.1';

let bridgeLoaded = false;
function startBridge() {
  if (bridgeLoaded) return;
  bridgeLoaded = true;
  try {
    // Requiring the bundle runs its top-level code: WS :7890, HTTP :7891,
    // the Max OSC router, and the serialosc monome layer.
    require(path.join(__dirname, 'build', 'bridge', 'bridge.cjs'));
    console.log('[lichtspiel] live-bridge started on 127.0.0.1:7890');
  } catch (err) {
    // The p5 runtime works browser-only, so a bridge failure (e.g. port already
    // in use) must not take the visuals down — just log and carry on.
    console.error('[lichtspiel] live-bridge failed to start:', err && err.message ? err.message : err);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    title: 'Lichtspiel',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'build', 'renderer', 'index.html'));

  // Any external link opens in the system browser, not inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  startBridge();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
