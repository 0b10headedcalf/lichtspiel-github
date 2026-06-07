/**
 * Resolved runtime configuration.
 *
 * `loadConfig` is PURE over its `env` argument so tests can pass a fake env and
 * assert the app runs with NO `.env` at all. Entry points call `dotenv.config()`
 * before invoking this; we only read here. Values are coerced with safe defaults,
 * validated with Zod, then frozen.
 */
import { z } from 'zod';

const SafetyConfigSchema = z.object({
  maxPromptUpdatesPerSecond: z.number().positive(),
  maxParamUpdatesPerSecond: z.number().positive(),
  deadband: z.number().min(0).max(1),
  smoothingMs: z.number().min(0),
  staleMessageMs: z.number().min(0),
  maxVisualToAudioModDepth: z.number().min(0).max(1),
  quantizePromptChanges: z.enum(['next_bar', 'immediate']),
});
export type SafetyConfig = z.infer<typeof SafetyConfigSchema>;

/** The exact defaults from the project spec — asserted in safetyController.test.ts. */
export const SAFETY_DEFAULTS: SafetyConfig = Object.freeze({
  maxPromptUpdatesPerSecond: 4,
  maxParamUpdatesPerSecond: 10,
  deadband: 0.03,
  smoothingMs: 250,
  staleMessageMs: 2000,
  maxVisualToAudioModDepth: 0.15,
  quantizePromptChanges: 'next_bar',
});

const AppConfigSchema = z.object({
  bridgePort: z.number().int().positive(),
  enableLichtspielClient: z.boolean(),
  lichtspielWsUrl: z.string().min(1),
  mockWs: z.object({ host: z.string().min(1), port: z.number().int().positive() }),
  enableMrt2Real: z.boolean(),
  enableMockMrt2: z.boolean(),
  enableMockAbleton: z.boolean(),
  enableMockMonome: z.boolean(),
  magentaHome: z.string(),
  mrt2Model: z.string().min(1),
  mrt2SidecarCmd: z.string().min(1),
  transport: z.object({ bpm: z.number().positive(), beatsPerBar: z.number().int().positive() }),
  safety: SafetyConfigSchema,
  log: z.object({ level: z.string().min(1), pretty: z.boolean() }),
  sessionId: z.string().min(1),
  promptMapFile: z.string().min(1),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v.trim() === '') return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}
function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v.trim() === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v: string | undefined, dflt: string): string {
  if (v === undefined || v === '') return dflt;
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cfg: AppConfig = {
    bridgePort: num(env.BRIDGE_PORT, 8787),
    enableLichtspielClient: bool(env.ENABLE_LICHTSPIEL_CLIENT, false),
    lichtspielWsUrl: str(env.LICHTSPIEL_WS_URL, 'ws://127.0.0.1:7890'),
    mockWs: {
      host: str(env.BRIDGE_MOCK_WS_HOST, '127.0.0.1'),
      port: num(env.BRIDGE_MOCK_WS_PORT, 8765),
    },
    enableMrt2Real: bool(env.ENABLE_MRT2_REAL, false),
    enableMockMrt2: bool(env.ENABLE_MOCK_MRT2, true),
    enableMockAbleton: bool(env.ENABLE_MOCK_ABLETON, true),
    enableMockMonome: bool(env.ENABLE_MOCK_MONOME, true),
    magentaHome: str(env.MAGENTA_HOME, ''),
    // mrt2_small runs real-time via the Python/MLX sidecar; mrt2_base is ~1.9x
    // too slow that way and needs the native C++ engine. Default to the live one.
    mrt2Model: str(env.MRT2_MODEL, 'mrt2_small'),
    mrt2SidecarCmd: str(env.MRT2_SIDECAR_CMD, 'python3 sidecar/mrt2_sidecar.py'),
    transport: {
      bpm: num(env.BRIDGE_BPM, 120),
      beatsPerBar: num(env.BRIDGE_BEATS_PER_BAR, 4),
    },
    safety: {
      maxPromptUpdatesPerSecond: num(env.SAFETY_MAX_PROMPT_UPS, SAFETY_DEFAULTS.maxPromptUpdatesPerSecond),
      maxParamUpdatesPerSecond: num(env.SAFETY_MAX_PARAM_UPS, SAFETY_DEFAULTS.maxParamUpdatesPerSecond),
      deadband: num(env.SAFETY_DEADBAND, SAFETY_DEFAULTS.deadband),
      smoothingMs: num(env.SAFETY_SMOOTHING_MS, SAFETY_DEFAULTS.smoothingMs),
      staleMessageMs: num(env.SAFETY_STALE_MS, SAFETY_DEFAULTS.staleMessageMs),
      maxVisualToAudioModDepth: num(env.SAFETY_MAX_V2A_MOD_DEPTH, SAFETY_DEFAULTS.maxVisualToAudioModDepth),
      quantizePromptChanges:
        str(env.SAFETY_QUANTIZE, SAFETY_DEFAULTS.quantizePromptChanges) === 'immediate' ? 'immediate' : 'next_bar',
    },
    log: {
      level: str(env.LOG_LEVEL, 'info'),
      pretty: bool(env.LOG_PRETTY, true),
    },
    sessionId: str(env.SESSION_ID, 'demo-session'),
    promptMapFile: str(env.PROMPT_MAP_FILE, './src/demo/prompt-map.example.json'),
  };
  return Object.freeze(AppConfigSchema.parse(cfg));
}
