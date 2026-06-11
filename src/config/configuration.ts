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

export default (): { app: AppConfig } => ({
  app: {
    port: parseIntEnv(process.env.PORT, 3000),
    streamDelayMs: parseIntEnv(process.env.STREAM_DELAY_MS, 30000),
    streamInitialDelayMs: parseIntEnv(process.env.STREAM_INITIAL_DELAY_MS, 0),
    streamChunkSize: parseIntEnv(process.env.STREAM_CHUNK_SIZE, 100),
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
