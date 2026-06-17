/**
 * Centralised, strongly-typed configuration loaded from environment variables
 * via the NestJS ConfigModule. No configuration value is hardcoded anywhere
 * else in the codebase — everything funnels through here.
 */
export interface AppConfig {
  port: number;
  streamDelayMs: number;
  streamInitialDelayMs: number;
  streamChunkSize: number;
  /** When replaying recorded chunks, the minimum sleep between chunks.
   *  Caps the bursting that comes from chunks recorded with `dt_ms ≈ 0`.
   *  Defaults to 0 (replay exactly as recorded). 5–15 ms gives smooth,
   *  visible streaming similar to live eagle.ai responses. */
  replayDtMinMs: number;
  /** Per-model overrides for the three streaming knobs. Same matching
   *  rules as `responsesFilesByModel`: case-insensitive substring against
   *  the request `model`, first match wins, fall back to the scalar value
   *  when nothing matches. Values are integers in ms / chars. */
  streamDelayMsByModel: Record<string, number>;
  streamInitialDelayMsByModel: Record<string, number>;
  streamChunkSizeByModel: Record<string, number>;
  defaultResponse: string;
  responsesFile: string;
  /**
   * Optional per-model overrides for the responses file. Keys are case-
   * insensitive substring patterns matched against the request `model`
   * field; the first match wins. Falls back to `responsesFile` when no
   * pattern matches.
   *
   *   RESPONSES_FILES_BY_MODEL='{"vanilla":"./vanilla-responses.json"}'
   */
  responsesFilesByModel: Record<string, string>;
  logRequests: boolean;
  authToken: string;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseRecordEnv(
  value: string | undefined,
): Record<string, string> {
  if (value === undefined || value.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v !== '') result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function parseRecordIntEnv(
  value: string | undefined,
): Record<string, number> {
  if (value === undefined || value.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n =
        typeof v === 'number'
          ? v
          : typeof v === 'string'
            ? Number.parseInt(v, 10)
            : NaN;
      if (Number.isFinite(n)) result[k] = n;
    }
    return result;
  } catch {
    return {};
  }
}

export default (): { app: AppConfig } => ({
  app: {
    port: parseIntEnv(process.env.PORT, 3000),
    streamDelayMs: parseIntEnv(process.env.STREAM_DELAY_MS, 30000),
    streamInitialDelayMs: parseIntEnv(process.env.STREAM_INITIAL_DELAY_MS, 0),
    streamChunkSize: parseIntEnv(process.env.STREAM_CHUNK_SIZE, 100),
    replayDtMinMs: parseIntEnv(process.env.REPLAY_DT_MIN_MS, 0),
    streamDelayMsByModel: parseRecordIntEnv(
      process.env.STREAM_DELAY_MS_BY_MODEL,
    ),
    streamInitialDelayMsByModel: parseRecordIntEnv(
      process.env.STREAM_INITIAL_DELAY_MS_BY_MODEL,
    ),
    streamChunkSizeByModel: parseRecordIntEnv(
      process.env.STREAM_CHUNK_SIZE_BY_MODEL,
    ),
    defaultResponse:
      process.env.DEFAULT_RESPONSE ?? 'No matching response found.',
    responsesFile: process.env.RESPONSES_FILE ?? './responses.json',
    responsesFilesByModel: parseRecordEnv(
      process.env.RESPONSES_FILES_BY_MODEL,
    ),
    logRequests: parseBoolEnv(process.env.LOG_REQUESTS, true),
    authToken: process.env.AUTH_TOKEN ?? '',
  },
});
