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

export default (): { app: AppConfig } => ({
  app: {
    port: parseIntEnv(process.env.PORT, 3000),
    streamDelayMs: parseIntEnv(process.env.STREAM_DELAY_MS, 30000),
    streamInitialDelayMs: parseIntEnv(process.env.STREAM_INITIAL_DELAY_MS, 0),
    streamChunkSize: parseIntEnv(process.env.STREAM_CHUNK_SIZE, 100),
    defaultResponse:
      process.env.DEFAULT_RESPONSE ?? 'No matching response found.',
    responsesFile: process.env.RESPONSES_FILE ?? './responses.json',
    logRequests: parseBoolEnv(process.env.LOG_REQUESTS, true),
    authToken: process.env.AUTH_TOKEN ?? '',
  },
});
