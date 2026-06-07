/**
 * Ableton-facing contracts. Scene launches + transport arrive from either the
 * mock adapter (demo) or, later, the real realtime sensing path
 * (Max device -> OSC -> Lichtspiel live-bridge) / the Ableton SDK metadata path.
 */
import { z } from 'zod';

export const AbletonSceneLaunchedSchema = z.object({
  sceneId: z.string().optional(),
  sceneName: z.string(),
  sceneIndex: z.number().int(),
  bar: z.number().optional(),
  beat: z.number().optional(),
});
export type AbletonSceneLaunched = z.infer<typeof AbletonSceneLaunchedSchema>;

export const AbletonTransportSchema = z.object({
  bar: z.number(),
  beat: z.number(),
  bpm: z.number().positive(),
  playing: z.boolean(),
});
export type AbletonTransport = z.infer<typeof AbletonTransportSchema>;
