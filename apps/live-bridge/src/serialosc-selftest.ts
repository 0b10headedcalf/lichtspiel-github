/**
 * serialosc self-test — exercises the whole monome layer with NO hardware by
 * faking the serialosc daemon + two device endpoints (a Grid 64 and an Arc 2).
 * Asserts:
 *   1. discovery → device.attached for grid (8×8) + arc (2 enc);
 *   2. inbound /lichtspiel/grid/key + /enc/key route to the right deviceId
 *      (by UDP source port);
 *   3. a flurry of /enc/delta is coalesced into one summed arc.delta per tick;
 *   4. caps-aware LED flush: a monobright grid gets /grid/led/map (binarized)
 *      + /grid/led/intensity; an arc gets /ring/map.
 * Run: pnpm --filter @lichtspiel/live-bridge test:serialosc
 */

import { createSocket, type Socket } from 'node:dgram';
import type { DeviceAttached, MonomeEvent } from '@lichtspiel/schemas';
import { SerialOsc } from './serialosc.js';
import { decodeOscMessage, encodeOscMessage, type OscMessage } from './oscCodec.js';

const HOST = '127.0.0.1';
const APP_PORT = 7404; // SerialOsc binds here (scenario 1)
const DAEMON_PORT = 7405; // fake serialosc daemon
const GRID_PORT = 7406; // fake Grid 64 endpoint
const ARC_PORT = 7407; // fake Arc 2 endpoint
// scenario 2 (varibright Grid 128) — isolated ports
const APP_PORT2 = 7414;
const DAEMON_PORT2 = 7415;
const GRID128_PORT = 7416;
// scenario 3 (reconcile detach) — isolated ports
const APP_PORT3 = 7424;
const DAEMON_PORT3 = 7425;
const GRID_PORT3 = 7426;
const ARC_PORT3 = 7427;
const PREFIX = '/lichtspiel';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A fake serialosc endpoint: records what it receives, can send back to the app. */
interface Fake {
  sock: Socket;
  received: OscMessage[];
  send: (address: string, args: Array<string | number>) => void;
  has: (address: string) => OscMessage | undefined;
  close: () => void;
}

function makeFake(
  port: number,
  appPort: number,
  onMessage?: (m: OscMessage, f: Fake) => void,
): Promise<Fake> {
  return new Promise((resolve) => {
    const sock = createSocket('udp4');
    const received: OscMessage[] = [];
    const fake: Fake = {
      sock,
      received,
      send: (address, args) => sock.send(encodeOscMessage(address, args), appPort, HOST),
      has: (address) => received.find((m) => m.address === address),
      close: () => {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
      },
    };
    sock.on('message', (buf) => {
      const m = decodeOscMessage(buf);
      if (!m) return;
      received.push(m);
      onMessage?.(m, fake);
    });
    sock.bind(port, HOST, () => resolve(fake));
  });
}

