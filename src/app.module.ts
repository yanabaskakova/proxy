import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { HealthController } from './health/health.controller';
import { ResponsesService } from './responses/responses.service';
import { StreamService } from './stream/stream.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
  ],
  controllers: [ChatController, HealthController],
  providers: [ChatService, ResponsesService, StreamService],
})
export class AppModule {}
