/**
 * live-bridge entry point. Starts the WebSocket hub + a small HTTP status
 * route. OSC routing (Max + serialosc) is constructed but stubbed until
 * Phase 3/4. Bound to loopback by default for security.
 */

import { createServer } from 'node:http';
import { BridgeServer } from './websocketServer.js';
import { OscRouter } from './oscRouter.js';
import { logger } from './log.js';

const host = process.env['LICHTSPIEL_BIND_HOST'] ?? '127.0.0.1';
const wsPort = Number(process.env['LICHTSPIEL_BRIDGE_WS_PORT'] ?? 7890);
const httpPort = Number(process.env['LICHTSPIEL_BRIDGE_HTTP_PORT'] ?? 7891);

const server = new BridgeServer({ host, port: wsPort });
server.start();

const osc = new OscRouter({
  host,
  maxToBridgePort: Number(process.env['LICHTSPIEL_OSC_MAX_TO_BRIDGE_PORT'] ?? 7400),
  bridgeToMaxPort: Number(process.env['LICHTSPIEL_OSC_BRIDGE_TO_MAX_PORT'] ?? 7401),
  serialoscPort: Number(process.env['LICHTSPIEL_SERIALOSC_PORT'] ?? 12002),
  onMessage: () => {
    /* Phase 3/4: feed decoded OSC into the hub */
  },
});
osc.start();

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
  http.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
