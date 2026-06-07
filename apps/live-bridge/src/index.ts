/**
 * live-bridge entry point. Starts the WebSocket hub + a small HTTP status
 * route, the Max OSC router (Phase 3), and the serialosc monome layer
 * (Phase 4). Bound to loopback by default for security.
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { wire } from '@lichtspiel/schemas';
import { BridgeServer } from './websocketServer.js';
import { MlClient } from './mlClient.js';
import { OscRouter } from './oscRouter.js';
import { SerialOsc } from './serialosc.js';
import { MappingStore } from './mappingStore.js';
import { snapshotAbleton } from './abletonSnapshot.js';
import { logger } from './log.js';

const host = process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1';
const wsPort = Number(process.env['LICHTSPIEL_BRIDGE_WS_PORT'] ?? 7890);
const httpPort = Number(process.env['LICHTSPIEL_BRIDGE_HTTP_PORT'] ?? 7891);
const prefix = process.env['LICHTSPIEL_OSC_PREFIX'] ?? '/lichtspiel';

// Phase 5/7 — retrieval sidecar. The bridge POSTs each live.state to the
// Python ml-service and relays its scene choice to p5. Disable with
// LICHTSPIEL_ML_AUTORETRIEVE=0 (the runtime then stays purely manual/CLI-driven).
const mlPort = Number(process.env['LICHTSPIEL_ML_PORT'] ?? 7892);
const mlAutoRetrieve = process.env['LICHTSPIEL_ML_AUTORETRIEVE'] !== '0';
const mlClient = new MlClient({ host, port: mlPort, enabled: mlAutoRetrieve });

// Phase 5b — Ableton snapshot + mapping persistence. The store owns the
// authoritative JSON files (config/ableton-mappings/*.json); the snapshot reads
// the ableton-mcp Remote Script socket (or the ADE_Sleuth fixture when Ableton is
// unreachable / LICHTSPIEL_SNAPSHOT_FIXTURE=1).
const mappingsDir =
  process.env['LICHTSPIEL_MAPPINGS_DIR'] ??
  fileURLToPath(new URL('../../../config/ableton-mappings', import.meta.url));
const mappingStore = new MappingStore(mappingsDir);
const abletonPort = Number(process.env['LICHTSPIEL_ABLETON_PORT'] ?? 9877);
const forceFixture = process.env['LICHTSPIEL_SNAPSHOT_FIXTURE'] === '1';

// `serial` is wired into the hub's LED sink below; declared first to break the
// hub ⇄ serialosc reference cycle (the closure runs only after assignment).
let serial: SerialOsc | undefined;

const server = new BridgeServer({
  host,
  port: wsPort,
  // led.frame from p5 (templates + digital twin) → real monome LEDs.
  onLedFrame: (frame) => serial?.flushLeds(frame),
  snapshot: () => snapshotAbleton({ abletonPort, forceFixture }),
  mappingStore,
  mlClient,
});
server.start();
// Probe ml-service connectivity once so /status reflects it (retrieval itself
// is driven by inbound live.state; this is just for the status line).
if (mlAutoRetrieve) {
  void mlClient.probeHealth().then(() => {
    logger.info(`ml-service ${mlClient.isConnected ? 'reachable' : 'offline'} at ${host}:${mlPort}`);
  });
}

const osc = new OscRouter({
  host,
  maxToBridgePort: Number(process.env['LICHTSPIEL_OSC_MAX_TO_BRIDGE_PORT'] ?? 7400),
  bridgeToMaxPort: Number(process.env['LICHTSPIEL_OSC_BRIDGE_TO_MAX_PORT'] ?? 7401),
  prefix,
  // OSC from Max is routed into the hub exactly like a WS client message.
  onMessage: (m) => server.ingest(m),
});
osc.start();

// serialosc (monome) → hub. Device events + input flow in via ingest(); LED
// frames flow back out via onLedFrame above.
serial = new SerialOsc({
  host,
  serialoscPort: Number(process.env['LICHTSPIEL_SERIALOSC_PORT'] ?? 12002),
  appPort: Number(process.env['LICHTSPIEL_OSC_APP_PORT'] ?? 13333),
  prefix,
  ...(process.env['LICHTSPIEL_LED_HZ'] ? { ledHz: Number(process.env['LICHTSPIEL_LED_HZ']) } : {}),
  // Auto-restart serialosc when a known device is present at USB but unlisted
  // (recovers the Arc 4 clone's flaky FTDI enumeration). Disable: LICHTSPIEL_SERIALOSC_RECOVER=0.
  autoRecover: process.env['LICHTSPIEL_SERIALOSC_RECOVER'] !== '0',
  ...(process.env['LICHTSPIEL_SERIALOSC_RESTART_CMD']
    ? { recoverCmd: process.env['LICHTSPIEL_SERIALOSC_RESTART_CMD'] }
    : {}),
  onDeviceAttached: (d) => {
    server.ingest(wire('device.attached', d));
    server.setMonomeConnected(true);
  },
  onDeviceDetached: (d) => {
    server.ingest(wire('device.detached', d));
    server.setMonomeConnected((serial?.deviceCount() ?? 0) > 0);
  },
  onMonomeEvent: (e) => server.ingest(wire('monome.event', e)),
});
serial.start();

const http = createServer((req, res) => {
  if (req.url === '/status') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(server.status()));
    return;
  }
  res.setHeader('content-type', 'text/plain');
  res.end('lichtspiel live-bridge — see /status\n');
});
// The status route is non-essential; a port conflict (another bridge already on
// :7891 — e.g. the dev stack while the packaged Electron app launches) must not
// crash the process. Mirror the WS/OSC/serialosc layers: log and carry on.
// Without this, the server's async 'error' is unhandled and throws, killing the
// bridge — and, bundled into apps/desktop, the whole Electron app.
http.on('error', (err) => {
  logger.warn('status http failed to bind (continuing without it)', { error: String(err) });
});
http.listen(httpPort, host, () => {
  logger.info(`status http on http://${host}:${httpPort}/status`);
});

function shutdown(): void {
  logger.info('shutting down');
  server.stop();
  osc.stop();
  serial?.stop();
  http.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
