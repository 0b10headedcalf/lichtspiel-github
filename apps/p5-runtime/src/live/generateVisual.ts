/**
 * Webui hook for the generative track (G1/G3): one "Generate" button →
 * audio file → ml-service POST /generate → a freshly written p5 template.
 *
 * This is an AUTHORING action (build-time), deliberately segregated from the
 * performance runtime — it reaches the ml-service over plain HTTP and is only
 * called from a user gesture, never on the render path (AGENTS.md runtime-purity).
 *
 * The ml-service runs the heavy work (vibe → Claude codegen) and writes the
 * `.ts` file into apps/p5-runtime/src/templates/generated/. main.ts then
 * dynamic-imports that file from the Vite dev server and registers it, so the
 * new visual loads into the running app without a manual reload (dev only).
 */

const ML_URL = `http://${__BIND_HOST__}:${__ML_PORT__}`;

/** sync = audio → vibe → template; dream = prompt-only → template (no audio). */
export type GenerateMode = 'sync' | 'dream';

export interface GenerateRequest {
  /** sync (default) conditions on audio; dream conditions purely on `prompt`. */
  mode?: GenerateMode;
  /**
   * Absolute path to the exported audio clip (sync only). Omit to let the
   * ml-service pick the newest clip in the watched folder (LICHTSPIEL_AUDIO_WATCH_DIR).
   */
  audioFilePath?: string;
  /** Steering prompt — required for dream, optional steering for sync. */
  prompt?: string;
  /** 0 = stay-close mutation … 1 = bold novel template. */
  divergence?: number;
}

export interface GenerateResponse {
  ok: boolean;
  mode?: GenerateMode;
  vibe?: { text: string; tags: Record<string, string[]>; features: Record<string, unknown>; sources: string[] };
  templateId?: string;
  templatePath?: string;
  model?: string;
  issues?: string[];
  code?: string;
  error?: string;
}

/** Fire the audio → vibe → template pipeline. Throws on transport failure. */
export async function generateVisual(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${ML_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ divergence: 0.6, ...req }),
  });
  if (!res.ok) {
    return { ok: false, error: `ml-service ${res.status}: ${await res.text()}` };
  }
  return (await res.json()) as GenerateResponse;
}
