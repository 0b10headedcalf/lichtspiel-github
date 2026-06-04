/**
 * Headless smoke for the Phase 5b mapping layer — the pure resolver
 * (`resolveActivation`) + snapshot merge (`mergeSnapshot`). No p5, no DOM, no
 * bridge: build a tiny registry of stub templates, then assert the
 * parent-template → child-variant rules and the edit-preserving merge. Run via
 * tsx; wired into `pnpm smoke`.
 */

import { type AbletonMapping, type AbletonSnapshot, makeDefaultRow, signatureOf } from '@lichtspiel/schemas';
import { TemplateRegistry } from '../src/templateRegistry.js';
import type { VisualTemplate } from '../src/visualTemplate.js';
import { type AbletonEvent, resolveActivation } from '../src/live/abletonRetrieval.js';
import { mergeSnapshot } from '../src/live/abletonMappings.js';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

/** Minimal VisualTemplate stub (the create factory is never called here). */
function stub(id: string): VisualTemplate {
  return {
    id,
    name: id.toUpperCase(),
    family: id,
    description: '',
    tags: [],
    defaultParams: {},
    create: () => ({ setup() {}, update() {}, draw() {} }),
  };
}
function registryOf(...ids: string[]): TemplateRegistry {
  const r = new TemplateRegistry();
  r.registerAll(ids.map(stub));
  return r;
}

const sceneEvt = (index: number, name: string): AbletonEvent => ({ kind: 'scene', index, name });
const locEvt = (index: number, name: string): AbletonEvent => ({ kind: 'locator', index, name });
const rnd0 = (): number => 0; // deterministic: always pick the first element of a pool

console.log('mapping resolver:');
{
  const reg = registryOf('a', 'b', 'c');

  const m1: AbletonMapping = {
    version: '0.1.0',
    setName: 't',
    updatedAt: '',
    session: { scenes: [] },
    arrangement: {
      locators: [
        { index: 2, name: 'Drop', time: 72, enabled: true, templateMode: 'fixed', templateId: 'b', variantMode: 'canonical' },
      ],
    },
  };
  const a1 = resolveActivation(locEvt(2, 'Drop'), m1, 'mapped', reg, undefined, rnd0);
  ok(
    a1.kind === 'activate' && a1.template.id === 'b' && a1.variantMode === 'canonical' && a1.source === 'mapped',
    'fixed row → its template + canonical variant',
  );

  const m2: AbletonMapping = {
    ...m1,
    arrangement: { locators: [{ ...m1.arrangement.locators[0]!, variantMode: 'random' }] },
  };
  const a2 = resolveActivation(locEvt(2, 'Drop'), m2, 'mapped', reg, undefined, rnd0);
  ok(a2.kind === 'activate' && a2.variantMode === 'random', 'fixed row, variantMode random → random variant');

  const m3: AbletonMapping = {
    version: '0.1.0',
    setName: 't',
    updatedAt: '',
    session: { scenes: [] },
    arrangement: { locators: [{ index: 0, name: 'X', enabled: true, templateMode: 'random', variantMode: 'random' }] },
  };
  const a3 = resolveActivation(locEvt(0, 'X'), m3, 'mapped', reg, 'a', rnd0);
  ok(a3.kind === 'activate' && a3.template.id !== 'a' && a3.source === 'mapped', 'random row avoids the last template id');

  const m4: AbletonMapping = {
    version: '0.1.0',
    setName: 't',
    updatedAt: '',
    session: { scenes: [] },
    arrangement: { locators: [{ index: 0, name: 'X', enabled: false, templateMode: 'fixed', templateId: 'b', variantMode: 'canonical' }] },
  };
  const a4 = resolveActivation(locEvt(0, 'X'), m4, 'mapped', reg, undefined, rnd0);
  ok(a4.kind === 'suppressed', 'disabled row → suppressed (event received, swap suppressed)');

  const m5: AbletonMapping = {
    version: '0.1.0',
    setName: 't',
    updatedAt: '',
    session: { scenes: [] },
    arrangement: {
      locators: [
        { index: 0, name: 'Intro', enabled: true, templateMode: 'fixed', templateId: 'a', variantMode: 'canonical' },
        { index: 2, name: 'Drop', time: 72, enabled: true, templateMode: 'fixed', templateId: 'b', variantMode: 'canonical' },
      ],
    },
  };
  const a5 = resolveActivation(locEvt(0, 'Drop'), m5, 'mapped', reg, undefined, rnd0);
  ok(a5.kind === 'activate' && a5.template.id === 'b', 'name match wins over index match');
  const a5b = resolveActivation(locEvt(9, 'drop'), m5, 'mapped', reg, undefined, rnd0);
  ok(a5b.kind === 'activate' && a5b.template.id === 'b', 'name match is case-insensitive');

  const m6: AbletonMapping = {
    version: '0.1.0',
    setName: 't',
    updatedAt: '',
    session: { scenes: [] },
    arrangement: { locators: [{ index: 0, name: 'X', enabled: true, templateMode: 'fixed', templateId: 'zzz', variantMode: 'canonical' }] },
  };
  const a6 = resolveActivation(locEvt(0, 'X'), m6, 'mapped', reg, undefined, rnd0);
  ok(a6.kind === 'activate' && a6.source === 'mapped', 'unknown fixed templateId → graceful (still activates)');

  const a7 = resolveActivation(locEvt(1, 'whatever'), null, 'mapped', reg, undefined, rnd0);
  ok(
    a7.kind === 'activate' && a7.source === 'fallback' && a7.variantMode === 'random',
    'no mapping → Phase-5a fallback + random variant',
  );

  const m8: AbletonMapping = {
    version: '0.1.0',
    setName: 't',
    updatedAt: '',
    session: { scenes: [{ index: 0, name: 'Scene1', enabled: true, templateMode: 'fixed', templateId: 'c', variantMode: 'canonical' }] },
    arrangement: { locators: [{ index: 0, name: 'Scene1', enabled: true, templateMode: 'fixed', templateId: 'a', variantMode: 'canonical' }] },
  };
  const a8 = resolveActivation(sceneEvt(0, 'Scene1'), m8, 'mapped', reg, undefined, rnd0);
  ok(a8.kind === 'activate' && a8.template.id === 'c', 'scene event consults session.scenes (not locators)');

  const a9 = resolveActivation(locEvt(0, 'X'), m1, 'mapped', new TemplateRegistry(), undefined, rnd0);
  ok(a9.kind === 'none', 'empty registry → none');
}

