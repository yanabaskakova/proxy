import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Response } from 'express';
import { ResponsesService } from '../responses/responses.service';
import { StreamService } from '../stream/stream.service';
import { ChatMessageDto } from './dto/chat-completion.dto';

interface ResolvedResponse {
  ruleId: string;
  content: string;
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
      this.logger.log(`Matched rule id: ${match.ruleId}`);
      return { ruleId: match.ruleId, content: match.response };
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
  ): Promise<void> {
    const id = this.completionId();
    const created = Math.floor(Date.now() / 1000);
    const delayMs = this.config.get<number>('app.streamDelayMs', 30000);
    const initialDelayMs = this.config.get<number>(
      'app.streamInitialDelayMs',
      0,
    );
    const chunks = this.stream.chunk(content);

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
