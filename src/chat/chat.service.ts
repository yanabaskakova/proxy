import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Response } from 'express';
import { ResponsesService } from '../responses/responses.service';
import { StreamService } from '../stream/stream.service';
import { ChatMessageDto } from './dto/chat-completion.dto';
import { RecordedChunk } from '../responses/interfaces/response-rule.interface';

interface ResolvedResponse {
  ruleId: string;
  content: string;
  /** Pre-recorded SSE chunks for verbatim streaming replay, if available. */
  chunks?: RecordedChunk[];
}

/**
 * Produces OpenAI Chat Completions-compatible responses (streaming and
 * non-streaming) backed by the prebuilt response rules.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly responses: ResponsesService,
    private readonly stream: StreamService,
  ) {}

  /** Resolve the prompt (last user message) to a rule response or the default. */
  resolve(messages: ChatMessageDto[], model?: string): ResolvedResponse {
    const prompt = this.extractPrompt(messages);
    const match = this.responses.match(prompt, model);

    if (match) {
      const replay = match.chunks ? ` (replay ${match.chunks.length} chunks)` : '';
      this.logger.log(`Matched rule id: ${match.ruleId}${replay}`);
      return {
        ruleId: match.ruleId,
        content: match.response,
        chunks: match.chunks,
      };
    }

    this.logger.log('No rule matched; using default response');
    return {
      ruleId: 'default',
      content: this.config.get<string>(
        'app.defaultResponse',
        'No matching response found.',
      ),
    };
  }

  /** Build a complete (non-streaming) chat.completion object. */
  buildCompletion(model: string, content: string): Record<string, unknown> {
    const created = Math.floor(Date.now() / 1000);
    return {
      id: this.completionId(),
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  /**
   * Stream a chat.completion.chunk sequence over an Express response as SSE,
   * terminating with `data: [DONE]`. The delay between chunks is configurable
   * via STREAM_DELAY_MS.
   */
  async streamCompletion(
    res: Response,
    model: string,
    content: string,
    recorded?: RecordedChunk[],
  ): Promise<void> {
    // Recorded path: replay the original SSE bytes verbatim with the recorded
    // per-chunk timing. The wire format matches what the source model emitted
    // (model name, finish_reason placement, reasoning_content vs content, etc.).
    if (recorded && recorded.length > 0) {
      await this.replayRecorded(res, recorded);
      return;
    }

    const id = this.completionId();
    const created = Math.floor(Date.now() / 1000);
    const delayMs = this.resolveByModel(
      'app.streamDelayMsByModel',
      'app.streamDelayMs',
      model,
      30000,
    );
    const initialDelayMs = this.resolveByModel(
      'app.streamInitialDelayMsByModel',
      'app.streamInitialDelayMs',
      model,
      0,
    );
    const chunkSize = this.resolveByModel(
      'app.streamChunkSizeByModel',
      'app.streamChunkSize',
      model,
      100,
    );
    const chunks = this.stream.chunk(content, chunkSize);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.logger.log(`Stream started (${chunks.length} chunk(s))`);

    if (initialDelayMs > 0) {
      await sleep(initialDelayMs);
      if (res.writableEnded) {
        this.logger.warn('Client disconnected during initial delay');
        return;
      }
    }

    // First chunk carries the assistant role.
    this.writeChunk(res, id, created, model, { role: 'assistant' }, null);

    for (let i = 0; i < chunks.length; i++) {
      if (res.writableEnded) {
        this.logger.warn('Client disconnected; aborting stream');
        return;
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      this.writeChunk(res, id, created, model, { content: chunks[i] }, null);
    }

    // Final chunk: empty delta with finish_reason "stop".
    this.writeChunk(res, id, created, model, {}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();

    this.logger.log('Stream completed');
  }

  /**
   * Replay a recorded SSE stream chunk-for-chunk. Sleeps `dt_ms` before
   * emitting each chunk, then writes `data: ${raw}\n\n`. Bails early if
   * the client disconnects mid-stream.
   */
  private async replayRecorded(
    res: Response,
    chunks: RecordedChunk[],
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // Disable Nagle so each chunk hits the wire immediately instead of
    // being coalesced with neighbours into one packet.
    res.socket?.setNoDelay?.(true);

    const minDt = this.config.get<number>('app.replayDtMinMs', 0);

    this.logger.log(
      `Replaying ${chunks.length} recorded chunk(s) (minDt=${minDt}ms)`,
    );

    for (const chunk of chunks) {
      if (res.writableEnded) {
        this.logger.warn('Client disconnected; aborting replay');
        return;
      }
      // Always defer at least one event-loop turn so Node flushes the
      // previous write before we queue the next one. `await sleep(0)` is
      // enough; for non-zero recorded gaps (or the configured floor) we
      // sleep the actual interval.
      const dt = Math.max(chunk.dt_ms, minDt);
      await sleep(dt);
      if (res.writableEnded) return;
      res.write(`data: ${chunk.raw}\n\n`);
    }

    // Defensive: most recordings already end with the [DONE] sentinel as a
    // chunk. If not, terminate the stream explicitly.
    const last = chunks[chunks.length - 1];
    if (!last?.done && last?.raw !== '[DONE]') {
      res.write('data: [DONE]\n\n');
    }
    res.end();
    this.logger.log('Replay completed');
  }

  private writeChunk(
    res: Response,
    id: string,
    created: number,
    model: string,
    delta: Record<string, unknown>,
    finishReason: string | null,
  ): void {
    const payload = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  /**
   * Resolve a numeric setting that may be overridden per model. `mapKey`
   * points to a `Record<string, number>` (pattern -> value); `scalarKey`
   * is the fallback. First case-insensitive substring match on `model`
   * wins; otherwise the scalar default is used.
   */
  private resolveByModel(
    mapKey: string,
    scalarKey: string,
    model: string,
    fallback: number,
  ): number {
    const map = this.config.get<Record<string, number>>(mapKey, {});
    const lower = model.toLowerCase();
    for (const [pattern, value] of Object.entries(map)) {
      if (lower.includes(pattern.toLowerCase())) return value;
    }
    return this.config.get<number>(scalarKey, fallback);
  }

  /** Use the last user message; fall back to the last message of any role. */
  private extractPrompt(messages: ChatMessageDto[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content;
      }
    }
    return messages.length > 0 ? messages[messages.length - 1].content : '';
  }

  private completionId(): string {
    return `chatcmpl-${randomUUID().replace(/-/g, '')}`;
  }
}