console.log('snapshot merge:');
{
  const snap: AbletonSnapshot = {
    setName: 'ADE_Sleuth',
    scenes: [{ index: 0, name: 'Scene1' }, { index: 1, name: 'Scene2' }],
    locators: [{ index: 0, name: 'Intro', time: 0 }, { index: 1, name: 'Drop', time: 72 }],
  };

  const merged0 = mergeSnapshot(null, snap);
  ok(merged0.arrangement.locators.length === 2 && merged0.session.scenes.length === 2, 'merge(null) → all snapshot rows');
  ok(
    merged0.arrangement.locators.every((r) => r.templateMode === 'random' && r.variantMode === 'random' && r.enabled),
    'new rows default to random/random/enabled',
  );
  ok(merged0.arrangement.locators[1]!.time === 72, 'locator rows carry time');
  ok(merged0.session.scenes[0]!.time === undefined, 'scene rows carry no time');

  const edited: AbletonMapping = {
    ...merged0,
    arrangement: {
      locators: merged0.arrangement.locators.map((r) =>
        r.name === 'Drop'
          ? { ...r, templateMode: 'fixed' as const, templateId: 'b', variantMode: 'canonical' as const, enabled: false }
          : r,
      ),
    },
  };
  const merged1 = mergeSnapshot(edited, snap);
  const drop = merged1.arrangement.locators.find((r) => r.name === 'Drop')!;
  ok(
    drop.templateMode === 'fixed' && drop.templateId === 'b' && drop.variantMode === 'canonical' && drop.enabled === false,
    'merge preserves edited row policy (matched by name)',
  );

  const snap2: AbletonSnapshot = {
    setName: 'ADE_Sleuth',
    scenes: snap.scenes,
    locators: [{ index: 0, name: 'Intro', time: 0 }, { index: 2, name: 'Bridge', time: 120 }], // Drop gone, Bridge new
  };
  const merged2 = mergeSnapshot(merged1, snap2);
  ok(merged2.arrangement.locators.some((r) => r.name === 'Bridge'), 'new locator added on merge');
  const stale = merged2.arrangement.locators.find((r) => r.name === 'Drop');
  ok(!!stale && stale.stale === true, 'vanished locator kept + flagged stale');
  const bridgeRow = merged2.arrangement.locators.find((r) => r.name === 'Bridge')!;
  ok(bridgeRow.templateMode === 'random' && !bridgeRow.stale, 'new locator gets a fresh default row');

  const snap3: AbletonSnapshot = { setName: 'ADE_Sleuth', scenes: snap.scenes, locators: [{ index: 5, name: 'Intro', time: 4 }] };
  const merged3 = mergeSnapshot(merged2, snap3);
  const intro = merged3.arrangement.locators.find((r) => r.name === 'Intro')!;
  ok(intro.index === 5 && intro.time === 4, 'persisted row refreshes index/time on re-snapshot');
}

