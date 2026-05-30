/**
 * Template registry — the ordered catalog of visual templates. The order
 * defines keyboard slots (1..N) and monome grid columns (Phase 4).
 */

import type { VisualTemplateMeta } from '@lichtspiel/schemas';
import type { VisualTemplate } from './visualTemplate.js';

export class TemplateRegistry {
  private readonly byId = new Map<string, VisualTemplate>();
  private readonly order: VisualTemplate[] = [];

  register(template: VisualTemplate): void {
    if (this.byId.has(template.id)) {
      console.warn(`[registry] duplicate template id "${template.id}" ignored`);
      return;
    }
    this.byId.set(template.id, template);
    this.order.push(template);
  }

  registerAll(templates: readonly VisualTemplate[]): void {
    for (const t of templates) this.register(t);
  }

  get(id: string): VisualTemplate | undefined {
    return this.byId.get(id);
  }

  at(index: number): VisualTemplate | undefined {
    return this.order[index];
  }

  indexOf(id: string): number {
    return this.order.findIndex((t) => t.id === id);
  }

  /** Wrap-around neighbor (delta = +1 / -1) for next/prev cycling. */
  neighbor(id: string, delta: number): VisualTemplate | undefined {
    if (this.order.length === 0) return undefined;
    const i = this.indexOf(id);
    const base = i < 0 ? 0 : i;
    const n = ((base + delta) % this.order.length + this.order.length) % this.order.length;
    return this.order[n];
  }

  all(): readonly VisualTemplate[] {
    return this.order;
  }

  /** Serializable metadata for every template (for the bridge/ml catalog). */
  catalog(): VisualTemplateMeta[] {
    return this.order.map(({ create: _create, ...meta }) => meta);
  }

  get size(): number {
    return this.order.length;
  }
}