async function main(): Promise<void> {
  let failures = 0;
  const check = (ok: boolean, label: string): void => {
    console.log(ok ? `✓ ${label}` : `✗ ${label}`);
    if (!ok) failures++;
  };

  // ── fake daemon: answers /serialosc/list with our two devices ──
  const daemon = await makeFake(DAEMON_PORT, APP_PORT, (m, f) => {
    if (m.address === '/serialosc/list') {
      f.send('/serialosc/device', ['m64_0175', 'monome 64', GRID_PORT]);
      f.send('/serialosc/device', ['m0000174', 'monome arc 2', ARC_PORT]);
    }
  });
  // ── fake grid: replies to /sys/info with its size ──
  const grid = await makeFake(GRID_PORT, APP_PORT, (m, f) => {
    if (m.address === '/sys/info') f.send('/sys/size', [8, 8]);
  });
  // ── fake arc: just records ──
  const arc = await makeFake(ARC_PORT, APP_PORT);

  // ── the real layer under test ──
  const attached: DeviceAttached[] = [];
  const events: MonomeEvent[] = [];
  const serial = new SerialOsc({
    host: HOST,
    serialoscPort: DAEMON_PORT,
    appPort: APP_PORT,
    prefix: PREFIX,
    autoRecover: false, // never restart the real serialosc daemon during tests
    relistMs: 60_000, // don't re-poll during the test
    onDeviceAttached: (d) => attached.push(d),
    onDeviceDetached: () => {},
    onMonomeEvent: (e) => events.push(e),
  });
  serial.start();
  await sleep(250); // discovery + /sys round-trip

  // 1. discovery → both devices attached, resolved from their serials
  const g = attached.find((d) => d.id === 'm64_0175');
  const a = attached.find((d) => d.id === 'm0000174');
  check(!!g && g.kind === 'grid' && g.rows === 8 && g.cols === 8, 'grid attached as 8×8');
  check(!!a && a.kind === 'arc' && a.encoders === 2, 'arc attached as 2 enc');
  check(attached.filter((d) => d.id === 'm64_0175').length === 1, 'grid attached exactly once (dedup)');

  // device config reached the hardware endpoints
  check(grid.has(`${PREFIX}/grid/led/intensity`)?.args[0] === 15, 'grid got global intensity 15');
  check(grid.has('/sys/prefix')?.args[0] === PREFIX, 'grid got /sys/prefix');
  check(grid.has('/sys/port')?.args[0] === APP_PORT, 'grid got /sys/port');

  // 2. inbound key events route to the right deviceId (by source port)
  grid.send(`${PREFIX}/grid/key`, [3, 4, 1]);
  arc.send(`${PREFIX}/enc/key`, [1, 1]);
  await sleep(80);
  const gk = events.find((e) => e.type === 'grid.key');
  check(
    !!gk && gk.deviceId === 'm64_0175' && gk.type === 'grid.key' && gk.x === 3 && gk.y === 4 && gk.state === 1,
    'grid.key routed to m64_0175 (3,4,down)',
  );
  const ak = events.find((e) => e.type === 'arc.key');
  check(!!ak && ak.deviceId === 'm0000174' && ak.type === 'arc.key' && ak.encoder === 1, 'arc.key routed to m0000174');

  // 3. a flurry of deltas coalesces into one summed arc.delta
  events.length = 0;
  arc.send(`${PREFIX}/enc/delta`, [0, 2]);
  arc.send(`${PREFIX}/enc/delta`, [0, 3]);
  arc.send(`${PREFIX}/enc/delta`, [0, -1]);
  await sleep(80);
  const deltas = events.filter((e) => e.type === 'arc.delta');
  const d0 = deltas[0];
  check(
    deltas.length === 1 && !!d0 && d0.type === 'arc.delta' && d0.encoder === 0 && d0.delta === 4,
    'arc deltas coalesced to one (+2+3-1 = +4)',
  );

  // 4. caps-aware LED flush. Build a ramp: col x → level round(x/7*15).
  //    Levels [0,2,4,6,9,11,13,15]; binarized at ≥8 → cols 4..7 on → row mask 0xF0.
  grid.received.length = 0;
  arc.received.length = 0;
  const ramp = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, x) => Math.round((x / 7) * 15)));
  const ring = Array.from({ length: 64 }, (_, i) => i % 16); // 0..15 repeating
  serial.flushLeds({ grid: ramp, arc: [ring, ring] });
  await sleep(80);
  const gmap = grid.has(`${PREFIX}/grid/led/map`);
  check(!!gmap && gmap.args[0] === 0 && gmap.args[1] === 0, 'grid flushed via /grid/led/map quad (0,0)');
  check(!!gmap && gmap.args.slice(2).every((v) => v === 0xf0), 'monobright binarize → every row mask = 0xF0');
  check(!grid.has(`${PREFIX}/grid/led/level/map`), 'monobright grid did NOT use varibright level/map');
  const rmap = arc.has(`${PREFIX}/ring/map`);
  check(!!rmap && rmap.args[0] === 0 && rmap.args.length === 1 + 64, 'arc flushed via /ring/map ring 0 (64 levels)');

  // 5. gridIntensity flushes the global dimmer, deduped (must survive the
  //    flushLeds merge even when the frame omits grid/arc).
  const intensityMsgs = (): number[] =>
    grid.received.filter((m) => m.address === `${PREFIX}/grid/led/intensity`).map((m) => Number(m.args[0]));
  grid.received.length = 0;
  serial.flushLeds({ gridIntensity: 7 });
  await sleep(80);
  check(intensityMsgs().join() === '7', 'gridIntensity 7 → /grid/led/intensity 7 (survives merge)');
  grid.received.length = 0;
  serial.flushLeds({ gridIntensity: 7 }); // unchanged → deduped
  serial.flushLeds({ gridIntensity: 12 }); // changed → sent
  await sleep(80);
  check(intensityMsgs().join() === '12', 'gridIntensity deduped (7 skipped), 12 sent');

  serial.stop();
  daemon.close();
  grid.close();
  arc.close();
  await sleep(50);

  // ── Scenario 2: a VARIBRIGHT Grid 128 uses the level/map path (not binary) ──
  const daemon2 = await makeFake(DAEMON_PORT2, APP_PORT2, (m, f) => {
    if (m.address === '/serialosc/list') {
      f.send('/serialosc/device', ['m29496721', 'monome 128', GRID128_PORT]);
    }
  });
  const grid128 = await makeFake(GRID128_PORT, APP_PORT2, (m, f) => {
    if (m.address === '/sys/info') f.send('/sys/size', [16, 8]);
  });
  const attached2: DeviceAttached[] = [];
  const serial2 = new SerialOsc({
    host: HOST,
    serialoscPort: DAEMON_PORT2,
    appPort: APP_PORT2,
    prefix: PREFIX,
    autoRecover: false, // never restart the real serialosc daemon during tests
    relistMs: 60_000,
    onDeviceAttached: (d) => attached2.push(d),
    onDeviceDetached: () => {},
    onMonomeEvent: () => {},
  });
  serial2.start();
  await sleep(250);
  const g128 = attached2.find((d) => d.id === 'm29496721');
  check(!!g128 && g128.cols === 16 && g128.rows === 8, 'grid128 attached as 16×8');
  grid128.received.length = 0;
  // full-on 8×16 frame → varibright grid flushes /grid/led/level/map for BOTH quads
  const full = Array.from({ length: 8 }, () => new Array<number>(16).fill(15));
  serial2.flushLeds({ grid: full });
  await sleep(80);
  const levelMaps = grid128.received.filter((m) => m.address === `${PREFIX}/grid/led/level/map`);
  check(levelMaps.length === 2, 'varibright grid128 → 2× /grid/led/level/map (one per quad)');
  check(
    levelMaps.some((m) => m.args[0] === 0) && levelMaps.some((m) => m.args[0] === 8),
    'level/map quads at x-offset 0 and 8',
  );
  check(
    !grid128.has(`${PREFIX}/grid/led/map`),
    'varibright grid128 did NOT use the monobright bitmask map',
  );
  // Diffing: re-flushing the SAME frame must send nothing (this is what stops
  // the 30 Hz emit from hammering a device — the Arc 4 clone's failure mode).
  grid128.received.length = 0;
  serial2.flushLeds({ grid: full });
  await sleep(80);
  check(
    grid128.received.filter((m) => m.address === `${PREFIX}/grid/led/level/map`).length === 0,
    'diffing: unchanged frame re-flush sends nothing',
  );
  // A changed quad does send.
  const changed = full.map((row) => row.slice());
  changed[0]![0] = 0;
  serial2.flushLeds({ grid: changed });
  await sleep(80);
  check(
    grid128.received.filter((m) => m.address === `${PREFIX}/grid/led/level/map`).length === 1,
    'diffing: a changed quad re-sends (only the changed one)',
  );
  serial2.stop();
  daemon2.close();
  grid128.close();
  await sleep(50);

  // ── Scenario 3: a device unplugged WITHOUT a /serialosc/remove is still
  //    detached, because the periodic re-list reconciles what's advertised. ──
  let listCount3 = 0;
  const daemon3 = await makeFake(DAEMON_PORT3, APP_PORT3, (m, f) => {
    if (m.address === '/serialosc/list') {
      listCount3++;
      // first poll: grid + arc; later polls: grid "unplugged" (arc only)
      if (listCount3 === 1) f.send('/serialosc/device', ['m64_0175', 'monome 64', GRID_PORT3]);
      f.send('/serialosc/device', ['m0000174', 'monome arc 2', ARC_PORT3]);
    }
  });
  const grid3 = await makeFake(GRID_PORT3, APP_PORT3, (m, f) => {
    if (m.address === '/sys/info') f.send('/sys/size', [8, 8]);
  });
  const arc3 = await makeFake(ARC_PORT3, APP_PORT3);
  const attached3: DeviceAttached[] = [];
  const detached3: string[] = [];
  const serial3 = new SerialOsc({
    host: HOST,
    serialoscPort: DAEMON_PORT3,
    appPort: APP_PORT3,
    prefix: PREFIX,
    autoRecover: false, // never restart the real serialosc daemon during tests
    relistMs: 600, // > POLL_WINDOW_MS so each poll's reconcile runs between polls
    onDeviceAttached: (d) => attached3.push(d),
    onDeviceDetached: (d) => detached3.push(d.id),
    onMonomeEvent: () => {},
  });
  serial3.start();
  await sleep(300); // first poll attaches both
  check(
    attached3.some((d) => d.id === 'm64_0175') && attached3.some((d) => d.id === 'm0000174'),
    'reconcile: grid64 + arc2 attached on first poll',
  );
  await sleep(1700); // later polls omit the grid → after DETACH_MISSES, reconcile detaches it
  check(detached3.includes('m64_0175'), 'reconcile: unplugged grid64 detached (no /serialosc/remove)');
  check(!detached3.includes('m0000174'), 'reconcile: still-listed arc2 NOT detached');
  serial3.stop();
  daemon3.close();
  grid3.close();
  arc3.close();
  await sleep(50);

  if (failures > 0) {
    console.error(`\n${failures} serialosc self-test(s) failed`);
    process.exit(1);
  }
  console.log('\nserialosc self-test OK — discovery, routing, coalescing, caps-aware LED flush all work');
  process.exit(0);
}

main().catch((err) => {
  console.error('serialosc self-test crashed:', err);
  process.exit(1);
});