console.log('set-awareness (signature replace-vs-merge):');
{
  const sigA = signatureOf({ scenes: [{ name: 'S1' }], locators: [{ name: 'Intro', time: 0 }] });
  const sigA2 = signatureOf({ scenes: [{ name: 'S1' }], locators: [{ name: 'Intro', time: 0 }] });
  const sigB = signatureOf({ scenes: [{ name: 'S1' }], locators: [{ name: 'Intro', time: 8 }] });
  ok(sigA === sigA2, 'signatureOf is deterministic for the same structure');
  ok(sigA !== sigB, 'signatureOf differs when a locator time changes');

  const setA: AbletonSnapshot = {
    setName: 'A',
    signature: sigA,
    scenes: [{ index: 0, name: 'S1' }],
    locators: [{ index: 0, name: 'Intro', time: 0 }],
  };
  const mapA = mergeSnapshot(null, setA);
  ok(mapA.setSignature === sigA, 'merge stamps the snapshot signature onto the mapping');

  const editedA: AbletonMapping = {
    ...mapA,
    arrangement: {
      locators: mapA.arrangement.locators.map((r) => ({
        ...r,
        templateMode: 'fixed' as const,
        templateId: 'b',
        enabled: false,
      })),
    },
  };

  // Same signature → MERGE (edits preserved).
  const sameAgain = mergeSnapshot(editedA, { ...setA });
  ok(
    sameAgain.arrangement.locators[0]!.templateMode === 'fixed' && sameAgain.arrangement.locators[0]!.enabled === false,
    'same signature → merges, preserving edits',
  );

  // Different signature (a new set loaded) → REPLACE with fresh defaults; the closed set is discarded.
  const setB: AbletonSnapshot = {
    setName: 'B',
    signature: signatureOf({ scenes: [{ name: 'Verse' }, { name: 'Chorus' }], locators: [] }),
    scenes: [{ index: 0, name: 'Verse' }, { index: 1, name: 'Chorus' }],
    locators: [],
  };
  const replaced = mergeSnapshot(editedA, setB);
  ok(replaced.setSignature === setB.signature, 'different signature → mapping adopts the new set signature');
  ok(
    replaced.session.scenes.length === 2 && replaced.arrangement.locators.length === 0,
    'replace → only the new set rows',
  );
  ok(
    replaced.session.scenes.every((r) => r.templateMode === 'random' && !r.stale),
    'replaced rows are fresh all-random defaults (no stale carryover)',
  );
  ok(!replaced.arrangement.locators.some((r) => r.name === 'Intro'), 'the closed set rows are gone (not flagged stale)');
}

console.log('makeDefaultRow:');
{
  const r = makeDefaultRow({ index: 3, name: 'Q', time: 12 });
  ok(r.enabled && r.templateMode === 'random' && r.variantMode === 'random' && r.time === 12, 'makeDefaultRow → random/random/enabled + time');
  const s = makeDefaultRow({ index: 0, name: 'S' });
  ok(s.time === undefined, 'makeDefaultRow without time → no time field');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} mapping check(s) failed`);
  process.exit(1);
}
