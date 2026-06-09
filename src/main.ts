import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown OpenAI fields (temperature, top_p, …) rather than reject.
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  const port = config.get<number>('app.port', 3000);
  await app.listen(port);

  logger.log(`Prebuilt upstream listening on http://0.0.0.0:${port}`);
  logger.log(`Chat endpoint:   POST /v1/chat/completions`);
  logger.log(`Health endpoint: GET  /health`);
}

void bootstrap();
