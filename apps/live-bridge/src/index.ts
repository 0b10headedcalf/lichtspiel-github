/**
 * live-bridge entry point. Starts the WebSocket hub + a small HTTP status
 * route, the Max OSC router (Phase 3), and the serialosc monome layer
 * (Phase 4). Bound to loopback by default for security.
 */

import { createServer } from 'node:http';
import { wire } from '@lichtspiel/schemas';
import { BridgeServer } from './websocketServer.js';
import { OscRouter } from './oscRouter.js';
import { SerialOsc } from './serialosc.js';
import { logger } from './log.js';

const host = process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1';
const wsPort = Number(process.env['LICHTSPIEL_BRIDGE_WS_PORT'] ?? 7890);
const httpPort = Number(process.env['LICHTSPIEL_BRIDGE_HTTP_PORT'] ?? 7891);
const prefix = process.env['LICHTSPIEL_OSC_PREFIX'] ?? '/lichtspiel';

// `serial` is wired into the hub's LED sink below; declared first to break the
// hub ⇄ serialosc reference cycle (the closure runs only after assignment).
let serial: SerialOsc | undefined;

const server = new BridgeServer({
  host,
  port: wsPort,
  // led.frame from p5 (templates + digital twin) → real monome LEDs.
  onLedFrame: (frame) => serial?.flushLeds(frame),
});
server.start();

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
