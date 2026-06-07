/**
 * LineageTracker — the causal-loop-prevention substrate.
 *
 * Every BridgeMessage carries causeId / parentCauseId. We track, per cause, the
 * ordered list of source `kinds` traversed from the lineage root. The safe DAG:
 *
 *   external (ableton|monome) -> core -> { audio prompt, visual }
 *   metrics  (mrt2)           -> core -> visual ONLY
 *   visual   (lichtspiel)     -> core -> audio PARAM only, bounded + terminal
 *
 * `wouldLoop` enforces it: an audio prompt may not originate from a metrics or
 * visual lineage; an audio param may not originate from a metrics lineage; and
 * a runaway depth always breaks.
 */
import type { Clock } from './clock.js';
import type { CauseRef, Source } from '../schemas/wire.js';

export type TargetKind = 'audio-prompt' | 'audio-param' | 'visual';

interface ChainNode {
  causeId: string;
  parentCauseId?: string;
  kinds: Source[];
  depth: number;
  born: number;
}

export class LineageTracker {
  private readonly chains = new Map<string, ChainNode>();
  private counter = 0;

  constructor(
    private readonly clock: Clock,
    private readonly prefix = 'c',
    private readonly maxDepth = 8,
    private readonly ttlMs = 5000,
  ) {}

  private id(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }

  /** Start a fresh lineage for an external trigger. */
  newRoot(kind: Source): CauseRef {
    this.gc();
    const causeId = this.id();
    this.chains.set(causeId, { causeId, kinds: [kind], depth: 0, born: this.clock.now() });
    return { causeId };
  }

  /** Derive a child cause, recording the source kind traversed. */
  derive(parent: CauseRef | undefined, kind: Source): CauseRef {
    const causeId = this.id();
    const parentNode = parent ? this.chains.get(parent.causeId) : undefined;
    const kinds = parentNode ? [...parentNode.kinds, kind] : [kind];
    const depth = parentNode ? parentNode.depth + 1 : 0;
    const node: ChainNode = { causeId, kinds, depth, born: this.clock.now() };
    if (parent) node.parentCauseId = parent.causeId;
    this.chains.set(causeId, node);
    return parent ? { causeId, parentCauseId: parent.causeId } : { causeId };
  }

  /** True if emitting `target` derived from `ref`'s lineage would loop. */
  wouldLoop(ref: CauseRef | undefined, target: TargetKind): boolean {
    if (!ref) return false;
    const node = this.chains.get(ref.causeId);
    if (!node) return false;
    if (node.depth >= this.maxDepth) return true;
    if (target === 'audio-prompt' && (node.kinds.includes('mrt2') || node.kinds.includes('lichtspiel'))) {
      return true;
    }
    if (target === 'audio-param' && node.kinds.includes('mrt2')) return true;
    if (target === 'visual' && node.kinds.filter((k) => k === 'lichtspiel').length >= 2) return true;
    return false;
  }

  gc(): void {
    const now = this.clock.now();
    for (const [id, node] of this.chains) {
      if (now - node.born > this.ttlMs) this.chains.delete(id);
    }
  }

  /** Inspection helper (tests). */
  size(): number {
    return this.chains.size;
  }
}
