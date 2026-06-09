import {
  Body,
  Controller,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { BearerAuthGuard } from '../auth/bearer-auth.guard';
import { ChatCompletionRequestDto } from './dto/chat-completion.dto';
import { ChatService } from './chat.service';

@Controller('v1/chat')
@UseGuards(BearerAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chat: ChatService,
    private readonly config: ConfigService,
  ) {}

  @Post('completions')
  async createChatCompletion(
    @Body() body: ChatCompletionRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    if (this.config.get<boolean>('app.logRequests', true)) {
      this.logger.log(
        `Incoming request: model=${body.model} messages=${body.messages.length} stream=${body.stream === true}`,
      );
    }

    const { content } = this.chat.resolve(body.messages);

    try {
      if (body.stream === true) {
        await this.chat.streamCompletion(res, body.model, content);
        return;
      }

      const completion = this.chat.buildCompletion(body.model, content);
      res.status(200).json(completion);
    } catch (error) {
      this.logger.error(
        `Error handling chat completion: ${(error as Error).message}`,
        (error as Error).stack,
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: 'Internal server error',
            type: 'internal_error',
          },
        });
      } else if (!res.writableEnded) {
        // Best-effort termination of an already-open SSE stream.
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }
}
